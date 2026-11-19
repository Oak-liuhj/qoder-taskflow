import { join } from 'node:path';
import { homedir } from 'node:os';
import { FileStore } from '../storage/task-store.mjs';
import { TaskService } from '../domain/task-service.mjs';
import { TaskRuntime } from '../application/task-runtime.mjs';
import { createNoticeSender } from './notifications.mjs';
import { registerTools } from './tools.mjs';
import { registerSessionContext } from './session-context.mjs';
import { registerToolViews } from './tool-views.mjs';
import { registerRpc } from './rpc.mjs';
import { PlanningCheck } from './planning-check.mjs';
import { TaskActions } from './task-actions.mjs';
import { InlineSessions } from './inline-sessions.mjs';
import { QuickReplies } from './quick-replies.mjs';
export { Config } from './config.mjs';
export const name = 'taskflow';
export const inject = ['tools', 'agents', 'sessions', 'systemPrompt', 'subagents', 'llm'];

// 生命周期装配入口；状态、调度与宿主 API 适配各自独立。
export async function apply(ctx, config = {}) {
  const dataDir = config.dataDir || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'taskflow');
  const store = await new FileStore(dataDir).init();
  let runtime, actions, records, replies, timer;
  ctx.effect(() => async () => { clearInterval(timer); await replies?.dispose(); await runtime?.dispose(); await actions?.dispose(); await records?.dispose(); await store.close(); });
  const service = new TaskService(store, config); await service.recover();
  const log = error => ctx.logger?.warn?.(`taskflow: ${error.message ?? error}`);
  runtime = new TaskRuntime(service, {
    agent: sid => ctx.agents.get(sid), log,
    // DSH 0.2.1-rc.3 accepts a nested request; 0.2.2-rc.2+ uses top-level fields.
    // Supply both shapes in one call so neither host needs a retry or a second activation.
    start: request => ctx.subagents.startActivation({ provider: config.provider || 'spawn', ...request, request, delivery: 'caller' }),
    notify: createNoticeSender(ctx),
    recordResult: notice => records.result(notice),
  });
  const planning = new PlanningCheck(service, config.autoPlan !== false);
  actions = new TaskActions(ctx, service);
  records = new InlineSessions(ctx, service, log);
  replies = new QuickReplies(ctx, service, config.quickReplies !== false);
  ctx.provide('taskflow', { service, runtime, planning, actions, records, replies });
  registerTools(ctx, service, runtime, planning, records);
  registerSessionContext(ctx, service, config, planning);
  registerToolViews(ctx, service, log);
  registerRpc(ctx, service, planning, actions, replies);
  ctx.on('agent/created', () => { runtime.kick(); return undefined; }, { global: true });
  timer = setInterval(() => { runtime.kick(); records.kick(); }, 3000); timer.unref?.();
  records.kick();
  runtime.kick();
}
