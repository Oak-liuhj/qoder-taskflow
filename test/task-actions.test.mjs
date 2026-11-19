import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';
import { TaskActions } from '../src/server/task-actions.mjs';

const fixture = async () => {
  const service = new TaskService(new MemoryStore());
  await service.create('main', { title: '恢复执行', goal: '继续既有事项', tasks: [{ title: '父任务', ref: 'p', mode: 'delegate' }, { title: '待恢复', parentId: 'p' }, { title: '其他根任务' }] });
  const parent = await service.start('main', 'T-001'); await service.bind(service.view('main').plan.id, parent.id, parent.attempt.id, 'child');
  await service.settle('child', parent.id, parent.attempt.id, parent.version, { status: 'blocked', summary: '缺少访问方式' }, true);
  return service;
};
test('继续请求恢复冷主会话、保留受阻状态、并发和持久化失败重试不重复入队', async () => {
  const s = await fixture(), inbox = { nextStep: [], nextTurn: [] }; let wakes = 0, resumes = 0, flushes = 0, disposed = 0, live;
  const agent = { inbox, session: { snapshotEvents: () => [] }, followup: message => { wakes++; inbox.nextTurn.push(message); } };
  const ctx = { agents: { get: () => live, resume: async options => { resumes++; assert.equal(options.resumeSessionId, 'main'); await new Promise(r => setTimeout(r, 10)); live = agent; return { agent, dispose: async () => { disposed++; } }; } }, sessions: { flush: async () => ++flushes > 1 } };
  const actions = new TaskActions(ctx, s);
  const first = actions.resume('child', 'T-002', 1), duplicate = actions.resume('child', 'T-002', 1);
  await assert.rejects(first, /持久化/); await assert.rejects(duplicate, /持久化/);
  const accepted = await actions.resume('child', 'T-002', 1);
  assert.equal(accepted.accepted, true); assert.equal(accepted.sessionId, 'main'); assert.equal(resumes, 1); assert.equal(wakes, 1);
  assert.match(inbox.nextTurn[0].content[0].text, /T-001\(blocked,delegate\)/);
  assert.equal(s.view('main').plan.tasks['T-001'].status, 'blocked', '提交指令不伪造执行状态');
  assert.equal(s.view('main').plan.tasks['T-002'].status, 'pending');
  assert.throws(() => actions.resume('child', 'T-003', 1), { code: 'forbidden' });
  assert.throws(() => actions.resume('main', 'T-002', 9), { code: 'stale' });
  await actions.dispose(); assert.equal(disposed, 1);
});
test('恢复失败向调用者报错，不创建幽灵执行，不丢失原报告', async () => {
  const s = await fixture(), before = s.view('main');
  const actions = new TaskActions({ agents: { get: () => undefined, resume: async () => { throw new Error('无法读取会话'); } } }, s);
  await assert.rejects(actions.resume('main', 'T-002', 1), /无法读取会话/);
  assert.deepEqual(s.view('main'), before); await actions.dispose();
});
