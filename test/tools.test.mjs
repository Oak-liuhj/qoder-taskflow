import test from 'node:test';
import assert from 'node:assert/strict';
import { registerTools } from '../src/server/tools.mjs';
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';

function fixture() {
  const service = new TaskService(new MemoryStore()), tools = new Map();
  registerTools({ tools: { register: tool => tools.set(tool.name, tool) } }, service, {});
  const exec = { agent: { session: { id: 'probe' } }, signal: new AbortController().signal };
  return { service, tools, call: (name, args) => tools.get(name).execute(args, exec) };
}

test('工具 schema 明确任务数组、必填标题和修改对象；模型不再收到无类型 JSON 字段', () => {
  const { tools } = fixture();
  for (const name of ['taskflow_plan', 'taskflow_add']) {
    const schema = tools.get(name).parameters.properties.tasks;
    assert.equal(schema.type, 'array'); assert.equal(schema.items.type, 'object');
    assert.deepEqual(schema.items.required, ['title']); assert.equal(schema.items.additionalProperties, false);
    assert.deepEqual(schema.items.properties.complexity.enum, ['low', 'medium', 'high']);
  }
  assert.equal(tools.get('taskflow_update').parameters.properties.patch.type, 'object');
});

test('回放 Qoder 会话的字符串 tasks：真实 defineTool 校验后创建、增补、字符串 patch 修改', async () => {
  const { call, service } = fixture();
  await call('taskflow_plan', { title: 'probe plan', goal: 'probe', tasks: '[{"title": "probe task", "complexity": "low", "independent": false}]' });
  assert.equal(Object.keys(service.view('probe').plan.tasks).length, 1);
  await call('taskflow_add', { tasks: '[{"title":"下级","parentId":"T-001"}]' });
  await call('taskflow_update', { taskId: 'T-002', version: 1, patch: '{"title":"调整下级","parentId":null}' });
  const plan = service.view('probe').plan;
  assert.equal(plan.tasks['T-002'].title, '调整下级'); assert.equal(plan.tasks['T-002'].parentId, null);
  await assert.rejects(call('taskflow_plan', { title: '覆盖', goal: 'x', tasks: [{ title: '不应覆盖' }] }), /计划已存在/);
  assert.equal(service.view('probe').plan.id, plan.id);
});

test('畸形或多层 JSON、错误字段类型和未知属性不写入账本', async () => {
  const { call, service } = fixture();
  for (const tasks of ['[', '"[]"', '{}', 'null', [], [{}], [{ title: 'x', independent: 'false' }], [{ title: 'x', unexpected: 1 }]]) {
    const before = service.store.read();
    await assert.rejects(call('taskflow_plan', { title: 'x', goal: 'x', tasks }));
    assert.deepEqual(service.store.read(), before);
  }
  await call('taskflow_plan', { title: '有效', goal: '有效', tasks: [{ title: '任务' }] });
  for (const patch of ['[]', '"{}"', '{', { unknown: true }, {}]) {
    const before = service.store.read();
    await assert.rejects(call('taskflow_update', { taskId: 'T-001', version: 1, patch }));
    assert.deepEqual(service.store.read(), before);
  }
});
