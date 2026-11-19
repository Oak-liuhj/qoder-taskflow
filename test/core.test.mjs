import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FileStore, MemoryStore } from '../src/storage/task-store.mjs';
import { TaskService } from '../src/domain/task-service.mjs';
import { TaskRuntime } from '../src/application/task-runtime.mjs';
import { visibleTree, sessionTree } from '../src/client/model.mjs';

const make = (options = {}) => new TaskService(new MemoryStore(), options);
const plan = (s, tasks) => s.create('main', { title: '知识库升级', goal: '实现导入与检索', tasks });
const task = (title, extra = {}) => ({ title, ...extra });
const until = async (fn, timeout = 3000) => { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error('Condition timed out'); await new Promise(r => setTimeout(r, 5)); } };
const finish = (s, sid, t, summary = '实际结果已保存') => s.settle(sid, t.id, t.attempt.id, t.version, { status: 'completed', summary });

test('子会话最终结果未持久化时不通知父任务，重试保存成功后仅发送完成摘要', async () => {
  const s = make(); await plan(s, [task('行内结果')]); const t = await s.start('main', 'T-001'); await finish(s, 'main', t, '最终结果');
  const order = []; let durable = false;
  const runtime = new TaskRuntime(s, { recordResult: async () => { order.push('save'); return durable; }, notify: async notice => { order.push('notify'); assert.equal(notice.report.summary, '最终结果'); return true; } });
  try {
    await runtime.deliver(); assert.deepEqual(order, ['save']); assert.equal(s.store.read().outbox[0].delivered, false);
    durable = true; await runtime.deliver(); assert.deepEqual(order, ['save', 'save', 'notify']); assert.equal(s.store.read().outbox[0].delivered, true);
    await runtime.deliver(); assert.equal(order.length, 3);
  } finally { await runtime.dispose(); }
});

test('持久计划跨轮保持，不能被第二次规划覆盖', async () => {
  const s = make(); await plan(s, [task('分析'), task('实现')]); const initial = s.view('main');
  for (let i = 0; i < 20; i++) assert.deepEqual(s.view('main'), initial);
  await assert.rejects(plan(s, [task('覆盖')]), { code: 'exists' }); assert.deepEqual(s.view('main'), initial);
});
test('低复杂度行内、高复杂度独立事项按需委派', async () => {
  const s = make(); await plan(s, [task('轻量'), task('复杂', { complexity: 'high', independent: true })]);
  const tasks = Object.values(s.view('main').plan.tasks); assert.equal(tasks[0].mode, 'inline'); assert.equal(tasks[1].mode, 'delegate');
});
test('ID 稳定：修改标题不生成重复节点；不影响兄弟事项', async () => {
  const s = make(); await plan(s, [task('旧名'), task('兄弟')]); const sibling = s.view('main').plan.tasks['T-002'];
  const updated = await s.update('main', 'T-001', { title: '新名' }, 1); assert.equal(updated.id, 'T-001'); assert.equal(updated.version, 2); assert.deepEqual(s.view('main').plan.tasks['T-002'], sibling);
});
test('当前任务增补和主会话按 ID / 名称指定增补保留归属', async () => {
  const s = make(); await plan(s, [task('当前'), task('目标')]); await s.start('main', 'T-001');
  const [a] = await s.add('main', [task('默认子项')]); const [b] = await s.add('main', [task('指定子项')], 'T-002'); const [c] = await s.add('main', [task('名称子项')], '目标');
  assert.equal(a.parentId, 'T-001'); assert.equal(b.parentId, 'T-002'); assert.equal(c.parentId, 'T-002');
});
test('歧义名称、未知父任务和循环不静默改挂，事务回滚', async () => {
  const s = make(); await plan(s, [task('重复'), task('重复')]); const before = s.view('main');
  await assert.rejects(s.add('main', [task('错误')], '重复'), { code: 'ambiguous' });
  await assert.rejects(s.add('main', [task('错误')], 'T-999'), { code: 'not-found' });
  await assert.rejects(s.update('main', 'T-001', { parentId: 'T-001' }, 1), { code: 'cycle' }); assert.deepEqual(s.view('main'), before);
});
test('依赖图验证与执行顺序，取消不作为依赖完成', async () => {
  const s = make(); await assert.rejects(plan(s, [task('a', { ref: 'a', dependsOn: ['b'] }), task('b', { ref: 'b', dependsOn: ['a'] })]), { code: 'cycle' });
  await plan(s, [task('a', { ref: 'a' }), task('b', { dependsOn: ['a'] })]); await assert.rejects(s.start('main', 'T-002'), { code: 'dependency' });
  await s.cancel('main', 'T-001', 1); await assert.rejects(s.start('main', 'T-002'), { code: 'dependency' });
});
test('修改要求拦截旧版本和旧执行结果', async () => {
  const s = make(); await plan(s, [task('实现')]); const old = await s.start('main', 'T-001'); await s.update('main', 'T-001', { instructions: '新增 PDF 支持' }, 1);
  await assert.rejects(finish(s, 'main', old), { code: 'stale' }); const next = await s.start('main', 'T-001'); assert.notEqual(old.attempt.id, next.attempt.id); await finish(s, 'main', next); assert.equal(s.view('main').plan.tasks['T-001'].status, 'completed');
});
test('完成即勾选，无父审批；通知事件幂等', async () => {
  const s = make(); await plan(s, [task('实现')]); const t = await s.start('main', 'T-001'); await finish(s, 'main', t); await finish(s, 'main', t);
  assert.equal(s.view('main').plan.tasks[t.id].status, 'completed'); assert.equal(s.store.read().outbox.length, 1); assert.equal(s.store.read().outbox[0].targetSessionId, 'main');
});
test('增补已完成任务重新打开祖先，保留历史报告', async () => {
  const s = make(); await plan(s, [task('父项', { ref: 'p' }), task('子项', { parentId: 'p' })]); const parent = await s.start('main', 'T-001'); const t = await s.start('main', 'T-002'); await finish(s, 'main', t); await finish(s, 'main', parent);
  await s.add('main', [task('增补')], 'T-002'); const p = s.view('main').plan; assert.equal(p.tasks['T-001'].status, 'pending'); assert.equal(p.tasks['T-002'].status, 'pending'); assert.ok(p.tasks['T-001'].report); assert.equal(p.tasks['T-002'].version, 2);
});
test('未完成下级阻止父任务提前完成，失败与暂停不显示完成', async () => {
  const s = make(); await plan(s, [task('父项', { ref: 'p' }), task('子项', { parentId: 'p' })]); const t = await s.start('main', 'T-001'); await assert.rejects(finish(s, 'main', t), { code: 'children' }); assert.equal(s.view('main').plan.tasks[t.id].status, 'running');
});
test('取消整棵子树，保留历史并拦截迟到结果', async () => {
  const s = make(); await plan(s, [task('父', { ref: 'p' }), task('子', { parentId: 'p' })]); await s.start('main', 'T-001'); const t = await s.start('main', 'T-002'); await s.cancel('main', 'T-001', 1); await assert.rejects(finish(s, 'main', t), { code: 'stale' }); assert.equal(Object.values(s.view('main').plan.tasks).filter(t => t.status === 'cancelled').length, 2);
});
test('子会话只能改自己的子树，不能修改兄弟或主任务', async () => {
  const s = make(); const p = await plan(s, [task('委派', { mode: 'delegate' }), task('兄弟')]); const t = await s.start('main', 'T-001'); await s.bind(p.id, t.id, t.attempt.id, 'child');
  const [added] = await s.add('child', [task('孙事项')]); assert.equal(added.parentId, t.id);
  await assert.rejects(s.update('child', 'T-002', { title: '越权' }, 1), { code: 'forbidden' });
});
test('多次并发增补不会丢任务，版本冲突明确拒绝', async () => {
  const s = make(); await plan(s, [task('主项')]); await Promise.all(Array.from({ length: 12 }, (_, n) => s.add('main', [task(`子项 ${n}`)], 'T-001'))); assert.equal(Object.keys(s.view('main').plan.tasks).length, 13);
  await assert.rejects(s.add('main', [task('过期')], 'T-001', 1), { code: 'stale' });
});
test('工具默认关闭、按会话保存，拒绝非 HTTP 地址', async () => {
  const s = make(); await plan(s, [task('任务')]); assert.equal(s.view('main').tool, null); await s.openView('main', { kind: 'browser', url: 'https://example.com' }); assert.equal(s.view('main').tool.open, true); await s.closeView('main'); assert.equal(s.view('main').tool.open, false); assert.equal(s.view('main').tool.url, 'https://example.com');
  await assert.rejects(s.openView('main', { kind: 'browser', url: 'javascript:alert(1)' }), { code: 'invalid' });
});
test('层级筛选保留祖先，没有分类或阶段分组', async () => {
  const s = make(); await plan(s, [task('父', { ref: 'p' }), task('子', { parentId: 'p' })]); await s.start('main', 'T-001'); const t = await s.start('main', 'T-002'); await finish(s, 'main', t); const tree = visibleTree(s.view('main').plan, { filter: 'completed' }); assert.equal(tree[0].id, 'T-001'); assert.equal(tree[0].children[0].id, 'T-002');
});
test('文件账本冷恢复保留 ID 与通知；不重复自动启动中断执行', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/store-'));
  let store = await new FileStore(dir).init(); let s = new TaskService(store); await plan(s, [task('完成'), task('中断')]); const t = await s.start('main', 'T-001'); await finish(s, 'main', t); await s.start('main', 'T-002'); await store.close();
  store = await new FileStore(dir).init(); s = new TaskService(store); await s.recover(); assert.equal(s.view('main').plan.tasks['T-001'].status, 'completed'); assert.equal(s.view('main').plan.tasks['T-002'].status, 'paused'); assert.equal(store.read().outbox.length, 1); await store.close();
});
test('损坏状态不清空，第二个写入者被拒绝', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/corrupt-')); const store = await new FileStore(dir).init(); await assert.rejects(new FileStore(dir).init(), /active writer/); await store.close();
  await writeFile(join(dir, 'taskflow.json'), '{bad'); await assert.rejects(new FileStore(dir).init(), /preserved/); assert.equal(await readFile(join(dir, 'taskflow.json'), 'utf8'), '{bad');
});
test('真正的队列逐项完成，通知不等待兄弟结束，失败重送不重复执行', async () => {
  const s = make({ maxConcurrent: 1 }); await plan(s, [task('一', { mode: 'delegate' }), task('二', { mode: 'delegate' })]);
  const starts = [], notifications = []; let settleFirst;
  const runtime = new TaskRuntime(s, { agent: () => ({}), start: async r => { starts.push(r); return { childId: r.childId, result: starts.length === 1 ? new Promise(resolve => { settleFirst = resolve; }) : new Promise(resolve => { r.signal.addEventListener('abort', () => resolve({ stopReason: 'cancelled' }), { once: true }); }), dispose: async () => {} }; }, notify: async n => { notifications.push(n.id); return true; } });
  try { await s.start('main', 'T-001'); await s.start('main', 'T-002'); await until(() => starts.length === 1); settleFirst({ stopReason: 'completed', structured: { status: 'completed', summary: '第一项完成' } }); await until(() => notifications.length === 1 && starts.length === 2); assert.equal(s.view('main').plan.tasks['T-001'].status, 'completed'); assert.equal(s.view('main').plan.tasks['T-002'].status, 'running'); await runtime.deliver(); assert.equal(notifications.length, 1); }
  finally { await runtime.dispose(); }
});
test('递归调度：并发 1 时父任务等待释放名额，孙任务仅通知直接父任务', async () => {
  const s = make({ maxConcurrent: 1, maxDepth: 2 }); await plan(s, [task('父会话事项', { mode: 'delegate' })]); const agents = new Map([['main', {}]]), notices = []; let runtime;
  runtime = new TaskRuntime(s, { agent: id => agents.get(id), notify: async n => { notices.push(n.targetSessionId); return true; }, start: async r => {
    agents.set(r.childId, {});
    const result = (async () => { const view = s.view(r.childId), own = view.currentTaskId;
      if (own === 'T-001') { const [grandchild] = await s.add(r.childId, [task('孙任务', { mode: 'delegate' })]); await s.start(r.childId, grandchild.id); const replies = await runtime.wait(r.childId, own, r.signal); assert.equal(replies[0].status, 'completed'); assert.deepEqual(notices, [r.childId]); }
      return { stopReason: 'completed', structured: { status: 'completed', summary: '工作已完成' } };
    })(); return { childId: r.childId, result, dispose: async () => {} };
  } });
  try { await s.start('main', 'T-001'); await until(() => s.view('main').plan.tasks['T-001'].status === 'completed'); await until(() => notices.length === 2); assert.equal(notices[1], 'main'); }
  finally { await runtime.dispose(); }
});

test('达到深度上限立即转行内，不创建无法执行的排队项', async () => {
  const s = make({ maxDepth: 0 }); await plan(s, [task('复杂事项', { mode: 'delegate' })]);
  const t = await s.start('main', 'T-001'); assert.equal(t.mode, 'inline'); assert.equal(t.status, 'running'); assert.equal(t.executionSessionId, 'main');
});

test('行内任务可以完成自己的简单下级，完成后焦点返回父任务', async () => {
  const s = make(); await plan(s, [task('本层集成')]); await s.start('main', 'T-001'); const [child] = await s.add('main', [task('简单检查')]);
  const t = await s.start('main', child.id); await finish(s, 'main', t); assert.equal(s.view('main').currentTaskId, 'T-001');
  await finish(s, 'main', s.view('main').plan.tasks['T-001']);
});

test('等待返回未启动事项，避免模型等待自己尚未执行的行内工作', async () => {
  const s = make(); await plan(s, [task('父'), task('子', { parentId: 'T-001' })]); await s.start('main', 'T-001');
  const runtime = new TaskRuntime(s, { agent: () => ({}), notify: () => true });
  try { const reports = await Promise.race([runtime.wait('main', 'T-001'), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('deadlock')), 500); timer.unref(); })]); assert.equal(reports[0].status, 'pending'); assert.equal(s.view('main').plan.tasks['T-001'].status, 'running'); }
  finally { await runtime.dispose(); }
});

test('未送达完成通知在要求变更后作废，不能向父任务报告旧完成', async () => {
  const s = make(); await plan(s, [task('需要更新')]); const t = await s.start('main', 'T-001'); await finish(s, 'main', t); await s.update('main', t.id, { instructions: '新要求' }, 1);
  const notices = [], runtime = new TaskRuntime(s, { agent: () => ({}), notify: n => { notices.push(n); return true; } });
  try { await runtime.deliver(); assert.equal(notices.length, 0); assert.equal(s.store.read().outbox[0].superseded, true); }
  finally { await runtime.dispose(); }
});

test('同级排序保持稳定 ID、版本和执行状态，拒绝过期排序', async () => {
  const s = make(); await plan(s, [task('一'), task('二')]); const before = s.view('main').plan;
  await s.reorder('main', 'T-002', -1, before.version); const p = s.view('main').plan;
  assert.deepEqual(Object.keys(p.tasks), ['T-002', 'T-001']); assert.deepEqual(p.tasks['T-002'], before.tasks['T-002']);
  await assert.rejects(s.reorder('main', 'T-001', -1, before.version), { code: 'stale' });
});

test('不能在委派父任务尚未执行时将孙任务偷挂到主会话', async () => {
  const s = make(); await plan(s, [task('父', { ref: 'p', mode: 'delegate' }), task('孙', { parentId: 'p', mode: 'delegate' })]);
  await assert.rejects(s.start('main', 'T-002'), { code: 'owner' }); assert.equal(s.view('main').plan.tasks['T-002'].status, 'pending');
});


test('旧计划中的高复杂度独立事项在启动时委派，深度上限仍行内执行', async () => {
  const s = make(); await plan(s, [task('复杂', { complexity: 'high', independent: true, mode: 'inline' })]);
  assert.equal(s.view('main').plan.tasks['T-001'].mode, 'delegate');
  await s.store.transaction(state => { state.plans[state.sessions.main].tasks['T-001'].mode = 'inline'; });
  assert.equal((await s.start('main', 'T-001')).mode, 'delegate');
  const capped = make({ maxDepth: 0 }); await plan(capped, [task('复杂', { complexity: 'high', independent: true })]);
  const result = await capped.start('main', 'T-001'); assert.equal(result.mode, 'inline'); assert.match(result.executionReason, /深度上限/);
});
test('会话树只展示已创建的会话，重试保留真实历史父子地址', async () => {
  const s = make(); const p = await plan(s, [task('父', { ref: 'p', mode: 'delegate' }), task('孙', { parentId: 'p', mode: 'delegate' })]);
  let parent = await s.start('main', 'T-001'); await s.bind(p.id, parent.id, parent.attempt.id, 'old-child');
  assert.equal(sessionTree(s.view('main').plan).length, 0, '预留 ID 尚未成功激活时不显示假会话');
  await s.activationReady(p.id, parent.id, parent.attempt.id);
  const grand = await s.start('old-child', 'T-002'); await s.bind(p.id, grand.id, grand.attempt.id, 'old-grand'); await s.activationReady(p.id, grand.id, grand.attempt.id);
  await s.settle('old-grand', grand.id, grand.attempt.id, grand.version, { status: 'blocked', summary: '缺少输入' }, true);
  await s.settle('old-child', parent.id, parent.attempt.id, parent.version, { status: 'blocked', summary: '等待下级输入' }, true);
  parent = await s.start('main', parent.id); await s.bind(p.id, parent.id, parent.attempt.id, 'new-child'); await s.activationReady(p.id, parent.id, parent.attempt.id);
  const tree = sessionTree(s.view('main').plan), old = tree.find(t => t.executionSessionId === 'old-child');
  assert.equal(tree.length, 2); assert.equal(old.children[0].executionSessionId, 'old-grand'); assert.equal(old.children[0].target.parentSessionId, 'old-child');
  const retry = await s.start('new-child', 'T-002'); await s.bind(p.id, retry.id, retry.attempt.id, 'new-grand'); await s.activationReady(p.id, retry.id, retry.attempt.id);
  const latest = sessionTree(s.view('main').plan);
  assert.equal(latest.find(t => t.executionSessionId === 'old-child').children[0].executionSessionId, 'old-grand');
  assert.equal(latest.find(t => t.executionSessionId === 'new-child').children[0].executionSessionId, 'new-grand');
});
