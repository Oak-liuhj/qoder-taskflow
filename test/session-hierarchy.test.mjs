import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';
import { TaskRuntime } from '../src/application/task-runtime.mjs';
import { sessionTree, sessionPath, executionLabel, taskTarget } from '../src/client/model.mjs';

test('导入开发的独立阶段是同级依赖；T002/T005/T006 均可在主会话下创建', async () => {
  const service = new TaskService(new MemoryStore()), calls = [], notifications = [];
  const stages = ['勘察', '设计与接口约定', '文件校验', '导入保存', '用户入口', '整体验证'];
  const plan = await service.create('main', { title: '导入开发', goal: '实现并验证', tasks: stages.map((title, i) => ({ title, ref: `stage${i}`, parentId: null, dependsOn: i ? [`stage${i - 1}`] : [], complexity: 'medium', independent: true, mode: 'delegate' })) });
  const runtime = new TaskRuntime(service, { agent: id => ({ session: { id } }), notify: n => { notifications.push(n); return true; }, start: async r => { calls.push(r); return { childId: r.childId, result: Promise.resolve({ stopReason: 'completed', structured: { status: 'completed', summary: '固定响应完成' } }), dispose: async () => {} }; } });
  try {
    for (const id of Object.keys(plan.tasks)) {
      await service.start('main', id);
      const deadline = Date.now() + 3000;
      while (service.view('main').plan.tasks[id].status !== 'completed') { assert.ok(Date.now() < deadline, '调度超时'); await new Promise(resolve => setTimeout(resolve, 5)); }
    }
    const current = service.view('main').plan;
    assert.equal(calls.length, 6); assert.ok(calls.every(r => r.parent.session.id === 'main'));
    assert.equal(sessionTree(current).length, 6);
    for (const id of ['T-002', 'T-005', 'T-006']) assert.equal(current.tasks[id].executionParentSessionId, 'main');
    await runtime.deliver(); assert.equal(notifications.length, 6); assert.ok(notifications.every(n => n.targetSessionId === 'main'));
  } finally { await runtime.dispose(); }
});

test('父子与前置依赖冲突时给出改为同级的提示，失败不写入计划', async () => {
  const service = new TaskService(new MemoryStore()), before = service.store.read();
  await assert.rejects(service.create('main', { title: '导入', goal: '验证', tasks: [{ ref: 'survey', title: '勘察' }, { title: '设计', parentId: 'survey', dependsOn: ['survey'] }] }), /parentId.*dependsOn.*同级/);
  assert.deepEqual(service.store.read(), before);
});

test('回放混合行内与委派的历史计划：不补建假会话，显示真实归属和返回父会话', () => {
  const plan = { rootSessionId: 'main', title: '导入开发', tasks: {} };
  const add = (id, title, parentId, mode, sid, parentSid) => { plan.tasks[id] = { id, title, parentId, mode, status: 'completed', executionSessionId: sid, executionParentSessionId: parentSid, executionCreated: true }; };
  add('T-001', '勘察', null, 'delegate', 'survey', 'main');
  add('T-002', '设计', 'T-001', 'inline', 'survey');
  add('T-003', '校验', 'T-002', 'delegate', 'validation', 'survey');
  add('T-004', '保存', 'T-002', 'delegate', 'saving', 'survey');
  add('T-005', '入口', 'T-004', 'inline', 'saving');
  add('T-006', '验证', 'T-005', 'inline', 'saving');
  const before = structuredClone(plan), tree = sessionTree(plan);
  assert.equal(tree.length, 1); assert.deepEqual(tree[0].children.map(t => t.id), ['T-003', 'T-004']);
  assert.deepEqual(sessionPath(plan, 'saving').map(t => t.sessionId), ['main', 'survey', 'saving']);
  assert.equal(executionLabel(plan, plan.tasks['T-002'], 'main'), '在 T-001 会话内执行');
  assert.equal(executionLabel(plan, plan.tasks['T-005'], 'main'), '在 T-004 会话内执行');
  assert.equal(executionLabel(plan, plan.tasks['T-006'], 'saving'), '本会话内执行');
  assert.deepEqual(taskTarget(plan, plan.tasks['T-006']), { parentSessionId: 'survey', childSessionId: 'saving', mode: 'unknown' });
  assert.deepEqual(plan, before);
});
