import { randomUUID } from 'node:crypto';
import { normalizeDocuments } from './tool-view.mjs';

const terminal = task => ['completed', 'cancelled'].includes(task.status);
export class TaskflowError extends Error { constructor(code, message) { super(message); this.code = code; } }
const fail = (code, message) => { throw new TaskflowError(code, message); };
const text = (value, label, max = 16000) => { if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid', `${label} 必须为非空文本（最多 ${max} 字符）`); return value.trim(); };
export const children = (plan, id) => Object.values(plan.tasks).filter(t => t.parentId === id);
export function descendants(plan, id) { return children(plan, id).flatMap(t => [t, ...descendants(plan, t.id)]); }
export function resolveTask(plan, ref) {
  if (Object.hasOwn(plan.tasks, ref)) return plan.tasks[ref];
  const found = Object.values(plan.tasks).filter(t => t.title === ref);
  if (found.length !== 1) fail(found.length ? 'ambiguous' : 'not-found', found.length ? '任务名称重复，请使用任务 ID' : `找不到任务：${ref}`);
  return found[0];
}
export function sessionPlan(state, sessionId) { return Object.hasOwn(state.sessions, sessionId) ? state.plans[state.sessions[sessionId]] : undefined; }
export function ownerOf(plan, task) { const parent = plan.tasks[task.parentId]; return parent ? parent.mode === 'delegate' && parent.executionSessionId ? parent.executionSessionId : ownerOf(plan, parent) : plan.rootSessionId; }
export function recordParentOf(plan, task) {
  const parent = plan.tasks[task.parentId];
  if (!parent) return plan.rootSessionId;
  // A completed result belongs to the attempt that actually produced it.
  // Parent retries must not duplicate/reparent that successful history.
  const original = task.recordSession?.created && task.recordSession.parentSessionId;
  if (terminal(task) && original && (parent.sessionHistory?.some(h => h.sessionId === original) || parent.recordHistory?.some(h => h.id === original))) return original;
  if (parent.mode === 'inline') return parent.recordSession?.created ? parent.recordSession.id : null;
  return parent.executionSessionId && parent.executionCreated !== false ? parent.executionSessionId : null;
}
export function currentTask(plan, sid) {
  const record = Object.values(plan.tasks).find(t => t.recordSession?.id === sid || t.recordHistory?.some(r => r.id === sid));
  if (record) return record;
  const focused = plan.active[sid];
  return focused && plan.tasks[focused] ? plan.tasks[focused] : Object.values(plan.tasks).find(t => t.executionSessionId === sid && t.mode === 'delegate');
}
export function delegationDepth(plan, task) {
  let depth = 0;
  for (let sid = ownerOf(plan, task); sid !== plan.rootSessionId;) {
    const parent = Object.values(plan.tasks).find(t => t.mode === 'delegate' && t.executionSessionId === sid);
    if (!parent) break;
    depth++; sid = ownerOf(plan, parent);
  }
  return depth;
}
function authorize(plan, sid, task) {
  if (sid === plan.rootSessionId) return;
  const bound = Object.values(plan.tasks).find(t => (t.executionSessionId === sid && t.mode === 'delegate') || t.recordSession?.id === sid);
  if (!bound || (task.id !== bound.id && !descendants(plan, bound.id).some(t => t.id === task.id))) fail('forbidden', '只能操作当前会话负责的任务及其下级');
}
function validateGraph(plan) {
  // A parent cannot finish until its descendants finish. Depending on a
  // completed ancestor deadlocks that contract; explain how to model phases.
  for (const t of Object.values(plan.tasks)) {
    const seen = new Set([t.id]);
    for (let parent = plan.tasks[t.parentId]; parent && !seen.has(parent.id); parent = plan.tasks[parent.parentId]) {
      seen.add(parent.id);
      if (t.dependsOn.includes(parent.id)) fail('cycle', `${t.id} 不能依赖父任务或祖先 ${parent.id} 完成：parentId 表示组成归属，dependsOn 表示执行先后；若是先后阶段，请设为同级任务再添加依赖`);
    }
  }
  const visiting = new Set(), visited = new Set();
  const visit = id => { if (visiting.has(id)) fail('cycle', '任务依赖或层级存在循环'); if (visited.has(id)) return; const t = plan.tasks[id]; if (!t) fail('not-found', `依赖任务不存在：${id}`); visiting.add(id); for (const d of [...t.dependsOn, ...children(plan, id).map(c => c.id)]) visit(d); visiting.delete(id); visited.add(id); };
  Object.keys(plan.tasks).forEach(visit);
}
function reopen(plan, task) {
  for (let t = task; t; t = plan.tasks[t.parentId]) {
    if (t.status === 'completed') { t.status = 'pending'; t.version++; t.attempt = null; }
  }
}
function stamp(plan, kind, taskId, detail) { plan.version++; plan.updatedAt = new Date().toISOString(); plan.events.push({ id: randomUUID(), kind, taskId, detail, at: plan.updatedAt }); plan.events = plan.events.slice(-500); }

export class TaskService {
  constructor(store, options = {}) { this.store = store; this.options = { maxDepth: 2, maxConcurrent: 2, maxTasks: 200, ...options }; this.listeners = new Set(); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  async change(operation) { const value = await this.store.transaction(operation); for (const listener of this.listeners) { try { listener(); } catch {} } return value; }
  view(sid) { const state = this.store.read(), plan = sessionPlan(state, sid); return { revision: state.revision, plan: plan ?? null, currentTaskId: plan ? currentTask(plan, sid)?.id ?? null : null, tool: plan?.views[sid] ?? null, limits: this.options }; }
  scope(state, sid) { const plan = sessionPlan(state, sid); if (!plan) fail('no-plan', '当前会话尚未建立任务计划'); return plan; }
  continuation(sid, ref, version) {
    const p = this.scope(this.store.read(), sid), t = resolveTask(p, ref); authorize(p, sid, t);
    if (t.version !== version) fail('stale', '任务要求已变更，请刷新后重试');
    if (!['pending', 'paused', 'blocked', 'failed'].includes(t.status)) fail('state', '任务当前不可继续，请刷新状态');
    const ancestors = []; for (let a = p.tasks[t.parentId]; a; a = p.tasks[a.parentId]) ancestors.unshift(a);
    if (ancestors.some(a => a.status === 'cancelled')) fail('cancelled', '父任务已取消');
    return structuredClone({ rootSessionId: p.rootSessionId, task: t, ancestors });
  }
  async create(sid, input) {
    return this.change(state => {
      if (typeof sid !== 'string' || !sid || ['__proto__', 'prototype', 'constructor'].includes(sid)) fail('invalid', '会话 ID 无效');
      if (Object.hasOwn(state.sessions, sid)) fail('exists', '计划已存在，请通过增量操作调整，不能覆盖现有计划');
      const plan = { id: randomUUID(), rootSessionId: sid, title: text(input.title, '标题', 240), goal: text(input.goal, '目标'), version: 1, seq: 0, tasks: {}, active: {}, views: {}, events: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.plans[plan.id] = plan; state.sessions[sid] = plan.id;
      this.insert(plan, sid, input.tasks, null); validateGraph(plan); stamp(plan, 'plan', null, '主会话模型生成计划'); return structuredClone(plan);
    });
  }
  insert(plan, sid, inputs, defaultParent) {
    if (!Array.isArray(inputs) || !inputs.length) fail('invalid', '至少提供一个待办事项');
    if (Object.keys(plan.tasks).length + inputs.length > this.options.maxTasks) fail('limit', '计划已达到任务数量上限');
    const aliases = new Map(), created = [];
    for (const input of inputs) {
      if (input.ref && aliases.has(input.ref)) fail('invalid', '新任务 ref 重复');
      const id = `T-${String(++plan.seq).padStart(3, '0')}`;
      if (input.ref) aliases.set(input.ref, id);
      const complexity = input.complexity ?? 'low';
      if (!['low', 'medium', 'high'].includes(complexity)) fail('invalid', '未知任务复杂度');
      if (input.mode !== undefined && !['inline', 'delegate'].includes(input.mode)) fail('invalid', '未知执行方式');
      const mode = complexity === 'high' && input.independent === true ? 'delegate' : input.mode ?? (complexity !== 'low' && input.independent === true ? 'delegate' : 'inline');
      if (!['inline', 'delegate'].includes(mode)) fail('invalid', '未知执行方式');
      const task = { id, title: text(input.title, '任务标题', 240), instructions: text(input.instructions ?? input.title, '任务要求'), criteria: text(input.criteria ?? '完成任务目标并保存结果', '完成标准'), parentId: defaultParent, dependsOn: [], complexity, independent: input.independent === true, mode, status: 'pending', version: 1, attempts: 0, attempt: null, executionSessionId: null, report: null, history: [] };
      plan.tasks[id] = task; created.push({ task, input });
    }
    for (const { task, input } of created) {
      const resolve = ref => aliases.get(ref) ?? resolveTask(plan, ref).id;
      if (input.parentId != null) task.parentId = resolve(input.parentId);
      if (task.parentId) { const parent = plan.tasks[task.parentId]; authorize(plan, sid, parent); if (parent.status === 'cancelled') fail('cancelled', '不能向已取消任务增补'); }
      else if (sid !== plan.rootSessionId) fail('forbidden', '子会话不能创建根任务');
      if (input.dependsOn !== undefined && !Array.isArray(input.dependsOn)) fail('invalid', 'dependsOn 必须是任务 ID 数组');
      task.dependsOn = [...new Set((input.dependsOn ?? []).map(resolve))];
    }
    validateGraph(plan); for (const { task } of created) if (task.parentId) reopen(plan, plan.tasks[task.parentId]); return created.map(x => structuredClone(x.task));
  }
  async add(sid, inputs, parentRef, expectedVersion) {
    return this.change(state => { const p = this.scope(state, sid); if (expectedVersion != null && p.version !== expectedVersion) fail('stale', '计划已变更，请刷新后重试');
      const parent = parentRef != null ? resolveTask(p, parentRef) : currentTask(p, sid);
      if (parent) authorize(p, sid, parent);
      const made = this.insert(p, sid, inputs, parent?.id ?? null); stamp(p, 'add', parent?.id ?? null, made.map(t => t.id).join(', ')); return made;
    });
  }
  async update(sid, ref, patch, version) {
    return this.change(state => { const p = this.scope(state, sid), t = resolveTask(p, ref); authorize(p, sid, t);
      if (t.version !== version) fail('stale', '任务要求已变更，请刷新');
      if (!patch || !Object.keys(patch).length || Object.keys(patch).some(k => !['title', 'instructions', 'criteria', 'complexity', 'independent', 'mode', 'dependsOn', 'parentId'].includes(k))) fail('invalid', '任务修改字段无效');
      if (t.status === 'cancelled') fail('cancelled', '已取消任务不可修改');
      for (const k of ['title', 'instructions', 'criteria']) if (patch[k] !== undefined) t[k] = text(patch[k], k, k === 'title' ? 240 : 16000);
      if (patch.complexity !== undefined) { if (!['low', 'medium', 'high'].includes(patch.complexity)) fail('invalid', '未知任务复杂度'); t.complexity = patch.complexity; }
      if (patch.independent !== undefined) { if (typeof patch.independent !== 'boolean') fail('invalid', 'independent 必须为布尔值'); t.independent = patch.independent; }
      if (patch.mode !== undefined) { if (!['inline', 'delegate'].includes(patch.mode)) fail('invalid', '未知执行方式'); t.mode = patch.mode; }
      if (t.complexity === 'high' && t.independent) t.mode = 'delegate';
      if (patch.dependsOn !== undefined) { if (!Array.isArray(patch.dependsOn)) fail('invalid', '依赖必须是数组'); t.dependsOn = patch.dependsOn.map(r => resolveTask(p, r).id); }
      if (patch.parentId !== undefined) {
        if (patch.parentId === null) { if (sid !== p.rootSessionId) fail('forbidden', '只有主会话能移动为根任务'); t.parentId = null; }
        else { const parent = resolveTask(p, patch.parentId); authorize(p, sid, parent); if (parent.status === 'cancelled') fail('cancelled', '不能移动到已取消任务下'); t.parentId = parent.id; }
      }
      validateGraph(p); t.version++; t.attempt = null; t.status = 'paused'; t.history.push({ kind: 'requirements', version: t.version, at: new Date().toISOString() }); if (t.parentId) reopen(p, p.tasks[t.parentId]);
      // Invalidate descendant executions that inherited the old requirements.
      for (const child of descendants(p, t.id)) if (!terminal(child)) { child.version++; child.attempt = null; child.status = 'paused'; }
      stamp(p, 'update', t.id, '要求更新，旧执行结果失效'); return structuredClone(t);
    });
  }
  async cancel(sid, ref, version) {
    return this.change(state => { const p = this.scope(state, sid), t = resolveTask(p, ref); authorize(p, sid, t); if (version !== t.version) fail('stale', '任务版本已变化');
      for (const item of [t, ...descendants(p, t.id)]) { item.status = 'cancelled'; item.version++; item.attempt = null; item.history.push({ kind: 'cancel', at: new Date().toISOString() }); }
      stamp(p, 'cancel', t.id, '保留任务与会话历史'); return structuredClone(t);
    });
  }
  async start(sid, ref) {
    return this.change(state => { const p = this.scope(state, sid), t = resolveTask(p, ref); authorize(p, sid, t);
      if (!['pending', 'paused', 'blocked', 'failed'].includes(t.status)) fail('state', '任务当前不可启动');
      if (!t.dependsOn.every(id => p.tasks[id]?.status === 'completed')) fail('dependency', '前置任务尚未完成');
      for (let ancestor = p.tasks[t.parentId]; ancestor; ancestor = p.tasks[ancestor.parentId]) if (ancestor.mode === 'delegate' && (!ancestor.executionSessionId || !['running', 'awaiting_children'].includes(ancestor.status))) fail('owner', '请先启动负责此事项的父任务，不能将下级会话改挂到主会话');
      for (let ancestor = p.tasks[t.parentId]; ancestor; ancestor = p.tasks[ancestor.parentId]) if (ancestor.mode === 'inline' && !ancestor.attempts) fail('owner', '请先启动父任务，再执行其下级，不能为尚未执行的父事项提前创建会话');
      // Resolve the limit synchronously so the model sees inline in start's result,
      // instead of queueing a child that can never run while its parent waits.
      if (t.complexity === 'high' && t.independent) t.mode = 'delegate';
      if (t.mode === 'delegate' && delegationDepth(p, t) >= this.options.maxDepth) { t.mode = 'inline'; t.executionReason = '达到子会话深度上限，在当前会话执行'; }
      else t.executionReason = t.mode === 'delegate' ? '独立事项，委派子会话执行' : '简单或共享上下文事项，在当前会话执行';
      if (t.mode === 'inline' && ownerOf(p, t) !== sid) fail('forbidden', '请在负责此任务的会话执行');
      const ancestors = new Set(); for (let x = p.tasks[t.parentId]; x; x = p.tasks[x.parentId]) ancestors.add(x.id);
      if (t.mode === 'inline' && Object.values(p.tasks).some(x => x.id !== t.id && !ancestors.has(x.id) && x.executionSessionId === sid && x.mode === 'inline' && x.status === 'running')) fail('busy', '当前会话已有执行事项');
      t.status = t.mode === 'delegate' ? 'queued' : 'running'; t.attempt = { id: randomUUID(), version: t.version, number: ++t.attempts };
      if (t.mode === 'inline') { t.executionSessionId = sid; p.active[sid] = t.id; }
      stamp(p, 'start', t.id, t.mode); return structuredClone(t);
    });
  }
  async bind(planId, taskId, attemptId, childId) {
    return this.change(state => { const p = state.plans[planId], t = p?.tasks[taskId]; if (!t || t.attempt?.id !== attemptId || t.status !== 'queued') fail('stale', '执行已过期');
      if (t.executionSessionId && t.executionSessionId !== childId && t.executionCreated !== false) {
        t.sessionHistory ??= [];
        t.sessionHistory.push({ sessionId: t.executionSessionId, parentSessionId: t.executionParentSessionId || ownerOf(p, t), status: t.report?.status || 'paused' });
      }
      t.executionCreated = false;
      t.executionParentSessionId = ownerOf(p, t); t.status = 'running'; t.executionSessionId = childId; state.sessions[childId] = p.id; p.active[childId] = t.id; stamp(p, 'delegate', t.id, childId);
    });
  }
  async activationReady(planId, taskId, attemptId) { return this.change(state => { const t = state.plans[planId]?.tasks[taskId]; if (t?.attempt?.id === attemptId) t.executionCreated = true; }); }
  async reserveRecord(planId, taskId) {
    return this.change(state => {
      const p = state.plans[planId], t = p?.tasks[taskId];
      if (!t || t.mode !== 'inline') fail('state', '该事项不是行内任务');
      if (!t.attempts) fail('state', '事项尚未执行，不创建子会话');
      const parentSessionId = recordParentOf(p, t);
      if (!parentSessionId) fail('owner', '父事项会话尚未创建，稍后按原层级建立记录');
      if (t.recordSession?.parentSessionId === parentSessionId) return structuredClone(t.recordSession);
      if (t.recordSession) { t.recordHistory ??= []; t.recordHistory.push({ ...t.recordSession, status: t.report?.status || 'paused' }); }
      t.recordSession = { id: randomUUID(), parentSessionId, created: false };
      state.sessions[t.recordSession.id] = p.id;
      return structuredClone(t.recordSession);
    });
  }
  async recordReady(planId, taskId, recordId) { return this.change(state => { const p = state.plans[planId], t = p?.tasks[taskId]; if (t?.recordSession?.id === recordId) { t.recordSession.created = true; delete t.recordError; stamp(p, 'record', taskId, '行内事项子会话记录已保存'); } }); }
  async recordError(planId, taskId, message) { return this.change(state => { const t = state.plans[planId]?.tasks[taskId]; if (t) t.recordError = String(message).slice(0, 1000); }); }
  async assessDecomposition(sid, ref, needsSplit, reason) {
    return this.change(state => {
      const p = this.scope(state, sid), t = resolveTask(p, ref); authorize(p, sid, t);
      if (t.executionSessionId !== sid || !['running', 'awaiting_children'].includes(t.status)) fail('state', '只能判断当前执行会话正在负责的事项');
      if (typeof needsSplit !== 'boolean') fail('invalid', '是否拆解必须为布尔值');
      t.decomposition = { version: t.version, needsSplit, reason: text(reason, '拆解依据', 2000), at: new Date().toISOString() };
      stamp(p, 'assess', t.id, needsSplit ? '模型判定需要拆解下级事项' : '模型判定本层直接执行');
      return { taskId: t.id, ...structuredClone(t.decomposition), message: needsSplit ? '请用 taskflow_add 保存下级事项，然后逐项启动；不要重建主计划' : '本层直接执行，完成后提交实际结果' };
    });
  }
  async wait(sid, ref) { return this.change(state => { const p = this.scope(state, sid), t = resolveTask(p, ref); if (t.executionSessionId !== sid || t.status !== 'running') fail('state', '当前任务未在本会话执行'); t.status = 'awaiting_children'; stamp(p, 'wait', t.id, '等待下级任务，释放并发名额'); }); }
  async resumeWaiting(planId, id) { return this.change(state => { const p = state.plans[planId], t = p.tasks[id]; if (t.status !== 'awaiting_children') return; t.status = 'running'; stamp(p, 'resume', id, '继续本层工作'); }); }
  async settle(sid, ref, attemptId, version, result, fromRuntime = false) {
    return this.change(state => { const p = this.scope(state, sid), t = resolveTask(p, ref); authorize(p, sid, t);
      if (t.version !== version || t.attempt?.id !== attemptId) fail('stale', '旧版本或旧执行结果不能完成当前任务');
      if (t.executionSessionId !== sid) fail('forbidden', '只能由本次执行会话提交结果');
      if (t.mode === 'delegate' && !fromRuntime) fail('final-report', '委派任务请返回最终结构化结果；行内子事项可通过工具完成');
      if (t.status === 'completed' && t.report?.attemptId === attemptId) return structuredClone(t);
      if (!['running', 'awaiting_children'].includes(t.status)) fail('state', '任务当前未在执行');
      if (!['completed', 'failed', 'blocked'].includes(result.status)) fail('invalid', '无效结果状态');
      if (result.status === 'completed' && children(p, t.id).some(c => !terminal(c))) fail('children', '下级任务尚未结束，完成本层剩余工作后再报告');
      const report = { status: result.status, summary: text(result.summary, '完成摘要'), version, attemptId, at: new Date().toISOString() };
      t.report = report; t.history.push(report); t.status = result.status;
      if (p.active[sid] === t.id) { const parent = p.tasks[t.parentId]; if (parent?.executionSessionId === sid && ['running', 'awaiting_children'].includes(parent.status)) p.active[sid] = parent.id; else delete p.active[sid]; }
      if (result.status === 'completed') { const key = `${p.id}:${t.id}:${version}:${attemptId}`; if (!state.outbox.some(n => n.id === key)) state.outbox.push({ id: key, planId: p.id, taskId: t.id, targetSessionId: ownerOf(p, t), report, delivered: false }); }
      stamp(p, result.status, t.id, report.summary); return structuredClone(t);
    });
  }
  async openView(sid, input) {
    return this.change(state => { const p = this.scope(state, sid); if (!['browser', 'editor', 'terminal', 'plugin', 'orchestration'].includes(input.kind)) fail('invalid', '未知工具视图');
      if (input.expectedId && (p.views[sid]?.id !== input.expectedId || (input.requireOpen && !p.views[sid]?.open))) return;
      if (input.url) { const u = new URL(input.url); if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('invalid', '浏览器地址必须为不含凭据的 HTTP(S) URL'); }
      if (input.filePath && !normalizeDocuments(input).some(f => f.path === input.filePath)) fail('invalid', '文件路径必须为支持预览的本地或工作区文档路径');
      p.views[sid] = { id: input.id || randomUUID(), kind: input.kind, title: String(input.title ?? input.kind).slice(0, 240), url: input.url ?? null, files: normalizeDocuments(input), phase: ['running', 'failed'].includes(input.phase) ? input.phase : 'ready', autoOpen: input.autoOpen !== false, sourceTool: String(input.sourceTool ?? '').slice(0, 240), content: String(input.content ?? '').slice(0, 100000), open: true, taskId: currentTask(p, sid)?.id ?? null }; stamp(p, 'tool', p.views[sid].taskId, input.kind);
    });
  }
  async closeView(sid) { return this.change(state => { const p = this.scope(state, sid); if (p.views[sid]) p.views[sid].open = false; }); }
  async focus(sid, ref) { return this.change(state => { const p = this.scope(state, sid), t = resolveTask(p, ref); authorize(p, sid, t); if (ownerOf(p, t) !== sid && t.executionSessionId !== sid) fail('forbidden', '请先切换到此任务负责会话'); p.active[sid] = t.id; }); }
  async reorder(sid, ref, direction, version) {
    return this.change(state => { const p = this.scope(state, sid), t = resolveTask(p, ref); authorize(p, sid, t);
      if (p.version !== version) fail('stale', '计划顺序已变化，请刷新');
      if (![1, -1].includes(direction)) fail('invalid', 'direction 必须为 1 或 -1');
      const all = Object.values(p.tasks), siblings = all.filter(x => x.parentId === t.parentId), target = siblings[siblings.indexOf(t) + direction];
      if (!target) return;
      const a = all.indexOf(t), b = all.indexOf(target); [all[a], all[b]] = [all[b], all[a]];
      p.tasks = Object.fromEntries(all.map(x => [x.id, x])); stamp(p, 'reorder', t.id, direction < 0 ? '同级上移' : '同级下移');
    });
  }
  async recover() { return this.change(state => { for (const p of Object.values(state.plans)) for (const t of Object.values(p.tasks)) if (['running', 'queued', 'awaiting_children'].includes(t.status)) { t.status = 'paused'; t.attempt = null; stamp(p, 'recovery', t.id, '宿主中断，保留计划；需明确继续执行'); } }); }
}
