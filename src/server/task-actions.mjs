import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { randomUUID } from 'node:crypto';

function restoreLegacyRoute(scope, agent) {
  if (agent.model) return; // 0.2.2+ restores its own model-selection projection.
  const route = agent.session.requestHeader?.()?.config;
  if (!route?.provider || !route.model) throw new Error('请先打开主会话并选择模型，再继续执行任务');
  // rc.3 has no Agent.model. Restore only an otherwise empty route; a live
  // model picker or later routing plugin must remain free to select a new one.
  scope.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const value = await next();
    return { ...value, variables: { ...value.variables, provider: value.variables.provider || route.provider, model: value.variables.model || route.model } };
  });
  scope.on('agent/request', async (_payload, next) => {
    const value = await next();
    return value.provider && value.model ? value : { ...value, provider: route.provider, model: route.model, ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }) };
  });
}

// A finished one-shot child must not be woken as an unrelated root agent.
export class TaskActions {
  constructor(ctx, service) { this.ctx = ctx; this.service = service; this.inFlight = new Map(); this.resuming = new Map(); this.handles = new Set(); this.unflushed = new Map(); }
  resume(sid, ref, version) {
    if (this.stopped) throw new Error('Taskflow 已卸载');
    const request = this.service.continuation(sid, ref, version);
    const key = `${request.rootSessionId}:${request.task.id}:${version}:${request.task.attempt?.id ?? 'new'}`;
    if (this.inFlight.has(key)) return this.inFlight.get(key);
    const work = this.send(request, key).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, work); return work;
  }
  async root(sid) {
    const live = this.ctx.agents.get(sid); if (live) return live;
    if (!this.resuming.has(sid)) this.resuming.set(sid, (async () => {
      try { const handle = await this.ctx.agents.resume({ resumeSessionId: sid, setup: restoreLegacyRoute }); this.handles.add(handle); return handle.agent; }
      catch (error) { const raced = this.ctx.agents.get(sid); if (raced) return raced; throw error; }
      finally { this.resuming.delete(sid); }
    })());
    return this.resuming.get(sid);
  }
  async send({ rootSessionId, task, ancestors }, key) {
    const agent = await this.root(rootSessionId), prefix = `taskflow-resume:${key}:`;
    if (this.stopped) throw new Error('Taskflow 已卸载');
    ({ task, ancestors } = this.service.continuation(rootSessionId, task.id, task.version));
    const pending = [...agent.inbox.nextStep, ...agent.inbox.nextTurn].find(m => m.id?.startsWith(prefix));
    const id = pending?.id || this.unflushed.get(key) || `${prefix}${randomUUID()}`;
    const seen = agent.session.snapshotEvents().some(e => e.type === 'user/message' && e.data?.id === id);
    if (!pending && !seen) {
      const message = createUserMessage({ source: { kind: 'taskflow', form: 'action', summary: `继续执行 ${task.id}` }, content: [{ type: 'text', text: [
        `用户点击继续执行 ${task.id}：${task.title}。这是执行请求，请实际调用任务工具推进，而非仅描述下一步。`,
        `父任务链：${ancestors.map(t => `${t.id}(${t.status},${t.mode})`).join(' → ') || '主任务'}。`,
        '先 taskflow_status 读取最新状态；若委派父任务已停止，从最外层未运行的委派父任务开始 taskflow_start，由新子会话继续目标事项。不要把下级改挂到主会话。',
        '已完成事项及其结果必须保留，不重复创建同名清单或已存在下级。复杂且独立的事项委派子会话，简单事项在负责的会话执行。',
        `上次结果：${task.report?.summary ?? '尚未执行'}。`,
        '外部条件仍未满足时，明确列出缺少的输入或操作并保存受阻原因，不得虚报完成。',
      ].join('\n') }] });
      this.unflushed.set(key, id); agent.followup({ ...message, id });
    }
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error('执行请求尚未持久化，请重试');
    this.unflushed.delete(key);
    return { accepted: true, sessionId: rootSessionId, taskId: task.id, message: `已提交 ${task.id} 的执行请求至主会话，等待模型执行。` };
  }
  async dispose() { this.stopped = true; await Promise.allSettled(this.inFlight.values()); await Promise.allSettled([...this.handles].map(h => h.dispose())); this.handles.clear(); this.unflushed.clear(); }
}
