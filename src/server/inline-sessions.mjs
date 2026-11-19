import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent';
import { recordParentOf, currentTask } from '../domain/task-service.mjs';

// A real, read-only child log for work performed in the parent's context.
// It owns no Agent, does not invoke a model, and consumes no delegation slot.
export class InlineSessions {
  constructor(ctx, service, log = () => {}) {
    this.ctx = ctx; this.service = service; this.log = log; this.owned = new Map(); this.calls = new Map(); this.savedResults = new Set(); this.tail = Promise.resolve();
    this.unsubscribe = service.subscribe(() => { if (!this.internal) this.kick(); });
    this.off = ctx.on('session/event', (session, event) => this.capture(session, event), { global: true });
  }
  enqueue(fn) { const next = this.tail.then(() => this.stopped ? undefined : fn()); this.tail = next.catch(this.log); return next; }
  kick() { if (this.stopped || this.pending) return; this.pending = true; void this.enqueue(async () => { this.pending = false; await this.sync(); }); }
  async mutate(fn) { this.internal = true; try { return await fn(); } finally { this.internal = false; } }
  async acquire(id, meta) {
    const live = this.ctx.sessions.get(id); if (live) return { session: live, release: async () => {} };
    const persistence = this.ctx.get('sessionPersistence');
    if (!persistence) throw new Error('宿主未提供会话持久化服务，无法保存事项子会话');
    let handle, session, detach;
    try {
      if (await persistence.stat(id)) {
        handle = await persistence.open(id, 'write'); const read = await handle.read();
        session = this.ctx.sessions.prepare(id, { seed: read.events, meta: structuredClone(handle.header), inheritedEventCount: handle.inheritedEventCount, eventState: read.eventState });
        const suffix = session.snapshotEvents().slice(read.events.length); if (suffix.length) await handle.append(suffix);
      } else {
        if (!meta) throw new Error(`父会话不存在：${id}`);
        session = this.ctx.sessions.prepare(id, { meta });
        handle = await persistence.create(session.header); const seed = session.snapshotEvents(); if (seed.length) await handle.append(seed);
      }
      await handle.flush(); detach = this.ctx.sessions.enter(session); this.ctx.sessions.announce(session);
      return { session, release: async () => { try { await this.ctx.sessions.flush(session); } finally { detach(); await handle.close(); } } };
    } catch (error) { detach?.(); await handle?.close().catch(this.log); throw error; }
  }
  note(session, key, text, summary, record = {}) {
    const id = `taskflow-record-${key}`;
    if (session.snapshotEvents().some(e => e.type === 'user/message' && e.data.id === id)) return;
    const message = createUserMessage({ source: { kind: 'taskflow', form: 'notice', summary, record: { version: 1, ...record } }, content: [{ type: 'text', text }] });
    session.append('user/message', { ...message, id }, { surfaceOp: 'append' });
  }
  async durable(session) { if (!await this.ctx.sessions.flush(session)) throw new Error('事项会话记录尚未持久化，将自动重试'); }
  async ensure(plan, task) {
    // Planning alone must never materialize sidebar sessions. Existing records
    // remain intact; interrupted/completed executions may still recover theirs.
    if (!task.attempts && !task.recordSession?.created) return null;
    const parentTask = plan.tasks[task.parentId];
    if (parentTask?.mode === 'inline') {
      await this.ensure(plan, parentTask);
      plan = this.service.view(plan.rootSessionId).plan; task = plan.tasks[task.id];
    }
    const parentId = recordParentOf(plan, task);
    if (!parentId) return null; // A deferred parent must create its real session first.
    let record = task.recordSession;
    if (!record || record.parentSessionId !== parentId) record = await this.mutate(() => this.service.reserveRecord(plan.id, task.id));
    let child = this.owned.get(record.id);
    if (!child) {
      const parent = await this.acquire(record.parentSessionId);
      try {
        const header = parent.session.header;
        child = await this.acquire(record.id, { parentSession: header.id, origin: 'subagent', cwd: header.cwd, delegationDepth: (header.delegationDepth ?? 0) + 1 });
        const session = child.session;
        if (!session.snapshotEvents().some(e => e.type === 'subagent/descriptor')) session.append('subagent/descriptor', { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'taskflow-inline', label: `${task.id} ${task.title}` });
        this.note(session, `${record.id}-intro`, `${task.id} ${task.title}\n此事项在负责会话的上下文中执行。本子会话按待办层级保存要求、状态与实际执行记录，不单独调用模型。\n任务要求：${task.instructions || task.title}\n完成标准：${task.criteria || '按任务要求完成'}${!task.attempts ? '\n尚未执行；创建记录会话不代表任务已开始或已完成。' : ['completed', 'failed', 'blocked', 'cancelled'].includes(task.status) ? '\n本会话根据已有事项补建；历史过程仍保留在负责会话，以下展示已保存的执行结果。' : ''}`, `${task.id} 任务要求`);
        await this.durable(session);
        if (!parent.session.snapshotEvents().some(e => e.type === 'subagent/catalog' && e.data.childId === record.id)) parent.session.append('subagent/catalog', { version: 1, childId: record.id, childCreatedAt: session.header.createdAt, mode: 'one-shot', label: `${task.id} ${task.title}` });
        await this.durable(parent.session);
        this.owned.set(record.id, child);
      } catch (error) { await child?.release().catch(this.log); throw error; }
      finally { await parent.release(); }
    }
    const key = `${record.id}-${task.version}-${task.attempt?.id || task.attempts}-${task.status}`;
    const labels = { pending: '待执行', queued: '排队中', running: '执行中', awaiting_children: '等待下级', paused: '已暂停', blocked: '受阻', failed: '失败', completed: '已完成', cancelled: '已取消' };
    this.note(child.session, key, `${task.id} 状态：${labels[task.status] || task.status}${task.report ? `\n${task.report.version === task.version ? '实际执行结果' : `历史结果 v${task.report.version}`}：\n${task.report.summary}` : ''}`, `${task.id} 执行状态`);
    await this.durable(child.session);
    if (!record.created || task.recordError) await this.mutate(() => this.service.recordReady(plan.id, task.id, record.id));
    return child.session;
  }
  async sync() {
    for (const p of Object.values(this.service.store.read().plans)) for (const t of Object.values(p.tasks)) {
      if (t.mode === 'delegate') {
        if (t.executionCreated && t.report?.version === t.version) try { await this.saveResult(p.id, t.id, t.report); } catch (error) { this.log(error); }
        continue;
      }
      if (t.mode !== 'inline' || (!t.attempts && !t.recordSession?.created)) continue;
      try { const latest = this.service.view(p.rootSessionId).plan; await this.ensure(latest, latest.tasks[t.id]); }
      catch (error) { await this.mutate(() => this.service.recordError(p.id, t.id, error.message)); this.log(error); }
    }
  }
  progress(sid, ref, content, key) {
    if (typeof content !== 'string' || !content.trim() || content.length > 16000) throw new Error('进展必须为非空文本，最多16000字符');
    const plan = this.service.view(sid).plan, task = plan && currentTask(plan, sid);
    if (!task || (ref && ref !== task.id) || task.executionSessionId !== sid || !['running', 'awaiting_children'].includes(task.status)) throw new Error('只能向当前正在执行的任务保存进展');
    return this.enqueue(async () => {
      const latest = this.service.view(sid).plan, live = latest?.tasks[task.id];
      if (live?.version !== task.version || live?.attempt?.id !== task.attempt?.id || !['running', 'awaiting_children'].includes(live.status)) throw new Error('任务执行已变化，不能保存过期进展');
      const owned = task.mode === 'delegate' ? await this.acquire(sid) : null;
      try {
        const target = owned?.session ?? await this.ensure(latest, live);
        if (!target) throw new Error('当前事项子会话尚未就绪');
        this.note(target, `${sid}-progress-${key}`, content.trim(), `${task.id} 执行进展`, { category: 'progress' }); await this.durable(target);
        return { taskId: task.id, sessionId: target.id, saved: true };
      } finally { await owned?.release(); }
    });
  }
  async saveResult(planId, taskId, report) {
    const plan = this.service.store.read().plans[planId], task = plan?.tasks[taskId];
    if (!task || task.report?.attemptId !== report.attemptId || task.report.version !== report.version) return false;
    if (task.mode === 'inline') return !!await this.ensure(plan, task);
    if (!task.executionSessionId || task.executionCreated === false) return false;
    const key = `${planId}-${taskId}-${report.version}-${report.attemptId}-result`;
    if (this.savedResults.has(key)) return true;
    const owned = await this.acquire(task.executionSessionId);
    try {
      this.note(owned.session, key, `${task.id} 最终结果（${report.status}）\n${report.summary}`, `${task.id} 最终结果`, { category: 'result', status: report.status });
      await this.durable(owned.session); this.savedResults.add(key); return true;
    } finally { await owned.release(); }
  }
  result(notice) { return this.enqueue(async () => {
    if (!await this.saveResult(notice.planId, notice.taskId, notice.report)) return false;
    const plan = this.service.store.read().plans[notice.planId], task = plan.tasks[notice.taskId];
    if (task.status !== 'completed' || task.version !== notice.report.version || task.attempt?.id !== notice.report.attemptId) return false;
    const parentId = recordParentOf(plan, task);
    if (parentId && parentId !== notice.targetSessionId) {
      const parent = await this.acquire(parentId);
      try { this.note(parent.session, `${notice.id}-child-completed`, `${task.id} 已完成\n${notice.report.summary}`, `${task.id} 已完成`); await this.durable(parent.session); }
      finally { await parent.release(); }
    }
    return true;
  }); }
  capture(parent, event) {
    const p = this.service.view(parent.id).plan; if (!p) return;
    const callKey = `${parent.id}:${event.data.callId ?? event.data.message?.toolCallId}`;
    let t = p.tasks[p.active[parent.id]];
    const call = event.type === 'tool/result' ? this.calls.get(callKey) : null;
    if (event.type === 'tool/result') { t = call?.task; this.calls.delete(callKey); }
    if (!t || t.mode !== 'inline' || t.executionSessionId !== parent.id || (event.type !== 'tool/result' && !['running', 'awaiting_children'].includes(t.status))) return;
    if (event.type === 'tool/call' && !event.data.name.startsWith('taskflow_')) this.calls.set(callKey, { task: t, name: event.data.name, time: event.time });
    let text, category, toolName;
    if (event.type === 'request/header') {
      // Native request headers carry config only; the step belongs to step/start.
      const step = event.data.step ?? parent.snapshotEvents().findLast(e => e.seq < event.seq && e.type === 'step/start')?.data.step;
      text = Number.isInteger(step) && step > 0 ? `开始第 ${step} 步模型调用。` : '开始模型调用。'; category = 'model-call';
    }
    if (event.type === 'tool/call' && !event.data.name.startsWith('taskflow_')) { text = `执行工具：${event.data.name}\n${event.data.arguments || ''}`; category = 'tool-call'; toolName = event.data.name; }
    if (['assistant/message', 'tool/result'].includes(event.type)) {
      const message = event.data.message ?? event.data;
      text = (message.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
      category = event.type === 'assistant/message' ? 'model-output' : 'tool-result';
      toolName = call?.name;
      // Taskflow's own result records are represented by the task status notes.
      if (event.type === 'tool/result' && parent.snapshotEvents().some(e => e.type === 'tool/call' && e.data.callId === message.toolCallId && e.data.name.startsWith('taskflow_'))) return;
    }
    if (!text) return;
    const labels = { 'model-call': '模型调用', 'model-output': '模型输出', 'tool-call': '工具调用', 'tool-result': '工具结果' };
    const detail = { category, originSessionId: parent.id, originSeq: event.seq };
    if (toolName) detail.tool = toolName;
    if (event.data.message?.isError) detail.status = 'failed';
    if (call?.time && event.time >= call.time) detail.durationMs = event.time - call.time;
    const source = event.type === 'assistant/message' && event.data.message?.source;
    if (source?.kind === 'model') detail.model = { provider: source.provider, model: source.model };
    const config = event.type === 'request/header' && event.data.header?.config;
    if (typeof config?.provider === 'string' && typeof config.model === 'string') detail.model = { provider: config.provider, model: config.model };
    void this.enqueue(async () => { try { const latest = this.service.view(p.rootSessionId).plan, live = latest.tasks[t.id]; if (live.version !== t.version || live.attempt?.id !== t.attempt?.id) return; const record = await this.ensure(latest, live); if (!record) return; this.note(record, `${parent.id}-${event.seq}`, text, `${t.id} ${labels[category]}`, detail); await this.durable(record); } catch (error) { await this.mutate(() => this.service.recordError(p.id, t.id, error.message)); this.log(error); } });
  }
  async idle() { await this.tail; }
  async dispose() {
    this.unsubscribe(); this.off(); await this.tail; this.stopped = true;
    for (const owned of this.owned.values()) await owned.release().catch(this.log);
    this.owned.clear(); this.calls.clear(); this.savedResults.clear();
  }
}
