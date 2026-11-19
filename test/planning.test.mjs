import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanningCheck } from '../src/server/planning-check.mjs';
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';

test('规划检查按会话/轮次隔离：先判断后执行、提问暂停、取消不重试、已有计划不改写', async () => {
  const service = new TaskService(new MemoryStore()), check = new PlanningCheck(service);
  const steering = [], agent = { session: { id: 'main' }, steer: m => steering.push(m) }, other = { session: { id: 'other' } };
  const user = [{ source: { kind: 'user' } }];
  assert.equal(check.enter(other, 1, [{ source: { kind: 'system' } }]), null);
  check.enter(agent, 1, user);
  assert.match(check.guard({ agent, name: 'write' }), /尚未建立任务清单/);
  check.assess(agent, false, '只是一个简短问题');
  assert.equal(check.guard({ agent, name: 'write' }), undefined);
  check.stopping(agent, 1); assert.equal(steering.length, 0);
  check.enter(agent, 2, user); check.assess(agent, true, '涉及独立步骤');
  assert.match(check.guard({ agent, name: 'write' }), /尚未建立任务清单/);
  check.stopping(agent, 2, { aborted: true }); assert.equal(steering.length, 0);
  assert.equal(check.guard({ agent, name: 'ask_user_question' }), undefined);
  check.stopping(agent, 2); assert.equal(steering.length, 0);
  check.enter(agent, 2, []);
  assert.equal(check.view('main').phase, 'assessing', '提问完成后恢复规划检查');
  check.enter(agent, 3, user); check.stopping(agent, 3); assert.equal(steering.length, 1);
  await service.create('main', { title: '有效', goal: '实际目标', tasks: [{ title: '待办' }] });
  const before = service.store.read(); check.stopping(agent, 3);
  assert.equal(steering.length, 1); assert.equal(check.view('main'), null); assert.deepEqual(service.store.read(), before);
  check.forget(agent); assert.equal(check.states.has(agent), false);
});

test('规划检查最多两次结束重试及四个规划步骤；禁用自动规划时不拦截', () => {
  const service = new TaskService(new MemoryStore()), check = new PlanningCheck(service);
  const steering = [], agent = { session: { id: 'main' }, steer: m => steering.push(m) };
  const user = [{ source: { kind: 'user' } }];
  for (let i = 0; i < 10; i++) { check.enter(agent, 1, user); check.stopping(agent, 1); }
  assert.equal(steering.length, 2); assert.equal(check.view('main').phase, 'blocked');
  assert.match(check.view('main').message, /停止自动重试/);
  const disabled = new PlanningCheck(service, false);
  assert.equal(disabled.enter(agent, 2, user), null);
  assert.equal(disabled.guard({ agent, name: 'write' }), undefined);
  disabled.stopping(agent, 2); assert.equal(disabled.view('main'), null);
});

test('已有计划的每层中高复杂度事项仍需判断，判断持久化并在要求变更后失效', async () => {
  const store = new MemoryStore(), service = new TaskService(store), check = new PlanningCheck(service);
  const agent = { session: { id: 'main' }, steer() {} };
  await service.create('main', { title: '执行前拆解', goal: '按需递归', tasks: [{ title: '复杂入口', complexity: 'medium' }] });
  await service.start('main', 'T-001'); check.enter(agent, 1, []);
  assert.equal(check.view('main').taskId, 'T-001'); assert.match(check.guard({ agent, name: 'write' }), /执行前/);
  assert.equal(check.guard({ agent, name: 'taskflow_add' }), undefined);
  await check.assess(agent, true, '入口包含可独立验收的多个功能', 'T-001');
  assert.match(check.guard({ agent, name: 'write' }), /执行前/, '声称需要拆解但未落账不能直接执行');
  await service.add('main', [{ title: '表单处理', complexity: 'medium' }], 'T-001');
  assert.equal(check.guard({ agent, name: 'write' }), undefined);
  await service.start('main', 'T-002'); check.enter(agent, 1, []);
  assert.equal(check.view('main').taskId, 'T-002', '子项同样需要再次判断');
  await check.assess(agent, false, '仅有一个输入校验动作，可直接完成', 'T-002');
  const restored = new PlanningCheck(new TaskService(new MemoryStore(store.read())));
  assert.equal(restored.taskToAssess(agent), null, '重载不重复判断相同版本');
  const task = service.view('main').plan.tasks['T-002'];
  await service.update('main', task.id, { instructions: '新增文件上传及重试能力' }, task.version); await service.start('main', task.id);
  assert.equal(check.taskToAssess(agent).id, 'T-002', '新要求重新判断');
  await assert.rejects(service.assessDecomposition('unrelated', 'T-001', false, '越权判断'), /尚未建立/);
});

test('拆解判断不收敛时有限重试，并将行内事项保存为可继续的受阻状态', async () => {
  const service = new TaskService(new MemoryStore()), check = new PlanningCheck(service), notices = [];
  const agent = { session: { id: 'main' }, steer: m => notices.push(m) };
  await service.create('main', { title: '有界判断', goal: '避免显示永久执行中', tasks: [{ title: '入口实现', complexity: 'medium' }] });
  const original = await service.start('main', 'T-001');
  for (let i = 0; i < 6; i++) { check.enter(agent, 1, []); check.stopping(agent, 1); }
  assert.equal(notices.length, 2); assert.equal(check.view('main').phase, 'blocked');
  await check.pauseBlocked(agent); const task = service.view('main').plan.tasks['T-001'];
  assert.equal(task.status, 'blocked'); assert.match(task.report.summary, /拆解判断未完成/);
  const retry = await service.start('main', task.id); assert.notEqual(retry.attempt.id, original.attempt.id);
  check.enter(agent, 2, []); assert.equal(check.view('main').phase, 'assessing');
});
