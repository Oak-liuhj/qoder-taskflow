import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import Subagents, { foldSubagentDescriptor } from '@deepseek-ai/dsh-subagent';
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit';
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';
import { InlineSessions } from '../src/server/inline-sessions.mjs';
import { registerTools } from '../src/server/tools.mjs';
import { createAssistantMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm';
const model = process.env.TASKFLOW_TEST_PLUGIN ? null : await import('../src/client/model.mjs');

test('进展和关键结果进入当前事项子会话，迟到工具结果不串到下一项，完成摘要先保存', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/task-journal-'));
  const ctx = new Context(), service = new TaskService(new MemoryStore()), errors = [], tools = new Map(); let records;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true }); await ctx.plugin(Jsonl, { root: dir, compression: 'none' }); await ctx.plugin(Subagents, {});
    records = new InlineSessions(ctx, service, error => errors.push(error));
    const parent = await records.acquire('parent', { cwd: process.cwd() });
    registerTools({ tools: { register: tool => tools.set(tool.name, tool) } }, service, {}, null, records);
    const p = await service.create('parent', { title: '过程归属', goal: '只通知最终结果', tasks: [{ title: '当前行内事项' }, { title: '后续事项' }, { title: '委派事项', mode: 'delegate' }] });
    const first = await service.start('parent', 'T-001');
    const progress = await tools.get('taskflow_progress').execute({ content: '已完成目录勘察，发现两类导入入口' }, { agent: { session: parent.session }, signal: new AbortController().signal, callId: 'progress-1' });
    assert.equal(progress.taskId, first.id); assert.notEqual(progress.sessionId, 'parent');
    assert.match(JSON.stringify(ctx.sessions.get(progress.sessionId).snapshotEvents()), /已完成目录勘察/);
    assert.doesNotMatch(JSON.stringify(parent.session.snapshotEvents()), /已完成目录勘察/); assert.equal(service.store.read().outbox.length, 0);
    records.capture(parent.session, { type: 'request/header', seq: 4997, data: { step: 2, header: { config: { provider: 'fixture', model: 'task-journal' } } } });
    records.capture(parent.session, { type: 'assistant/message', seq: 4998, data: { message: createAssistantMessage({ source: { provider: 'fixture', model: 'task-journal' }, content: [{ type: 'reasoning', text: 'PRIVATE_REASONING_NOT_A_PROGRESS_RECORD' }, { type: 'text', text: '已确认两个入口，下一步检查导入校验。' }] }) } });
    records.capture(parent.session, { type: 'tool/call', seq: 5000, time: 1000, data: { name: 'read_file', callId: 'slow-read', arguments: '{"path":"one.md"}' } });
    await service.settle('parent', first.id, first.attempt.id, first.version, { status: 'completed', summary: '第一项完成' });
    await service.start('parent', 'T-002');
    records.capture(parent.session, { type: 'tool/result', seq: 5001, time: 2300, data: { message: { toolCallId: 'slow-read', content: [{ type: 'text', text: '第一项的关键读取结果' }] } } });
    await records.idle();
    assert.match(JSON.stringify(ctx.sessions.get(progress.sessionId).snapshotEvents()), /第一项的关键读取结果/);
    const messages = ctx.sessions.get(progress.sessionId).snapshotEvents().filter(e => e.type === 'user/message').map(e => e.data);
    for (const category of ['model-call', 'model-output', 'tool-call', 'tool-result', 'progress']) assert.ok(messages.some(m => m.source.record?.category === category), `Missing readable record kind: ${category}`);
    const output = messages.find(m => m.source.record?.category === 'model-output'); assert.match(output.content[0].text, /已确认两个入口/); assert.deepEqual(output.source.record.model, { provider: 'fixture', model: 'task-journal' });
    assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_REASONING_NOT_A_PROGRESS_RECORD/);
    const toolResult = messages.find(m => m.source.record?.category === 'tool-result'); assert.equal(toolResult.source.record.tool, 'read_file'); assert.equal(toolResult.source.record.durationMs, 1300);
    const second = service.view('parent').plan.tasks['T-002']; assert.doesNotMatch(JSON.stringify(ctx.sessions.get(second.recordSession.id).snapshotEvents()), /第一项的关键读取结果/);
    await assert.rejects(tools.get('taskflow_progress').execute({ taskId: 'T-001', content: '不能冒充其他任务' }, { agent: { session: parent.session }, signal: new AbortController().signal, callId: 'wrong' }), /当前正在执行/);
    await service.add('parent', [{ title: '嵌套行内子项' }], second.id);
    const nested = await service.start('parent', 'T-004'); await records.progress('parent', nested.id, '仅在孙事项中的过程发现', 'nested-progress');
    await service.settle('parent', nested.id, nested.attempt.id, nested.version, { status: 'completed', summary: '孙事项最终产物' });
    await records.result(service.store.read().outbox.find(n => n.taskId === nested.id));
    const parentRecord = JSON.stringify(ctx.sessions.get(second.recordSession.id).snapshotEvents());
    assert.match(parentRecord, /孙事项最终产物/); assert.doesNotMatch(parentRecord, /仅在孙事项中的过程发现/);
    const delegated = await service.start('parent', 'T-003'), child = await records.acquire('delegate-child', { parentSession: 'parent', cwd: process.cwd(), origin: 'subagent' });
    await service.bind(p.id, delegated.id, delegated.attempt.id, child.session.id); await service.activationReady(p.id, delegated.id, delegated.attempt.id);
    const ownProgress = await records.progress(child.session.id, delegated.id, '独立解析完成，校验样本通过', 'delegate-progress');
    assert.equal(ownProgress.sessionId, child.session.id); assert.doesNotMatch(JSON.stringify(parent.session.snapshotEvents()), /独立解析完成/);
    await service.settle(child.session.id, delegated.id, delegated.attempt.id, delegated.version, { status: 'completed', summary: '最终产物：parser.mjs，样本全部通过' }, true);
    const notice = service.store.read().outbox.find(n => n.taskId === delegated.id);
    assert.equal(await records.result(notice), true);
    const events = JSON.stringify(child.session.snapshotEvents()); assert.match(events, /独立解析完成/); assert.match(events, /最终产物：parser.mjs/);
    const count = child.session.snapshotEvents().length; await records.result(notice); assert.equal(child.session.snapshotEvents().length, count, '最终结果重复保存幂等');
    assert.doesNotMatch(JSON.stringify(parent.session.snapshotEvents()), /最终产物：parser.mjs/, '记录服务不自行通知父任务');
    await child.release(); await parent.release(); assert.deepEqual(errors, []);
  } finally { await records?.dispose(); await ctx.fiber.dispose(); }
});

test('规划不创建会话，执行到某项才按层级创建；委派下级同样等待实际开始', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/inline-tree-'));
  const ctx = new Context(), service = new TaskService(new MemoryStore()), errors = []; let records;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true }); await ctx.plugin(Jsonl, { root: dir, compression: 'none' }); await ctx.plugin(Subagents, {});
    records = new InlineSessions(ctx, service, e => errors.push(e)); const root = await records.acquire('parent', { cwd: process.cwd() }); await root.release();
    const p = await service.create('parent', { title: '行内树', goal: '保留层级', tasks: [{ title: '入口', ref: 'entry' }, { title: '表单', parentId: 'entry', ref: 'form' }, { title: '错误提示', parentId: 'form' }, { title: '独立解析', mode: 'delegate', ref: 'parse' }, { title: '解析校验', parentId: 'parse' }] });
    records.kick(); await records.idle(); assert.deepEqual(errors, []);
    let plan = service.view('parent').plan;
    for (const t of Object.values(plan.tasks)) assert.equal(t.recordSession, undefined);
    if (model) {
      const legacy = structuredClone(plan); legacy.tasks['T-001'].recordSession = { id: 'old-unstarted', parentSessionId: 'parent', created: true };
      assert.equal(model.sessionTree(legacy).length, 0, '旧版提前创建的未执行记录不显示');
      assert.equal(legacy.tasks['T-001'].recordSession.id, 'old-unstarted', '隐藏不删除记录');
      legacy.tasks['T-001'].attempts = 1; assert.equal(model.sessionTree(legacy).length, 1, '执行后重新显示原记录');
    }
    assert.equal((await ctx.sessionPersistence.list()).length, 1, '仅规划时只有主会话');
    await assert.rejects(service.start('parent', 'T-002'), { code: 'owner' });
    await assert.rejects(service.reserveRecord(p.id, 'T-001'), { code: 'state' });
    await service.start('parent', 'T-001'); records.kick(); await records.idle();
    plan = service.view('parent').plan; assert.equal(plan.tasks['T-001'].recordSession.created, true);
    assert.equal(plan.tasks['T-002'].recordSession, undefined); assert.equal(plan.tasks['T-003'].recordSession, undefined);
    await service.start('parent', 'T-002'); records.kick(); await records.idle();
    plan = service.view('parent').plan; assert.equal(plan.tasks['T-002'].recordSession.created, true); assert.equal(plan.tasks['T-003'].recordSession, undefined);
    await service.start('parent', 'T-003'); records.kick(); await records.idle(); plan = service.view('parent').plan;
    const [entry, form, validation] = ['T-001', 'T-002', 'T-003'].map(id => plan.tasks[id].recordSession);
    assert.equal(entry.parentSessionId, 'parent'); assert.equal(form.parentSessionId, entry.id); assert.equal(validation.parentSessionId, form.id);
    for (const record of [entry, form, validation]) assert.equal(ctx.sessions.get(record.id).header.parentSession, record.parentSessionId);
    assert.equal(plan.tasks['T-005'].recordSession, undefined, '委派父会话尚不存在，不能挂到主会话');
    assert.equal(ctx.agents.list().length, 0); assert.equal(plan.active.parent, 'T-003');
    if (model) { const tree = model.sessionTree(plan); assert.equal(tree[0].children[0].children[0].id, 'T-003'); }
    const before = (await ctx.sessionPersistence.list()).length; records.kick(); await records.idle(); assert.equal((await ctx.sessionPersistence.list()).length, before);
    const t = await service.start('parent', 'T-004'); const child = await records.acquire('parser', { cwd: process.cwd(), parentSession: 'parent', origin: 'subagent' });
    await service.bind(p.id, t.id, t.attempt.id, 'parser'); await service.activationReady(p.id, t.id, t.attempt.id); records.kick(); await records.idle();
    plan = service.view('parent').plan; assert.equal(plan.tasks['T-005'].recordSession, undefined);
    await service.start('parser', 'T-005'); records.kick(); await records.idle();
    plan = service.view('parent').plan; assert.equal(plan.tasks['T-005'].recordSession.parentSessionId, 'parser'); assert.equal(plan.tasks['T-005'].recordSession.created, true);
    await child.release(); assert.deepEqual(errors, []);
  } finally { await records?.dispose(); await ctx.fiber.dispose(); }
});

test('行内事项生成真实只读子会话，冷父会话补建、重载幂等且不调用模型', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/inline-record-'));
  let state, recordId, firstCount;
  for (let pass = 0; pass < 2; pass++) {
    const ctx = new Context(), errors = []; let records;
    try {
      await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
      await ctx.plugin(Jsonl, { root: dir, compression: 'none' }); await ctx.plugin(Subagents, { maxDepth: 0 });
      const store = new MemoryStore(state), service = new TaskService(store);
      records = new InlineSessions(ctx, service, e => errors.push(e));
      if (!pass) {
        const root = await records.acquire('parent', { cwd: process.cwd() }); await root.release();
        await service.create('parent', { title: '行内记录', goal: '保留原结果', tasks: [{ title: '已完成设计', mode: 'inline', complexity: 'medium' }] });
        const t = await service.start('parent', 'T-001'); await service.settle('parent', t.id, t.attempt.id, t.version, { status: 'completed', summary: '设计已保存，无需重跑' });
      }
      const before = service.view('parent').plan.tasks['T-001'];
      records.kick(); await records.idle(); assert.deepEqual(errors, []);
      const plan = service.view('parent').plan, task = plan.tasks['T-001'];
      assert.equal(task.recordSession.created, true); assert.equal(task.status, 'completed'); assert.equal(task.version, before.version); assert.deepEqual(task.report, before.report); assert.equal(task.executionSessionId, 'parent');
      recordId ??= task.recordSession.id; assert.equal(task.recordSession.id, recordId);
      const session = ctx.sessions.get(recordId); assert.equal(session.header.parentSession, 'parent'); assert.equal(session.header.origin, 'subagent'); assert.equal(foldSubagentDescriptor(session.snapshotEvents()).mode, 'one-shot');
      assert.match(JSON.stringify(session.snapshotEvents()), /设计已保存，无需重跑/);
      const messageCount = () => session.snapshotEvents().filter(e => e.type === 'user/message').length;
      const count = messageCount(); firstCount ??= count; assert.equal(count, firstCount);
      if (model) { assert.equal(model.sessionTree(plan)[0].executionSessionId, recordId); assert.deepEqual(model.taskTarget(plan, task), { parentSessionId: 'parent', childSessionId: recordId, mode: 'one-shot' }); assert.equal(model.visibleTree(plan, { scope: 'local', sessionId: recordId })[0].id, task.id); }
      const parent = await ctx.sessionPersistence.open('parent', 'read'); const read = await parent.read(); await parent.close();
      assert.equal(read.events.filter(e => e.type === 'subagent/catalog' && e.data.childId === recordId).length, 1);
      assert.equal(ctx.agents.list().length, 0, '仅保存记录，不能启动模型或占用委派名额');
      records.kick(); await records.idle(); assert.equal(messageCount(), count);
      state = store.read();
    } finally { await records?.dispose(); await ctx.fiber.dispose(); }
  }
});

test('记录保存失败不伪造已创建、不改变完成结果；重试复用预留 ID', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/inline-retry-'));
  const ctx = new Context(), errors = []; let records, originalFlush;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true }); await ctx.plugin(Jsonl, { root: dir, compression: 'none' }); await ctx.plugin(Subagents, {});
    const bootstrap = new InlineSessions(ctx, new TaskService(new MemoryStore())); const root = await bootstrap.acquire('parent', { cwd: process.cwd() }); await root.release(); await bootstrap.dispose();
    const service = new TaskService(new MemoryStore()); await service.create('parent', { title: '完成记录', goal: '不能重跑', tasks: [{ title: '事项' }] });
    const t = await service.start('parent', 'T-001'); await service.settle('parent', t.id, t.attempt.id, t.version, { status: 'completed', summary: '实际已完成' });
    records = new InlineSessions(ctx, service, e => errors.push(e));
    originalFlush = ctx.sessions.flush; let fail = true;
    ctx.sessions.flush = async session => { if (fail && session.header.origin === 'subagent') { fail = false; throw new Error('模拟磁盘保存失败'); } return originalFlush.call(ctx.sessions, session); };
    records.kick(); await records.idle();
    const failed = service.view('parent').plan.tasks[t.id]; assert.equal(failed.recordSession.created, false); assert.equal(failed.status, 'completed'); assert.match(failed.recordError, /磁盘保存失败/); assert.equal(errors.length, 1);
    ctx.sessions.flush = originalFlush; records.kick(); await records.idle();
    const done = service.view('parent').plan.tasks[t.id]; assert.equal(done.recordSession.id, failed.recordSession.id); assert.equal(done.recordSession.created, true); assert.equal(done.recordError, undefined); assert.deepEqual(done.report, failed.report);
    assert.equal((await ctx.sessionPersistence.list()).length, 2);
  } finally { if (originalFlush) ctx.sessions.flush = originalFlush; await records?.dispose(); await ctx.fiber.dispose(); }
});

test('真实事件自动落盘，失败工具与多行阶段结果冷读取保留，重复事件不重复写入', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/journal-durability-'));
  const store = new MemoryStore(), service = new TaskService(store), errors = [];
  let recordId, firstMessages;
  for (let cycle = 0; cycle < 2; cycle++) {
    const ctx = new Context(); let records;
    try {
      await mountAgentLoopTestDependencies(ctx, { workingDirectory: true }); await ctx.plugin(Jsonl, { root: dir, compression: 'none' }); await ctx.plugin(Subagents, {});
      records = new InlineSessions(ctx, service, e => errors.push(e));
      if (!cycle) {
        const parent = await records.acquire('parent', { cwd: process.cwd() });
        await service.create('parent', { title: '落盘验证', goal: '真实记录重启后仍可读', tasks: [{ title: '校验导入入口' }] });
        await service.start('parent', 'T-001');
        parent.session.append('turn/start', { turn: 1 }); parent.session.append('step/start', { turn: 1, step: 1 });
        parent.session.append('request/header', { reason: 'initial', header: { config: { provider: 'fixture', model: 'durability' } } });
        parent.session.append('assistant/message', { turn: 1, step: 1, stream: [], message: createAssistantMessage({ source: { provider: 'fixture', model: 'durability' }, content: [{ type: 'text', text: '已定位导入入口，正在验证异常输入。' }, { type: 'tool-call', id: 'validation', name: 'validate_import', arguments: '{"file":"sample.csv"}' }] }) }, { surfaceOp: 'append' });
        parent.session.append('tool/call', { turn: 1, step: 1, name: 'validate_import', callId: 'validation', arguments: '{"file":"sample.csv"}' });
        parent.session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: 'validation', isError: true, content: [{ type: 'text', text: '{"error":"缺少必填列","missing":["title"]}' }] }) }, { surfaceOp: 'append' });
        const toolResult = parent.session.snapshotEvents().find(e => e.type === 'tool/result');
        records.capture(parent.session, toolResult); // Same source event redelivery is idempotent.
        parent.session.append('step/end', { turn: 1, step: 1 }); parent.session.append('turn/end', { turn: 1, reason: 'completed' });
        await records.progress('parent', 'T-001', '## 验证结果\n\n| 样本 | 结果 |\n| --- | --- |\n| sample.csv | 缺少 title |\n\n下一步：补齐必填列后重试。', 'stage-validation');
        await records.idle(); recordId = service.view('parent').plan.tasks['T-001'].recordSession.id;
        firstMessages = ctx.sessions.get(recordId).snapshotEvents().filter(e => e.type === 'user/message').map(e => e.data);
        assert.equal(firstMessages.filter(m => m.source.record?.originSeq === toolResult.seq && m.source.record?.category === 'tool-result').length, 1);
        const modelCall = firstMessages.find(m => m.source.record?.category === 'model-call');
        assert.match(modelCall.content[0].text, /第 1 步模型调用/); assert.doesNotMatch(JSON.stringify(firstMessages), /undefined/);
        const failure = firstMessages.find(m => m.source.record?.category === 'tool-result');
        assert.equal(failure.source.record.status, 'failed'); assert.equal(failure.source.record.tool, 'validate_import'); assert.ok(failure.source.record.durationMs >= 0);
        assert.equal(store.read().outbox.length, 0); assert.equal(ctx.agents.list().length, 0, '记录不额外创建模型执行');
        await parent.release();
      } else {
        const persisted = await ctx.sessionPersistence.open(recordId, 'read');
        let messages;
        try { messages = (await persisted.read()).events.filter(e => e.type === 'user/message').map(e => e.data); } finally { await persisted.close(); }
        assert.deepEqual(messages, firstMessages, '冷读取不丢正文或模型/工具元数据');
        assert.match(JSON.stringify(messages), /下一步：补齐必填列后重试/);
        records.kick(); await records.idle(); assert.deepEqual(errors, []);
        assert.deepEqual(ctx.sessions.get(recordId).snapshotEvents().filter(e => e.type === 'user/message').map(e => e.data), firstMessages, '恢复不重复写入');
      }
    } finally { await records?.dispose(); await ctx.fiber.dispose(); }
  }
  assert.deepEqual(errors, []);
});

test('任务要求变更后迟到工具结果不会污染新执行，非法进展拒绝且新尝试可继续', async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/journal-stale-'));
  const ctx = new Context(), service = new TaskService(new MemoryStore()), errors = []; let records;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true }); await ctx.plugin(Jsonl, { root: dir, compression: 'none' }); await ctx.plugin(Subagents, {});
    records = new InlineSessions(ctx, service, e => errors.push(e));
    const parent = await records.acquire('parent', { cwd: process.cwd() });
    await service.create('parent', { title: '版本隔离', goal: '不混入旧执行结果', tasks: [{ title: '验证事项' }] });
    const old = await service.start('parent', 'T-001'); await records.idle();
    parent.session.append('tool/call', { name: 'read_file', callId: 'stale', arguments: '{"path":"old.md"}' }); await records.idle();
    await service.update('parent', old.id, { instructions: '使用新版文档' }, old.version);
    const live = await service.start('parent', old.id);
    parent.session.append('tool/result', { message: createToolResultMessage({ callId: 'stale', isError: false, content: [{ type: 'text', text: 'STALE_RESULT_MUST_NOT_ENTER_NEW_ATTEMPT' }] }) }, { surfaceOp: 'append' });
    for (const content of ['', '   ', 'x'.repeat(16001)]) assert.throws(() => records.progress('parent', live.id, content, 'invalid'), /非空文本/);
    await records.progress('parent', live.id, '新版文档校验完成：共 3 项通过。', 'current'); await records.idle();
    const task = service.view('parent').plan.tasks[live.id], messages = JSON.stringify(ctx.sessions.get(task.recordSession.id).snapshotEvents());
    assert.doesNotMatch(messages, /STALE_RESULT_MUST_NOT_ENTER_NEW_ATTEMPT/); assert.match(messages, /新版文档校验完成/);
    assert.equal(task.version, old.version + 1); assert.equal(task.attempts, 2); assert.deepEqual(errors, []);
    await parent.release();
  } finally { await records?.dispose(); await ctx.fiber.dispose(); }
});
