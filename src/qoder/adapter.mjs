import { TaskflowError, resolveTask, ownerOf } from '../domain/task-service.mjs';
import { randomUUID } from 'node:crypto';
import { withService } from './store.mjs';

const fail = (code, message) => { throw new TaskflowError(code, message); };
const live = (s, a) => {
  const p = s.scope(s.store.read(), a.sessionId), t = resolveTask(p, a.taskId);
  if (t.version !== a.version || t.attempt?.id !== a.attemptId) fail('stale', '任务版本或本次执行已失效');
  if (t.executionSessionId !== a.sessionId || !['running', 'awaiting_children'].includes(t.status)) fail('forbidden', '只能报告本会话当前执行的任务');
  return { p, t };
};
const hasSlot = (s, p, except) => Object.values(p.tasks).filter(t => t.id !== except && t.mode === 'delegate' && t.status === 'running').length < s.options.maxConcurrent;
const noticeCurrent = (state, n) => {
  const t = state.plans[n.planId]?.tasks[n.taskId];
  return t?.status === 'completed' && t.version === n.report.version && t.attempt?.id === n.report.attemptId;
};
const stamp = (p, kind, taskId, detail) => {
  p.version++; p.updatedAt = new Date().toISOString();
  p.events.push({ id: randomUUID(), kind, taskId, detail, at: p.updatedAt });
  p.events = p.events.slice(-500);
};

export async function execute(directory, name, a) {
  return withService(directory, async s => {
    switch (name) {
      case 'taskflow_status': case 'taskflow_panel': {
        const state = s.store.read();
        if (name === 'taskflow_panel' && !a.sessionId) return {
          plans: Object.values(state.plans).map(p => ({ title: p.title, sessionId: p.rootSessionId, updatedAt: p.updatedAt }))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        };
        return { ...s.view(a.sessionId), sessionId: a.sessionId,
          notifications: state.outbox.filter(n => n.targetSessionId === a.sessionId && !n.delivered && noticeCurrent(state, n)),
          capabilities: {
            panel: 'mcp-apps', delegation: 'qoder-native-chat-session',
            plugin: { nativeSidebar: false, nativeRecordSessions: false, automaticWake: false },
            host: { nativeChatSessions: 'discover-tools', completionDelivery: 'supervise; wait/read fallback' },
            // Plugin integration limits are not evidence of host tool limits.
          } };
      }
      case 'taskflow_plan': return s.create(a.sessionId, a);
      case 'taskflow_attach': return s.change(state => {
        if (Object.hasOwn(state.sessions, a.sessionId)) fail('exists', '当前会话已有关联计划');
        const p = s.scope(state, a.planSessionId);
        // An alias can observe old work, but cannot impersonate its executor.
        // New session resumption is explicit: change the root only when no
        // descendant is active, invalidating all unfinished attempts.
        if (a.planSessionId !== p.rootSessionId) fail('forbidden', '请使用旧计划的根会话 ID');
        if (Object.values(p.tasks).some(t => ['running', 'queued', 'awaiting_children'].includes(t.status))) fail('busy', '旧计划仍有执行事项；请在原负责会话暂停后接续');
        p.qoderPreviousRoots ??= []; p.qoderPreviousRoots.push(p.rootSessionId);
        for (const notice of state.outbox) if (notice.planId === p.id && notice.targetSessionId === p.rootSessionId && !notice.delivered) notice.targetSessionId = a.sessionId;
        // Preserve historical task execution identities and completed reports.
        p.rootSessionId = a.sessionId; state.sessions[a.sessionId] = p.id; p.active = {};
        stamp(p, 'qoder-attach', null, '明确接续旧计划，保留任务结果和历史执行身份');
        return structuredClone(p);
      });
      case 'taskflow_add': {
        if (a.parentId !== null) return s.add(a.sessionId, a.tasks, a.parentId, a.planVersion);
        return s.change(state => {
          const p = s.scope(state, a.sessionId);
          if (a.sessionId !== p.rootSessionId) fail('forbidden', '只有根会话可以明确新增根事项');
          if (a.planVersion != null && p.version !== a.planVersion) fail('stale', '计划已变化');
          const result = s.insert(p, a.sessionId, a.tasks, null);
          stamp(p, 'add', null, result.map(t => t.id).join(', '));
          return result;
        });
      }
      case 'taskflow_update': return s.update(a.sessionId, a.taskId, a.patch, a.version);
      case 'taskflow_cancel': return s.cancel(a.sessionId, a.taskId, a.version);
      case 'taskflow_focus': await s.focus(a.sessionId, a.taskId); return s.view(a.sessionId);
      case 'taskflow_reorder': await s.reorder(a.sessionId, a.taskId, a.direction, a.planVersion); return s.view(a.sessionId);
      case 'taskflow_start': {
        const t = await s.start(a.sessionId, a.taskId), p = s.view(a.sessionId).plan;
        return { task: t, dispatch: t.mode === 'delegate' ? {
          planSessionId: ownerOf(p, t), taskId: t.id, attemptId: t.attempt.id, version: t.version,
          instructions: t.instructions, criteria: t.criteria, goal: p.goal,
          dependencies: t.dependsOn.map(id => ({ id, report: p.tasks[id].report })),
          title: `${t.id} ${t.title}`,
          execution: { kind: 'native-chat-session', visible: true, createTool: 'create_chat_session', callbackMode: 'supervise', waitTool: 'wait_chat_sessions', readTool: 'read_chat_session', allowEmbeddedAgent: false },
          workerInstructions: '你是此 dispatch 的独立聊天子会话，只执行该事项。使用自己的 SessionStart/UserPromptSubmit Hook 提供的真实 session_id 作为 sessionId，与 dispatch 一致的 projectPath；不要使用父会话身份或创建自己的新计划。先 taskflow_claim，传 planSessionId、taskId、attemptId、version、自己的 sessionId、projectPath；成功后 taskflow_status 读取要求和依赖结果。中高复杂度先 taskflow_assess，按需保存实际拆解。taskflow_progress 保存公开操作和验证，不存私有推理。最后 taskflow_complete 按原 attemptId/version 保存 completed/blocked/failed 及证据；保存成功才返回最终摘要。缺真实身份/路径或认领失败时停止并报告，不得伪造。遵守父任务的执行约束。',
          instruction: '发现并读取 Qoder 原生 create_chat_session 工具的实际 schema（可能带 mcp__builtin__ 前缀），用自包含 prompt 传完整 dispatch 和 workerInstructions，callbackMode:supervise，创建并启动左侧可见的独立聊天子会话。使用相同项目；已注册项目先 list_workspaces 匹配真实 workspaceId，当前默认工作区可按宿主说明省略 workspaceId。不可用 Agent/general-purpose/taskflow-worker 替代可见会话，不猜参数或 ID。保留宿主返回的 sessionId/sessionRef，以 supervise 接收结果；疑似回调遗漏用 wait_chat_sessions(timeoutMs:0) 检查，read_chat_session 读取结果，再读取 Taskflow 通知并确认。创建或 idle 不等于任务完成。工具缺失或确定创建失败时明确报告，由父会话 taskflow_pause 留证，重试前重新 start；创建结果不确定时先查已有会话，不能重复创建；父会话不能代为 claim/complete。'
        } : null };
      }
      case 'taskflow_claim': {
        const p = s.scope(s.store.read(), a.planSessionId), t = resolveTask(p, a.taskId);
        if (a.sessionId === a.planSessionId || Object.hasOwn(s.store.read().sessions, a.sessionId) && t.executionSessionId !== a.sessionId) fail('forbidden', '需要未被其他任务占用的真实子会话身份');
        if (t.attempt?.id !== a.attemptId || t.version !== a.version) fail('stale', '委派尝试已失效');
        if (ownerOf(p, t) !== a.planSessionId || t.mode !== 'delegate') fail('forbidden', '委派事项不属于指定父会话');
        if (t.executionSessionId === a.sessionId && t.status === 'running') return t;
        if (t.status !== 'queued') fail('state', '该事项不在等待认领');
        if (!hasSlot(s, p)) fail('concurrency', '全树并发已满，请等待已有事项完成');
        await s.bind(p.id, t.id, a.attemptId, a.sessionId);
        await s.activationReady(p.id, t.id, a.attemptId);
        return s.view(a.sessionId).plan.tasks[t.id];
      }
      case 'taskflow_assess': live(s, a); return s.assessDecomposition(a.sessionId, a.taskId, a.needsSplit, a.reason);
      case 'taskflow_progress': {
        live(s, a);
        return s.change(state => {
          const p = s.scope(state, a.sessionId), t = resolveTask(p, a.taskId);
          const record = { kind: 'qoder-progress', attemptId: a.attemptId, version: a.version, summary: a.summary, at: new Date().toISOString() };
          t.history.push(record); stamp(p, 'qoder-progress', t.id, '公开执行记录已保存'); return record;
        });
      }
      case 'taskflow_complete': {
        const p = s.scope(s.store.read(), a.sessionId), t = resolveTask(p, a.taskId);
        if (t.executionSessionId !== a.sessionId) fail('forbidden', '只能由真实执行 Agent 提交最终结果');
        return s.settle(a.sessionId, a.taskId, a.attemptId, a.version, { status: a.status, summary: a.summary }, t.mode === 'delegate');
      }
      case 'taskflow_wait': live(s, a); await s.wait(a.sessionId, a.taskId); return s.view(a.sessionId);
      case 'taskflow_resume': {
        const { p, t } = live(s, a);
        if (t.status !== 'awaiting_children') fail('state', '事项未在等待下级');
        if (Object.values(p.tasks).some(c => c.parentId === t.id && !['completed', 'cancelled'].includes(c.status))) fail('children', '下级事项尚未结束');
        if (t.mode === 'delegate' && !hasSlot(s, p, t.id)) fail('concurrency', '全树并发已满');
        await s.resumeWaiting(p.id, t.id); return s.view(a.sessionId);
      }
      case 'taskflow_pause': return s.change(state => {
        const p = s.scope(state, a.sessionId), t = resolveTask(p, a.taskId);
        if (![p.rootSessionId, t.executionSessionId, ownerOf(p, t)].includes(a.sessionId)) fail('forbidden', '只能暂停本层负责的任务');
        if (t.version !== a.version) fail('stale', '任务版本已变化');
        if (!['running', 'queued', 'awaiting_children'].includes(t.status)) fail('state', '事项未在执行');
        const pause = item => {
          if (['running', 'queued', 'awaiting_children'].includes(item.status)) {
            item.status = 'paused'; item.attempt = null;
            item.history.push({ kind: 'qoder-pause', summary: a.reason, at: new Date().toISOString() });
          }
          for (const child of Object.values(p.tasks).filter(c => c.parentId === item.id)) pause(child);
        };
        pause(t); stamp(p, 'qoder-pause', t.id, a.reason); return structuredClone(t);
      });
      case 'taskflow_notifications': return s.change(state => {
        const notices = state.outbox.filter(n => n.targetSessionId === a.sessionId && !n.delivered && noticeCurrent(state, n));
        for (const id of a.ack ?? []) {
          const n = notices.find(n => n.id === id); if (!n) fail('not-found', '通知不存在、已过期或不属于当前会话'); n.delivered = true;
        }
        return { notifications: notices.filter(n => !n.delivered) };
      });
      default: fail('not-found', `未知工具：${name}`);
    }
  });
}
