import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { QuickReplies, parseReplies } from '../src/server/quick-replies.mjs';
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';

const items = [1, 2, 3].map(i => ({ label: `下一步${i}`, text: `请处理具体事项${i}` }));
const message = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
async function ready(replies, sid) { for (let i = 0; i < 100; i++) { const v = await replies.request(sid); if (v.phase !== 'generating') return v; await new Promise(r => setTimeout(r, 5)); } throw new Error('推荐超时'); }

test('推荐严格校验3至5条模型回复，拒绝重复、空内容和非结构化输出', () => {
  assert.deepEqual(parseReplies(JSON.stringify(items)), items);
  assert.deepEqual(parseReplies('```json\n' + JSON.stringify(items) + '\n```'), items);
  assert.deepEqual(parseReplies(JSON.stringify({ replies: items })), items);
  for (const v of [[], items.slice(1), [...items, ...items], [items[0], items[0], items[2]], [...items.slice(0, 2), { label: '空', text: '' }]]) assert.throws(() => parseReplies(JSON.stringify(v)));
  assert.throws(() => parseReplies('这是下一步')); assert.throws(() => parseReplies(JSON.stringify([1, 2, 3])));
});

test('真实LLM辅助调用按会话与上下文去重，读取当前计划，不写消息、不执行工具', async () => {
  const ctx = new Context(), service = new TaskService(new MemoryStore()), calls = []; let replies, fail = false;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    const harness = await mountAgentLoopTestHarness(ctx);
    ctx.llm.registerAdapter(['recommend-fixture'], new class extends LlmAdapter {
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async *stream(options) {
        calls.push(options); if (fail) throw new Error('模拟模型失败');
        yield { type: 'block-end', index: 0, block: { type: 'text', text: JSON.stringify(items) } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }());
    const agent = await harness.create('parent', { provider: 'recommend-fixture', model: 'scripted' }, { cwd: process.cwd() });
    agent.session.append('user/message', message('开发文档导入，并补充失败文件检查。'), { surfaceOp: 'append' });
    await service.create('parent', { title: '文档导入', goal: '实现导入', tasks: [{ title: '文件校验' }] });
    const originalEvents = agent.session.snapshotEvents(), originalLedger = service.store.read();
    replies = new QuickReplies(ctx, service);
    const first = await Promise.all([replies.request('parent'), replies.request('parent')]); assert.ok(first.every(v => ['generating', 'ready'].includes(v.phase)));
    assert.deepEqual((await ready(replies, 'parent')).items, items); assert.equal(calls.length, 1);
    for (let i = 0; i < 5; i++) await replies.request('parent'); assert.equal(calls.length, 1, '轮询不重复调用模型');
    assert.equal(calls[0].purpose, 'taskflow.quick-replies'); assert.equal(calls[0].sessionId, 'parent'); assert.equal(calls[0].tools, undefined);
    assert.match(calls[0].messages[0].content[0].text, /文件校验/); assert.match(calls[0].system, /3至5条/);
    assert.deepEqual(agent.session.snapshotEvents(), originalEvents); assert.deepEqual(service.store.read(), originalLedger);
    agent.session.append('user/message', message('补充损坏文件的提示。'), { surfaceOp: 'append' }); await ready(replies, 'parent'); assert.equal(calls.length, 2);
    const t = await service.start('parent', 'T-001'); await service.settle('parent', t.id, t.attempt.id, t.version, { status: 'completed', summary: '校验完成' });
    await ready(replies, 'parent'); assert.equal(calls.length, 3); assert.match(calls[2].messages[0].content[0].text, /completed/);
    fail = true; agent.session.append('user/message', message('整理验收证据。'), { surfaceOp: 'append' }); assert.equal((await ready(replies, 'parent')).phase, 'unavailable');
    const count = calls.length; await replies.request('parent'); await replies.request('parent'); assert.equal(calls.length, count, '失败不无限重试');
    fail = false; await replies.request('parent', true); assert.equal((await ready(replies, 'parent')).phase, 'ready'); assert.equal(calls.length, count + 1);
    assert.equal((await replies.request('missing')).phase, 'idle');
  } finally { await replies?.dispose(); await ctx.fiber.dispose(); }
});

test('推荐取消与切会话隔离：迟到结果不覆盖新内容，繁忙时等待，关闭时取消', async () => {
  const store = new MemoryStore(), service = new TaskService(store), gates = [], sessions = new Map();
  let seq = 0;
  const agent = { isRunning: false, options: { provider: 'fixture', model: 'model' }, session: { snapshotEvents: () => [{ type: 'user/message', data: message(`问题${seq}`) }] } };
  sessions.set('main', agent);
  const ctx = { agents: { get: id => sessions.get(id) }, sessions: { get: () => null }, get: () => null, llm: { async *stream(options) {
    await new Promise((resolve, reject) => { gates.push(resolve); options.signal.addEventListener('abort', () => reject(new Error('已取消')), { once: true }); });
    yield { type: 'block-end', block: { type: 'text', text: JSON.stringify(items) } }; yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const replies = new QuickReplies(ctx, service);
  try {
    assert.equal((await replies.request('main')).phase, 'generating'); const first = replies.entries.get('main');
    seq++; await replies.request('main'); const second = replies.entries.get('main'); assert.notEqual(second, first);
    gates[0](); await first.work; assert.equal(replies.entries.get('main'), second); assert.equal(second.view.phase, 'generating');
    gates[1](); await second.work; assert.equal(second.view.phase, 'ready');
    sessions.set('other', { ...agent, session: { snapshotEvents: () => [{ type: 'user/message', data: message('另一个任务') }] } });
    await replies.request('other'); const other = replies.entries.get('other'); assert.notEqual(other, second);
    gates[2](); await other.work; assert.equal(second.view.phase, 'ready');
    agent.isRunning = true; assert.equal((await replies.request('main')).phase, 'busy'); agent.isRunning = false;
    await replies.request('main'); await replies.dispose(); assert.equal(replies.entries.size, 0);
    const disabled = new QuickReplies(ctx, service, false); assert.deepEqual(await disabled.request('main'), { phase: 'idle', items: [] }); await disabled.dispose();
  } finally { await replies.dispose(); }
});

test('冷会话读取原生持久事件恢复模型路由，读取句柄关闭且缓存不重复打开', async () => {
  let opened = 0, closed = 0;
  const service = new TaskService(new MemoryStore());
  const ctx = { agents: { get: () => null }, sessions: { get: () => null }, get: () => ({ stat: async sid => sid === 'cold', open: async (_sid, mode) => {
    assert.equal(mode, 'read'); opened++;
    return { read: async () => ({ events: [{ type: 'model/selection', data: { provider: 'saved', model: 'saved-model' } }, { type: 'user/message', data: message('补充文档校验') }] }), close: async () => { closed++; } };
  } }), llm: { async *stream(options) {
    assert.equal(options.provider, 'saved'); assert.equal(options.model, 'saved-model');
    yield { type: 'block-end', block: { type: 'text', text: JSON.stringify(items) } }; yield { type: 'finish', reason: { kind: 'stop' } };
  } } };
  const replies = new QuickReplies(ctx, service);
  try { assert.equal((await ready(replies, 'cold')).phase, 'ready'); await replies.request('cold'); assert.equal(opened, 1); assert.equal(closed, 1); }
  finally { await replies.dispose(); }
});

test('推荐覆盖推理模型输出预算、明确失败原因与手动恢复，不泄露模型错误中的敏感信息', async () => {
  let kind = 'max-tokens', calls = 0;
  const ctx = { agents: { get: () => null }, sessions: { get: () => ({ snapshotEvents: () => [{ type: 'user/message', data: message('继续开发') }, { type: 'request/header', data: { header: { config: { provider: 'fixture', model: 'thinking' } } } }] }) }, llm: { async *stream(options) {
    calls++; assert.equal(options.provider, 'fixture'); assert.ok(options.maxTokens >= 4096);
    if (kind === 'stop') yield { type: 'block-end', block: { type: 'text', text: JSON.stringify(items) } };
    yield { type: 'finish', reason: { kind, failure: { code: 'INVALID_CREDENTIAL', message: 'sensitive-token-must-not-appear' } } };
  } } };
  const replies = new QuickReplies(ctx, new TaskService(new MemoryStore()));
  try {
    assert.equal((await ready(replies, 'main')).code, 'length'); const count = calls;
    await replies.request('main'); assert.equal(calls, count);
    kind = 'error'; await replies.request('main', true); const failed = await ready(replies, 'main'); assert.equal(failed.code, 'auth'); assert.doesNotMatch(JSON.stringify(failed), /sensitive-token/);
    kind = 'stop'; await replies.request('main', true); assert.equal((await ready(replies, 'main')).phase, 'ready');
    ctx.sessions.get = () => { throw new Error('disk-read-private-detail'); };
    const unavailable = await replies.request('main'); assert.equal(unavailable.code, 'source'); assert.doesNotMatch(JSON.stringify(unavailable), /private-detail/);
  } finally { await replies.dispose(); }
});
