import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import Subagents from '@deepseek-ai/dsh-subagent';
import * as Spawn from '@deepseek-ai/dsh-subagent-spawn-in-process';
import * as Jsonl from '@deepseek-ai/dsh-session-persistence-jsonl';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
// Package checks load the installed tgz; normal tests use the checkout entry.
const Plugin = await import(process.env.TASKFLOW_TEST_PLUGIN ? pathToFileURL(resolve(process.env.TASKFLOW_TEST_PLUGIN)).href : '../index.js');
import { createNoticeSender } from '../src/server/notifications.mjs';
import { defineTool } from '@deepseek-ai/dsh-tools';

const textChunks = text => [{ type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }];
const toolChunks = (name, args, id) => [{ type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }, { type: 'finish', reason: { kind: 'tool-calls' } }];
const until = async (condition, timeout = 12000) => { const end = Date.now() + timeout; while (!condition()) { if (Date.now() > end) throw new Error('Host integration timed out'); await new Promise(r => setTimeout(r, 10)); } };

test('通知 flush 失败后重试持久化，同一父会话只入队一次', async () => {
  let writes = 0; const inbox = { nextStep: [], nextTurn: [] }, agent = { inbox, session: { snapshotEvents: () => [] }, steer: m => inbox.nextStep.push(m) };
  const notify = createNoticeSender({ agents: { get: () => agent }, sessions: { flush: async () => ++writes > 1 } });
  const n = { id: 'notice-id', taskId: 'T-001', targetSessionId: 'parent', report: { summary: '已完成' } };
  await assert.rejects(notify(n), /持久化/); assert.equal(await notify(n), true); assert.equal(writes, 2); assert.equal(inbox.nextStep.length, 1);
});

test('真实 AgentLoop 规划检查：遗漏补建、真实字符串参数、工具门控、短问答及有限重试', { timeout: 25000 }, async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/planning-host-'));
  const ctx = new Context(), counts = new Map(); let writes = 0;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    await ctx.plugin(Jsonl, { root: join(dir, 'sessions'), compression: 'none' });
    await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 4 });
    await ctx.plugin(Spawn, { providerName: 'spawn' });
    ctx.tools.register(defineTool({ name: 'fixture_write', description: '记录业务执行次数', parameters: {}, output: { schema: { type: 'json' }, render: () => [] }, execute: async () => ({ writes: ++writes }) }));
    ctx.llm.registerAdapter(['planning-fixture'], new class extends LlmAdapter {
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async *stream(options) {
        const sid = options.sessionId, count = counts.get(sid) ?? 0; counts.set(sid, count + 1);
        if (count > 6) throw new Error('规划重试未收敛');
        if (sid === 'short' && count === 0) yield* toolChunks('taskflow_assess', { needsPlan: false, reason: '单一概念解释，无执行步骤' }, 'short-assess');
        else if (sid === 'guarded' && count === 0) yield* toolChunks('fixture_write', {}, 'guard-write');
        else if (sid === 'invalid') yield* toolChunks('taskflow_plan', { title: '错误输入', goal: '测试重试上限', tasks: '[]' }, `invalid-${count}`);
        else if (['retry', 'guarded'].includes(sid) && count === 1) yield* toolChunks('taskflow_plan', { title: '真实参数回放', goal: '确认计划落账', tasks: '[{"title":"probe task","complexity":"low","independent":false}]' }, `${sid}-plan`);
        else yield* textChunks('回答或计划文档已经输出。');
      }
    }());
    await ctx.plugin(Plugin, { dataDir: join(dir, 'taskflow'), maxDepth: 2, maxConcurrent: 1 });
    const harness = await mountAgentLoopTestHarness(ctx);
    for (const sid of ['retry', 'guarded', 'short', 'stubborn', 'invalid']) {
      const agent = await harness.create(sid, { provider: 'planning-fixture', model: 'scripted', maxTokens: 1000 }, { cwd: process.cwd() });
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: sid === 'short' ? '解释一个概念' : '分析SDK并规划开发任务' }] }));
      await agent.whenIdle();
      if (['retry', 'guarded'].includes(sid)) {
        assert.ok(ctx.taskflow.service.view(sid).plan);
        assert.equal(ctx.taskflow.planning.view(sid), null);
      } else {
        assert.equal(ctx.taskflow.service.view(sid).plan, null);
        assert.equal(ctx.taskflow.planning.view(sid).phase, sid === 'short' ? 'skipped' : 'blocked');
      }
      if (sid === 'retry') assert.equal(agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.summary === '任务计划未落账检查').length, 1);
    }
    assert.equal(writes, 0, '没有清单也未判断为短问答时，业务工具不执行');
    assert.equal(counts.get('short'), 2); assert.equal(counts.get('stubborn'), 3); assert.equal(counts.get('invalid'), 4);
  } finally {
    await ctx.taskflow?.runtime.dispose();
    for (const agent of ctx.agents?.list?.() ?? []) agent.cancel({ kind: 'disposed' });
    await Promise.allSettled((ctx.agents?.list?.() ?? []).map(a => a.whenIdle()));
    await ctx.fiber.dispose();
  }
});

test('真实 DSH rc.2 AgentLoop：模型规划、行内执行、spawn 子会话、结构化完成与父通知', { timeout: 25000 }, async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/host-'));
  const ctx = new Context(); const requests = [], errors = []; let adapter;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    await ctx.plugin(Jsonl, { root: join(dir, 'sessions'), compression: 'none' });
    await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 4 });
    await ctx.plugin(Spawn, { providerName: 'spawn' });
    const counts = new Map();
    adapter = new class extends LlmAdapter {
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async *stream(options) {
        requests.push(options); const sid = options.sessionId, count = counts.get(sid) ?? 0; counts.set(sid, count + 1);
        if (count > 12) throw new Error(`Unexpected repeated requests for ${sid}`);
        if (sid !== 'taskflow-main') {
          const own = ctx.taskflow.service.view(sid).currentTaskId;
          if (own !== 'T-002' && ctx.taskflow.planning.taskToAssess({ session: { id: sid } })) { yield* toolChunks('taskflow_assess', { needsPlan: false, reason: '测试叶子工作只需一个动作，无需重复拆分', taskId: own }, `${sid}-assess`); return; }
          if (own === 'T-002' && count === 0) yield* toolChunks('taskflow_add', { tasks: [{ title: '独立子模块', complexity: 'high', independent: true }] }, `${sid}-${count}`);
          else if (own === 'T-002' && count === 1) yield* toolChunks('taskflow_start', { taskId: 'T-003' }, `${sid}-${count}`);
          else if (own === 'T-002' && count === 2) yield* toolChunks('taskflow_wait', { taskId: 'T-002' }, `${sid}-${count}`);
          else yield* toolChunks('structured_output', { status: 'completed', summary: '子会话实际执行完成' }, `${sid}-${count}`);
          return;
        }
        if (count === 0) yield* toolChunks('taskflow_plan', { title: '集成验收', goal: '验证持久计划和实际子会话', tasks: [{ title: '准备上下文' }, { title: '独立实现', complexity: 'high', independent: true }] }, `main-${count}`);
        else if (count === 1) yield* toolChunks('taskflow_start', { taskId: 'T-001' }, `main-${count}`);
        else if (count === 2) yield* toolChunks('inline_probe', {}, `main-${count}`);
        else if (count === 3) { const t = ctx.taskflow.service.view(sid).plan.tasks['T-001']; yield* toolChunks('taskflow_complete', { taskId: t.id, version: t.version, attemptId: t.attempt.id, summary: '已准备上下文' }, `main-${count}`); }
        else if (count === 4) yield* toolChunks('taskflow_start', { taskId: 'T-002' }, `main-${count}`);
        else yield* textChunks('继续主任务，已完成事项无需重复核对。');
      }
    }();
    ctx.llm.registerAdapter(['fixture'], adapter);
    ctx.tools.register(defineTool({ name: 'inline_probe', description: '返回实际工具执行记录', parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] }, execute: async () => 'inline-probe-real-output', presentCall: () => ({ card: 'generic' }), presentResult: () => ({ card: 'generic' }) }));
    await ctx.plugin(Plugin, { dataDir: join(dir, 'taskflow'), maxDepth: 2, maxConcurrent: 1 });
    const harness = await mountAgentLoopTestHarness(ctx);
    const agent = await harness.create('taskflow-main', { provider: 'fixture', model: 'scripted', maxTokens: 2000 }, { cwd: process.cwd() });
    ctx.on('tools/result', (_exec, result) => { if (result.isError) errors.push(result); }, { global: true });
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '完成持久任务编排集成验证，分别验证行内事项和独立子会话。' }] }));
    await until(() => ctx.taskflow.service.view('taskflow-main').plan?.tasks['T-002'].status === 'completed').catch(error => { throw new Error(`${error.message}: ${JSON.stringify({ errors, view: ctx.taskflow.service.view('taskflow-main'), requests: requests.length })}`, { cause: error }); });
    await until(() => ctx.taskflow.service.store.read().outbox.every(n => n.delivered));
    await agent.whenIdle();
    assert.deepEqual(errors, []);
    const view = ctx.taskflow.service.view('taskflow-main'); assert.equal(view.plan.tasks['T-001'].status, 'completed'); assert.equal(view.plan.tasks['T-002'].status, 'completed');
    ctx.taskflow.records.kick(); await ctx.taskflow.records.idle();
    const inline = ctx.taskflow.service.view('taskflow-main').plan.tasks['T-001'];
    assert.equal(inline.recordSession?.created, true, JSON.stringify(inline));
    assert.equal(ctx.sessions.get(inline.recordSession.id).header.parentSession, 'taskflow-main');
    assert.match(JSON.stringify(ctx.sessions.get(inline.recordSession.id).snapshotEvents()), /已准备上下文/);
    assert.match(JSON.stringify(ctx.sessions.get(inline.recordSession.id).snapshotEvents()), /inline-probe-real-output/);
    assert.ok(view.plan.tasks['T-002'].executionSessionId); assert.notEqual(view.plan.tasks['T-002'].executionSessionId, 'taskflow-main');
    assert.equal(view.plan.tasks['T-003'].status, 'completed');
    // Check the actual host's persisted parent address, not just our ledger.
    const sessionFiles = (await readdir(join(dir, 'sessions'), { recursive: true })).filter(path => /session\.v\d+\.jsonl$/.test(path));
    const headers = new Map();
    for (const file of sessionFiles) { const header = JSON.parse((await readFile(join(dir, 'sessions', file), 'utf8')).split('\n', 1)[0]); headers.set(header.id, header); }
    const childId = view.plan.tasks['T-002'].executionSessionId, grandId = view.plan.tasks['T-003'].executionSessionId;
    assert.equal(headers.get(childId)?.parentSession, 'taskflow-main');
    assert.equal(headers.get(grandId)?.parentSession, childId);
    const notices = agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source?.kind === 'taskflow' && e.data.source?.summary?.endsWith('已完成'));
    assert.equal(notices.filter(e => e.data.source.summary === 'T-002 已完成').length, 1);
    assert.equal(notices.filter(e => e.data.source.summary === 'T-003 已完成').length, 0, '孙任务不能跳过直接父会话通知主会话');
    assert.ok(agent.session.snapshotEvents().some(e => e.type === 'system/message' && JSON.stringify(e.data).includes('taskflow_plan'))); assert.ok(requests.some(r => r.sessionId !== 'taskflow-main'));
    const before = JSON.stringify(view.plan.tasks);
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '查看进度，保留既有任务。' }] })); await agent.whenIdle();
    assert.equal(JSON.stringify(ctx.taskflow.service.view('taskflow-main').plan.tasks), before);
    const disk = JSON.parse(await readFile(join(dir, 'taskflow/taskflow.json'), 'utf8')); assert.equal(Object.keys(disk.plans).length, 1); assert.ok(disk.outbox.every(n => n.delivered));
  } finally {
    if (ctx.taskflow) await ctx.taskflow.runtime.dispose();
    for (const agent of ctx.agents?.list?.() ?? []) agent.cancel({ kind: 'disposed' });
    await Promise.allSettled((ctx.agents?.list?.() ?? []).map(a => a.whenIdle()));
    await ctx.fiber.dispose();
  }
});

test('点击继续通过真实 AgentLoop 恢复父任务，保留完成子项并重新执行孙会话', { timeout: 25000 }, async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/resume-host-'));
  const ctx = new Context(); let grandRuns = 0, rootSteps = 0; const errors = [];
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    await ctx.plugin(Jsonl, { root: join(dir, 'sessions'), compression: 'none' });
    await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 4 });
    await ctx.plugin(Spawn, { providerName: 'spawn' });
    ctx.llm.registerAdapter(['resume-fixture'], new class extends LlmAdapter {
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async *stream(options) {
        const sid = options.sessionId, p = ctx.taskflow.service.view(sid).plan;
        const needs = ctx.taskflow.planning.taskToAssess({ session: { id: sid } });
        if (needs) { yield* toolChunks('taskflow_assess', { needsPlan: false, reason: '已有具体执行要求，可以在本层直接完成', taskId: needs.id }, `${sid}-assess`); return; }
        if (sid === 'resume-main') {
          const step = rootSteps++;
          if (step === 0) yield* toolChunks('taskflow_status', {}, 'root-list');
          else if (step === 1) yield* toolChunks('taskflow_start', { taskId: 'T-001' }, 'root-resume');
          else yield* textChunks('已提交执行，无需父会话复核。');
        } else if (ctx.taskflow.service.view(sid).currentTaskId === 'T-003') {
          const run = ++grandRuns;
          yield* toolChunks('structured_output', { status: run === 1 ? 'blocked' : 'completed', summary: run === 1 ? '缺少平台访问方式' : '访问已提供，实际完成' }, `${sid}-final`);
        } else {
          const done = p.tasks['T-002'], grand = p.tasks['T-003'];
          if (done.status === 'pending') yield* toolChunks('taskflow_start', { taskId: done.id }, `${sid}-start-simple`);
          else if (done.status === 'running') yield* toolChunks('taskflow_complete', { taskId: done.id, version: done.version, attemptId: done.attempt.id, summary: '已保存不可重复的准备结果' }, `${sid}-simple-done`);
          else if (grand.status === 'blocked' && p.tasks['T-001'].attempts === 1) yield* toolChunks('structured_output', { status: 'blocked', summary: '等待平台访问方式' }, `${sid}-blocked`);
          else if (['pending', 'blocked'].includes(grand.status)) yield* toolChunks('taskflow_start', { taskId: grand.id }, `${sid}-start-grand`);
          else if (['queued', 'running'].includes(grand.status)) yield* toolChunks('taskflow_wait', { taskId: 'T-001' }, `${sid}-wait`);
          else yield* toolChunks('structured_output', { status: 'completed', summary: '子树实际完成' }, `${sid}-final`);
        }
      }
    }());
    await ctx.plugin(Plugin, { dataDir: join(dir, 'taskflow'), maxDepth: 2, maxConcurrent: 1 });
    const harness = await mountAgentLoopTestHarness(ctx);
    const agent = await harness.create('resume-main', { provider: 'resume-fixture', model: 'scripted', maxTokens: 2000 }, { cwd: process.cwd() });
    ctx.on('tools/result', (_exec, result) => { if (result.isError) errors.push(result); }, { global: true });
    const service = ctx.taskflow.service;
    await service.create('resume-main', { title: '受阻恢复', goal: '验证孙级会话和完成记录', tasks: [{ title: '父任务', mode: 'delegate', ref: 'p' }, { title: '准备', parentId: 'p' }, { title: '独立复杂事项', parentId: 'p', complexity: 'high', independent: true, mode: 'inline' }] });
    await service.start('resume-main', 'T-001');
    await until(() => service.view('resume-main').plan.tasks['T-003'].status === 'blocked');
    await until(() => service.view('resume-main').plan.tasks['T-001'].status === 'blocked');
    const before = service.view('resume-main').plan, oldChild = before.tasks['T-001'].executionSessionId, saved = structuredClone(before.tasks['T-002']);
    assert.equal(rootSteps, 0);
    await ctx.taskflow.actions.resume('resume-main', 'T-003', 1);
    await until(() => service.view('resume-main').plan.tasks['T-001'].status === 'completed');
    await agent.whenIdle();
    const after = service.view('resume-main').plan;
    assert.deepEqual(errors, []); assert.equal(grandRuns, 2); assert.deepEqual(after.tasks['T-002'], saved);
    assert.notEqual(after.tasks['T-001'].executionSessionId, oldChild);
    assert.equal(after.tasks['T-003'].executionParentSessionId, after.tasks['T-001'].executionSessionId);
    assert.equal(after.tasks['T-003'].mode, 'delegate');
    assert.ok(agent.session.snapshotEvents().some(e => e.type === 'subagent/catalog'));
  } finally {
    await ctx.taskflow?.runtime.dispose();
    for (const agent of ctx.agents?.list?.() ?? []) agent.cancel({ kind: 'disposed' });
    await Promise.allSettled((ctx.agents?.list?.() ?? []).map(a => a.whenIdle()));
    await ctx.fiber.dispose();
  }
});

test('逐层执行前判断：子会话动态拆解孙任务，孙会话再次拆解且保留真实父子关系', { timeout: 20000 }, async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/recursive-assessment-'));
  const ctx = new Context(), steps = new Map(), assessed = new Set(), errors = [];
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    await ctx.plugin(Jsonl, { root: join(dir, 'sessions'), compression: 'none' });
    await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 4 }); await ctx.plugin(Spawn, { providerName: 'spawn' });
    ctx.llm.registerAdapter(['recursive-fixture'], new class extends LlmAdapter {
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async *stream(options) {
        const sid = options.sessionId, view = ctx.taskflow.service.view(sid), plan = view.plan, own = view.currentTaskId;
        const step = (steps.get(sid) || 0) + 1; steps.set(sid, step); if (step > 20) throw new Error('递归检查未收敛');
        if (sid === 'recursive-main') {
          if (plan.tasks['T-001'].status === 'pending') yield* toolChunks('taskflow_start', { taskId: 'T-001' }, `${sid}-${step}`);
          else yield* textChunks('正在执行原计划。');
          return;
        }
        const task = plan.tasks[own], isContainer = task.id === 'T-001' || task.id === 'T-002';
        if (ctx.taskflow.planning.taskToAssess({ session: { id: sid } })) {
          assert.match(options.messages.at(-1).content[0].text, /执行前拆解检查/);
          assessed.add(task.id);
          if (!task.decomposition?.needsSplit) yield* toolChunks('taskflow_assess', { needsPlan: true, reason: '包含需要分别交付的组成部分', taskId: task.id }, `${sid}-${step}`);
          else yield* toolChunks('taskflow_add', { parentId: task.id, tasks: task.id === 'T-001' ? [{ title: '解析模块', complexity: 'high', independent: true }] : [{ title: '验证格式', complexity: 'low' }, { title: '保存结果', complexity: 'low' }] }, `${sid}-${step}`);
          return;
        }
        if (isContainer) {
          const children = Object.values(plan.tasks).filter(t => t.parentId === task.id), pending = children.find(t => t.status === 'pending');
          if (pending) yield* toolChunks('taskflow_start', { taskId: pending.id }, `${sid}-${step}`);
          else if (children.some(t => ['queued', 'running'].includes(t.status))) yield* toolChunks('taskflow_wait', { taskId: task.id }, `${sid}-${step}`);
          else yield* toolChunks('structured_output', { status: 'completed', summary: '组成事项全部完成，无需父会话复核' }, `${sid}-${step}`);
        } else yield* toolChunks('taskflow_complete', { taskId: task.id, version: task.version, attemptId: task.attempt.id, summary: '本层实际工作完成' }, `${sid}-${step}`);
      }
    }());
    await ctx.plugin(Plugin, { dataDir: join(dir, 'taskflow'), maxDepth: 2, maxConcurrent: 1 });
    const harness = await mountAgentLoopTestHarness(ctx);
    const agent = await harness.create('recursive-main', { provider: 'recursive-fixture', model: 'scripted' }, { cwd: process.cwd() });
    ctx.on('tools/result', (_exec, result) => { if (result.isError) errors.push(result); }, { global: true });
    await ctx.taskflow.service.create('recursive-main', { title: '文档导入', goal: '自动逐层拆解', tasks: [{ title: '实现导入', complexity: 'high', independent: true }] });
    ctx.taskflow.records.kick(); await ctx.taskflow.records.idle();
    assert.equal((await ctx.sessionPersistence.list()).length, 1, '只规划时仅有主会话，不创建事项会话');
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '执行现有计划，按复杂度判断每层是否继续拆解。' }] }));
    await until(() => ctx.taskflow.service.view('recursive-main').plan.tasks['T-001'].status === 'completed');
    await agent.whenIdle(); ctx.taskflow.records.kick(); await ctx.taskflow.records.idle();
    const p = ctx.taskflow.service.view('recursive-main').plan;
    assert.deepEqual(errors, []); assert.deepEqual([...assessed].sort(), ['T-001', 'T-002']);
    assert.equal(Object.keys(p.tasks).length, 4); assert.ok(Object.values(p.tasks).every(t => t.status === 'completed'));
    for (const id of ['T-001', 'T-002']) assert.equal(p.tasks[id].decomposition.needsSplit, true);
    assert.equal(p.tasks['T-002'].executionParentSessionId, p.tasks['T-001'].executionSessionId);
    for (const id of ['T-003', 'T-004']) assert.equal(p.tasks[id].recordSession.parentSessionId, p.tasks['T-002'].executionSessionId);
    const saved = await ctx.sessionPersistence.open(p.tasks['T-002'].executionSessionId, 'read');
    try { assert.equal(saved.header.parentSession, p.tasks['T-001'].executionSessionId); } finally { await saved.close(); }
  } finally {
    await ctx.taskflow?.runtime.dispose(); for (const a of ctx.agents?.list?.() ?? []) a.cancel({ kind: 'disposed' });
    await Promise.allSettled((ctx.agents?.list?.() ?? []).map(a => a.whenIdle())); await ctx.fiber.dispose();
  }
});

test('冷主会话恢复沿用持久模型路由，点击继续实际唤醒并完成行内任务', { timeout: 20000 }, async () => {
  await mkdir('.local/tests', { recursive: true }); const dir = await mkdtemp(join(process.cwd(), '.local/tests/cold-host-'));
  const ctx = new Context(); let priming = true;
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    await ctx.plugin(Jsonl, { root: join(dir, 'sessions'), compression: 'none' });
    await ctx.plugin(Subagents, { maxDepth: 2, maxActiveSubagents: 4 }); await ctx.plugin(Spawn, { providerName: 'spawn' });
    ctx.llm.registerAdapter(['cold-fixture'], new class extends LlmAdapter {
      async resolveModel(provider, model) { return { provider, id: model, name: model }; }
      async *stream(options) {
        assert.equal(options.provider, 'cold-fixture');
        if (priming) { yield* textChunks('模型路由已建立。'); return; }
        const task = ctx.taskflow.service.view('cold-main').plan.tasks['T-001'];
        if (task.status === 'pending') yield* toolChunks('taskflow_start', { taskId: task.id }, 'cold-start');
        else if (task.status === 'running') yield* toolChunks('taskflow_complete', { taskId: task.id, version: task.version, attemptId: task.attempt.id, summary: '实际冷恢复执行完成' }, 'cold-done');
        else yield* textChunks('已完成。');
      }
    }());
    await ctx.plugin(Plugin, { dataDir: join(dir, 'taskflow') }); await mountAgentLoopTestHarness(ctx);
    await ctx.taskflow.service.create('cold-main', { title: '冷恢复', goal: '恢复真实会话', tasks: [{ title: '实际执行' }] });
    const handle = await ctx.agents.create({ sessionId: 'cold-main', meta: { cwd: process.cwd() }, agentOptions: { provider: 'cold-fixture', model: 'scripted' } });
    handle.agent.model?.select({ provider: 'cold-fixture', model: 'scripted' });
    handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '保留计划，确认模型路由，不启动任务。' }] })); await handle.agent.whenIdle(); priming = false;
    assert.ok(await ctx.sessions.flush(handle.agent.session)); await handle.dispose(); assert.equal(ctx.agents.get('cold-main'), undefined);
    await ctx.taskflow.actions.resume('cold-main', 'T-001', 1);
    await until(() => ctx.taskflow.service.view('cold-main').plan.tasks['T-001'].status === 'completed');
    await ctx.agents.get('cold-main').whenIdle();
  } finally {
    await ctx.taskflow?.runtime.dispose();
    for (const agent of ctx.agents?.list?.() ?? []) agent.cancel({ kind: 'disposed' });
    await Promise.allSettled((ctx.agents?.list?.() ?? []).map(a => a.whenIdle())); await ctx.fiber.dispose();
  }
});
