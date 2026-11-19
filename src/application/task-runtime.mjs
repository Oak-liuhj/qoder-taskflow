import { randomUUID } from 'node:crypto';
import { children, ownerOf } from '../domain/task-service.mjs';

export const RESULT_SCHEMA = { type: 'object', additionalProperties: false, required: ['status', 'summary'], properties: {
  status: { type: 'string', enum: ['completed', 'blocked', 'failed'] },
  summary: { type: 'string' },
} };

/** One scheduler for the whole tree. Waiting ancestors relinquish their slots. */
export class TaskRuntime {
  constructor(service, host) {
    this.service = service; this.host = host; this.runs = new Map(); this.waiters = new Map(); this.stopped = false; this.pumping = false;
    this.unsubscribe = service.subscribe(() => this.kick());
  }
  kick() { if (this.stopped || this.scheduled) return; this.scheduled = true; queueMicrotask(() => { this.scheduled = false; this.pump().catch(error => this.host.log?.(error)); }); }
  slots() { return [...this.runs.values()].filter(run => run.holdsSlot).length; }
  async pump() {
    if (this.stopped) return; if (this.pumping) { this.rerun = true; return; } this.pumping = true;
    try {
      let state = this.service.store.read();
      for (const [key, run] of this.runs) {
        const task = state.plans[run.planId]?.tasks[run.taskId];
        if (!task || task.attempt?.id !== run.attemptId || task.status === 'cancelled') { run.controller.abort(); continue; }
        if (task.status === 'awaiting_children') run.holdsSlot = false;
      }
      await this.deliver();
      for (const [key, wait] of this.waiters) {
        const p = state.plans[wait.planId], t = p?.tasks[wait.taskId];
        if (!t || t.attempt?.id !== wait.attemptId) { this.waiters.delete(key); wait.reject(new Error('等待任务的执行版本已失效')); continue; }
        // Return pending inline work to its responsible model; waiting for it
        // inside that same model call would deadlock the conversation.
        const pending = children(p, t.id).filter(c => ['running', 'queued', 'awaiting_children'].includes(c.status) && !(c.mode === 'inline' && c.executionSessionId === wait.sessionId));
        if (!pending.length && this.slots() < this.service.options.maxConcurrent) {
          const run = this.runs.get(key); if (run) run.holdsSlot = true;
          this.waiters.delete(key); await this.service.resumeWaiting(p.id, t.id); wait.resolve(children(p, t.id).map(c => ({ id: c.id, status: c.status, report: c.report })));
        }
      }
      state = this.service.store.read();
      for (const p of Object.values(state.plans)) for (const t of Object.values(p.tasks)) {
        if (this.stopped || this.slots() >= this.service.options.maxConcurrent) break;
        if (t.mode !== 'delegate' || t.status !== 'queued' || !t.dependsOn.every(id => p.tasks[id]?.status === 'completed')) continue;
        const key = `${p.id}:${t.id}`; if (this.runs.has(key)) continue;
        const parentSessionId = ownerOf(p, t), parent = this.host.agent(parentSessionId);
        if (!parent) continue;
        let depth = 0; for (let sid = parentSessionId; sid !== p.rootSessionId;) { const bound = Object.values(p.tasks).find(x => x.mode === 'delegate' && x.executionSessionId === sid); if (!bound) break; depth++; sid = ownerOf(p, bound); }
        if (depth >= this.service.options.maxDepth) {
          await this.service.change(s => { const live = s.plans[p.id].tasks[t.id]; if (live.attempt?.id === t.attempt.id) { live.mode = 'inline'; live.status = 'pending'; live.attempt = null; } });
          continue;
        }
        const run = { planId: p.id, taskId: t.id, attemptId: t.attempt.id, holdsSlot: true, controller: new AbortController() };
        this.runs.set(key, run);
        run.promise = this.perform(p, t, parent, run).catch(error => this.host.log?.(error)).finally(() => { this.runs.delete(key); this.kick(); });
      }
      await this.deliver();
    } finally { this.pumping = false; if (this.rerun) { this.rerun = false; this.kick(); } }
  }
  async perform(plan, task, parent, run) {
    const childId = randomUUID(); let activation;
    try {
      // Persist the reserved child binding before it can call any taskflow tool.
      await this.service.bind(plan.id, task.id, run.attemptId, childId);
      activation = await this.host.start({ childId, parent, signal: run.controller.signal, maxDepth: this.service.options.maxDepth,
        label: `${task.id} ${task.title}`, outputSchema: RESULT_SCHEMA,
        prompt: [{ type: 'text', text: [
          `你负责 ${task.id}：${task.title}。`, `整体目标：${plan.goal}`, `执行要求：${task.instructions}`, `完成标准：${task.criteria}`,
          `本事项复杂度：${task.complexity}。执行前先判断是否需要拆解：需要则 taskflow_add 在本事项下增加具体子事项，再逐项 taskflow_start；无需拆解则 taskflow_assess(needsPlan:false, reason, taskId:"${task.id}") 保存判断依据。子事项执行时也要按自身复杂度判断，可再次拆解孙事项。简单事项留在本会话。`,
          '先 taskflow_status 读取现有下级，按原 ID 继续未完成事项；保留完成记录，不重复规划。high 且 independent=true 的事项应委派；不要将其强制标为 inline。',
          `本次任务历史结果：${task.report?.summary ?? '无'}。现有下级：${JSON.stringify(children(plan, task.id).map(t => ({ id: t.id, status: t.status, report: t.report })))}`,
          '有下级事项时先用 taskflow_wait 等待其结果，再完成本层剩余工作。完成下级不代表你已完成。',
          '实际执行过程、关键发现与阶段结果保留在当前子会话，通过 taskflow_progress 保存：写明本步目标、实际操作、关键发现或验证结果、下一步或阻塞原因，必要时附表格、代码片段和产物路径；只记录可观察事实，不用空泛状态代替。不要把中间过程逐条发回父任务。最终结果保存到本子会话后，仅通知直接父任务完成摘要与证据。',
          '最终返回结构化结果 {"status":"completed|blocked|failed","summary":"实际结果与证据"}。不需父会话复核。',
          '只能报告实际完成的工作；失败或缺少输入时返回 failed/blocked。不要调用原生委派工具绕过任务树。',
          `依赖结果：${JSON.stringify(task.dependsOn.map(id => ({ id, report: plan.tasks[id].report })))}`,
        ].join('\n') }],
      });
      if (activation.childId !== childId) throw new Error('宿主未使用已持久化的子会话 ID');
      run.activation = activation;
      await this.service.activationReady(plan.id, task.id, run.attemptId);
      const result = await activation.result;
      if (result.stopReason !== 'completed') throw new Error(`子任务停止：${result.stopReason}`);
      const report = result.structured;
      if (!report || !['completed', 'blocked', 'failed'].includes(report.status) || typeof report.summary !== 'string') throw new Error('子任务缺少有效的结构化结果');
      await this.service.settle(childId, task.id, run.attemptId, task.version, report, true);
    } catch (error) {
      try { await this.service.settle(childId, task.id, run.attemptId, task.version, { status: 'failed', summary: String(error.message) }, true); }
      catch (settleError) { if (settleError.code !== 'stale' && settleError.code !== 'state') this.host.log?.(settleError); }
    } finally {
      try { await activation?.dispose(); } catch (error) { this.host.log?.(error); }
    }
  }
  async wait(sid, taskId, signal) {
    const view = this.service.view(sid), t = view.plan.tasks[taskId], key = `${view.plan.id}:${taskId}`;
    if (this.waiters.has(key)) throw new Error('该任务已在等待下级结果');
    await this.service.wait(sid, taskId);
    const result = new Promise((resolve, reject) => {
      const abort = () => { this.waiters.delete(key); reject(new Error('等待已取消')); };
      this.waiters.set(key, { planId: view.plan.id, sessionId: sid, taskId, attemptId: t.attempt.id, resolve: value => { signal?.removeEventListener('abort', abort); resolve(value); }, reject: error => { signal?.removeEventListener('abort', abort); reject(error); } });
      if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    });
    this.kick(); return result;
  }
  async deliver() {
    for (const notice of this.service.store.read().outbox.filter(n => !n.delivered)) {
      const task = this.service.store.read().plans[notice.planId]?.tasks[notice.taskId];
      if (!task || task.status !== 'completed' || task.version !== notice.report.version || task.attempt?.id !== notice.report.attemptId) {
        await this.service.store.transaction(s => { const n = s.outbox.find(n => n.id === notice.id); if (n) { n.delivered = true; n.superseded = true; } });
        continue;
      }
      try {
        if (await this.host.recordResult?.(notice) === false) continue;
        const current = this.service.store.read().plans[notice.planId]?.tasks[notice.taskId];
        if (current?.status !== 'completed' || current.version !== notice.report.version || current.attempt?.id !== notice.report.attemptId) continue;
        if (await this.host.notify(notice) !== false) await this.service.store.transaction(s => { const live = s.outbox.find(n => n.id === notice.id); if (live) live.delivered = true; });
      }
      catch (error) { this.host.log?.(error); }
    }
  }
  async dispose() {
    this.stopped = true; this.unsubscribe(); for (const wait of this.waiters.values()) wait.reject(new Error('Taskflow 已卸载')); this.waiters.clear();
    for (const run of this.runs.values()) { run.controller.abort(); await run.activation?.dispose().catch(error => this.host.log?.(error)); }
    await Promise.allSettled([...this.runs.values()].map(run => run.promise));
  }
}
