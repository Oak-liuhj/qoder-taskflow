export const STATUS = { pending: '待执行', queued: '排队中', running: '进行中', awaiting_children: '等待下级', paused: '已暂停', blocked: '受阻', failed: '失败', completed: '已完成', cancelled: '已取消' };
export const TOOL_NAMES = { browser: '浏览器', editor: '编辑器', terminal: '终端', plugin: '插件', orchestration: '编排' };
export function taskOwner(plan, task) { const parent = plan.tasks[task.parentId]; return parent ? parent.mode === 'delegate' && parent.executionSessionId ? parent.executionSessionId : taskOwner(plan, parent) : plan.rootSessionId; }
export function taskTarget(plan, task) {
  if (task.mode === 'delegate' && task.executionSessionId && task.executionCreated !== false) return { parentSessionId: task.executionParentSessionId || taskOwner(plan, task), childSessionId: task.executionSessionId, mode: 'unknown' };
  if (task.recordSession?.created) return { parentSessionId: task.recordSession.parentSessionId, childSessionId: task.recordSession.id, mode: 'one-shot' };
  const owner = taskOwner(plan, task);
  const parent = Object.values(plan.tasks).find(t => t.mode === 'delegate' && t.executionSessionId === owner);
  return parent ? taskTarget(plan, parent) : owner;
}
export function executionTarget(plan, task) {
  const sid = task.executionSessionId || taskOwner(plan, task);
  const parent = Object.values(plan.tasks).find(t => t.mode === 'delegate' && t.executionSessionId === sid);
  return parent ? taskTarget(plan, parent) : sid;
}
export function sessionTree(plan) {
  if (!plan) return [];
  const nodes = Object.values(plan.tasks).flatMap(t => [
    ...(t.sessionHistory ?? []).map(h => ({ ...t, title: `${t.title}（历史执行）`, status: h.status, executionSessionId: h.sessionId, target: { parentSessionId: h.parentSessionId, childSessionId: h.sessionId, mode: 'unknown' }, children: [] })),
    ...(t.mode === 'delegate' && t.executionSessionId && t.executionCreated !== false ? [{ ...t, target: taskTarget(plan, t), children: [] }] : []),
    ...[...(t.recordHistory ?? []), ...(t.recordSession ? [t.recordSession] : [])].filter(r => r.created && t.attempts > 0).map(r => ({ ...t, title: r === t.recordSession && t.mode === 'inline' ? t.title : `${t.title}（历史执行记录）`, status: r === t.recordSession && t.mode === 'inline' ? t.status : r.status || t.report?.status || 'paused', executionSessionId: r.id, target: { parentSessionId: r.parentSessionId, childSessionId: r.id, mode: 'one-shot' }, children: [] })),
  ]);
  const bySession = new Map(nodes.map(t => [t.executionSessionId, t])), roots = [];
  for (const t of nodes) { const parent = bySession.get(t.target.parentSessionId); (parent && parent !== t ? parent.children : roots).push(t); }
  return roots;
}
export function sessionPath(plan, sessionId) {
  if (!plan) return [];
  const root = { sessionId: plan.rootSessionId, title: plan.title, target: plan.rootSessionId };
  const find = (nodes, path) => {
    for (const t of nodes) {
      const next = [...path, { sessionId: t.executionSessionId, title: `${t.id} ${t.title}`, target: t.target }];
      if (t.executionSessionId === sessionId) return next;
      const found = find(t.children, next); if (found) return found;
    }
  };
  return sessionId === root.sessionId ? [root] : find(sessionTree(plan), [root]) ?? [];
}
export function executionLabel(plan, task, sessionId) {
  if (task.mode === 'delegate') return task.executionSessionId && task.executionCreated !== false ? '独立子会话' : '按需委派';
  const owner = taskOwner(plan, task);
  if (owner === sessionId) return '本会话内执行';
  const parent = Object.values(plan.tasks).find(t => t.mode === 'delegate' && t.executionSessionId === owner);
  return parent ? `在 ${parent.id} 会话内执行` : '在主会话内执行';
}
export function visibleTree(plan, { filter = 'all', scope = 'global', sessionId } = {}) {
  if (!plan) return [];
  const all = Object.values(plan.tasks), kept = new Set();
  const matches = t => (filter === 'all' || (filter === 'active' ? !['completed', 'cancelled'].includes(t.status) : t.status === filter)) && (scope === 'global' || t.executionSessionId === sessionId || t.recordSession?.id === sessionId || t.recordHistory?.some(r => r.id === sessionId) || (t.parentId ? plan.tasks[t.parentId].executionSessionId : plan.rootSessionId) === sessionId);
  for (const t of all.filter(matches)) { for (let x = t; x; x = plan.tasks[x.parentId]) { if (kept.has(x.id)) break; kept.add(x.id); } }
  const walk = parentId => all.filter(t => t.parentId === parentId && kept.has(t.id)).map(t => ({ ...t, children: walk(t.id) }));
  return walk(null);
}
export function progress(plan) { const roots = Object.values(plan?.tasks ?? {}).filter(t => t.parentId === null && t.status !== 'cancelled'); const done = roots.filter(t => t.status === 'completed').length; return { done, total: roots.length, percent: roots.length ? Math.round(done / roots.length * 100) : 0 }; }
