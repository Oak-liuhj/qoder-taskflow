import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { JSDOM, VirtualConsole } from 'jsdom';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execute } from '../src/qoder/adapter.mjs';
import { projectDirectory, snapshot } from '../src/qoder/store.mjs';
import { PANEL_URI } from '../src/qoder/schemas.mjs';

const exec = promisify(execFile), root = fileURLToPath(new URL('../', import.meta.url));
const source = fileURLToPath(new URL('../src/qoder/adapter.mjs', import.meta.url));
const version = JSON.parse(await readFile(join(root, 'qoder/.qoder-plugin/plugin.json'), 'utf8')).version;
const cleanups = new WeakMap();
before(async () => { await exec(process.execPath, ['scripts/build-qoder.mjs'], { cwd: root }); });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'qoder-taskflow-'));
  cleanups.set(t, []);
  t.after(async () => { for (const close of cleanups.get(t)) await close(); await rm(dir, { recursive: true, force: true }); });
  const call = (name, args = {}, sessionId = 'root') => execute(join(dir, 'data'), name, { sessionId, ...args });
  return { dir, call };
}
const plan = (call, tasks = [{ title: '实现功能' }]) => call('taskflow_plan', { title: '升级功能', goal: '真实交付并验证', tasks });
const start = (call, taskId = 'T-001', sessionId) => call('taskflow_start', { taskId }, sessionId);
const attempt = t => ({ taskId: t.id, attemptId: t.attempt.id, version: t.version });
const claim = (call, started, sessionId) => call('taskflow_claim', { ...attempt(started.task), planSessionId: started.dispatch.planSessionId }, sessionId);
const finish = (call, t, sessionId, extra = {}) => call('taskflow_complete', { ...attempt(t), status: 'completed', summary: '实际验证通过，产物 src/module.js', ...extra }, sessionId);

test('Qoder：独立项目目录隔离，规范化项目路径', async t => {
  const { dir } = await fixture(t); await mkdir(join(dir, 'a')); await mkdir(join(dir, 'b'));
  const base = join(dir, 'state');
  const a = await projectDirectory(join(dir, 'a'), base), b = await projectDirectory(join(dir, 'b'), base);
  assert.notEqual(a, b); assert.equal(a, await projectDirectory(join(dir, 'a', '.'), base));
  assert.ok(a.startsWith(base));
  assert.notEqual(await projectDirectory(join(dir, 'a'), '${QODER_PLUGIN_DATA}'), a);
});

test('Qoder：持久计划跨 MCP 操作保留，已有计划不覆盖，任务依赖生效', async t => {
  const { call } = await fixture(t);
  await plan(call, [{ title: '勘察', ref: 'a' }, { title: '实现', dependsOn: ['a'] }]);
  await assert.rejects(plan(call), { code: 'exists' });
  await assert.rejects(start(call, 'T-002'), { code: 'dependency' });
  const a = await start(call); await finish(call, a.task);
  await start(call, 'T-002');
  const view = await call('taskflow_status');
  assert.equal(view.plan.tasks['T-001'].status, 'completed'); assert.equal(view.plan.tasks['T-002'].status, 'running');
});

test('Qoder：规划不创建会话，按需真实身份认领，不接受父会话冒充', async t => {
  const { call, dir } = await fixture(t); await plan(call, [{ title: '独立事项', mode: 'delegate' }]);
  assert.deepEqual(Object.keys((await snapshot(join(dir, 'data'))).sessions), ['root']);
  const a = await start(call); assert.equal(a.task.status, 'queued');
  assert.deepEqual(Object.keys((await snapshot(join(dir, 'data'))).sessions), ['root']);
  await assert.rejects(claim(call, a, 'root'), { code: 'forbidden' });
  const child = await claim(call, a, 'real-agent-42');
  assert.equal(child.executionSessionId, 'real-agent-42'); assert.equal(child.executionCreated, true);
  assert.deepEqual(await claim(call, a, 'real-agent-42'), child);
  await assert.rejects(finish(call, child, 'root'), { code: 'forbidden' });
  await finish(call, child, 'real-agent-42');
});

test('Qoder：委派要求可见原生聊天会话，独立 session_id 绑定，拒绝跨计划身份与迟到认领', async t => {
  const { call } = await fixture(t);
  await plan(call, [{ title: '可见子会话事项', mode: 'delegate' }]);
  const view = await call('taskflow_status');
  assert.equal(view.capabilities.delegation, 'qoder-native-chat-session');
  assert.equal(view.capabilities.nativeSidebar, undefined, '插件限制不能冒充宿主能力探测');
  assert.equal(view.capabilities.host.nativeChatSessions, 'discover-tools');
  const started = await start(call);
  assert.equal(started.dispatch.agent, undefined, '不得硬编码内嵌 Agent');
  assert.deepEqual(started.dispatch.execution, { kind: 'native-chat-session', visible: true, createTool: 'create_chat_session', callbackMode: 'supervise', waitTool: 'wait_chat_sessions', readTool: 'read_chat_session', allowEmbeddedAgent: false });
  assert.match(started.dispatch.workerInstructions, /session_id/);
  await call('taskflow_plan', { title: '另一计划', goal: '隔离', tasks: [{ title: '其他工作' }] }, 'other-root');
  await assert.rejects(claim(call, started, 'other-root'), { code: 'forbidden' });
  await call('taskflow_pause', { taskId: started.task.id, version: started.task.version, reason: '宿主创建失败' });
  const retry = await start(call);
  const sid = '33d70306-488c-4de6-901d-2f58c4a48b2e';
  await assert.rejects(claim(call, started, sid), { code: 'stale' });
  const child = await claim(call, retry, sid);
  assert.equal(child.executionSessionId, sid);
  assert.equal((await call('taskflow_status', {}, sid)).currentTaskId, child.id);
  await assert.rejects(finish(call, child, 'root'), { code: 'forbidden' });
  await finish(call, child, sid);
  const notice = (await call('taskflow_notifications')).notifications[0];
  assert.equal(notice.targetSessionId, 'root');
  assert.equal(notice.taskId, child.id);
});

test('Qoder：全树并发限制，等待下级释放名额，恢复重新竞争名额', async t => {
  const { call } = await fixture(t);
  await plan(call, ['a', 'b', 'c'].map(title => ({ title, mode: 'delegate' })));
  const a = await start(call, 'T-001'), b = await start(call, 'T-002'), c = await start(call, 'T-003');
  const ca = await claim(call, a, 'a'), cb = await claim(call, b, 'b');
  await assert.rejects(claim(call, c, 'c'), { code: 'concurrency' });
  await call('taskflow_wait', attempt(ca), 'a');
  const cc = await claim(call, c, 'c');
  await assert.rejects(call('taskflow_resume', attempt(ca), 'a'), { code: 'concurrency' });
  await finish(call, cb, 'b'); await call('taskflow_resume', attempt(ca), 'a');
  await finish(call, ca, 'a'); await finish(call, cc, 'c');
});

test('Qoder：嵌套事项按直接父归属，完成摘要只通知直接父 Agent', async t => {
  const { call } = await fixture(t);
  await plan(call, [{ title: '父事项', mode: 'delegate' }]);
  const a = await claim(call, await start(call), 'parent-agent');
  await call('taskflow_assess', { ...attempt(a), needsSplit: true, reason: '实现和验证具有独立产物' }, 'parent-agent');
  await call('taskflow_add', { tasks: [{ title: '子事项', mode: 'delegate' }] }, 'parent-agent');
  const b = await start(call, 'T-002', 'parent-agent'); assert.equal(b.dispatch.planSessionId, 'parent-agent');
  await call('taskflow_wait', attempt(a), 'parent-agent');
  const cb = await claim(call, b, 'child-agent'); await finish(call, cb, 'child-agent');
  assert.equal((await call('taskflow_notifications')).notifications.length, 0);
  const notice = (await call('taskflow_notifications', {}, 'parent-agent')).notifications[0]; assert.equal(notice.targetSessionId, 'parent-agent');
  await call('taskflow_notifications', { ack: [notice.id] }, 'parent-agent');
  assert.equal((await call('taskflow_notifications', {}, 'parent-agent')).notifications.length, 0);
  await call('taskflow_resume', attempt(a), 'parent-agent'); await finish(call, a, 'parent-agent');
  assert.equal((await call('taskflow_notifications')).notifications[0].taskId, 'T-001');
});

test('Qoder：未启动父项不能偷挂，孙层之后遵守深度限制', async t => {
  const { call } = await fixture(t);
  await plan(call, [{ title: '父', ref: 'a', mode: 'delegate' }, { title: '子', parentId: 'a', ref: 'b', mode: 'delegate' }, { title: '孙', parentId: 'b', mode: 'delegate' }]);
  await assert.rejects(start(call, 'T-002'), { code: 'owner' });
  await claim(call, await start(call), 'a');
  await claim(call, await start(call, 'T-002', 'a'), 'b');
  const c = await start(call, 'T-003', 'b'); assert.equal(c.task.mode, 'inline'); assert.equal(c.dispatch, null);
});

test('Qoder：默认增补在当前事项下，显式根级新增，歧义不静默改挂', async t => {
  const { call } = await fixture(t); await plan(call, [{ title: '重复' }, { title: '重复' }]);
  await start(call); const [a] = await call('taskflow_add', { tasks: [{ title: '默认子项' }] }); assert.equal(a.parentId, 'T-001');
  const [b] = await call('taskflow_add', { parentId: null, tasks: [{ title: '根事项' }] }); assert.equal(b.parentId, null);
  await assert.rejects(call('taskflow_add', { parentId: '重复', tasks: [{ title: '歧义' }] }), { code: 'ambiguous' });
  await assert.rejects(call('taskflow_update', { taskId: 'T-003', version: 1, patch: { dependsOn: ['T-001'] } }), { code: 'cycle' });
});

test('Qoder：需求变更后旧结果与旧记录失效，旧通知不会串到新版本', async t => {
  const { call } = await fixture(t); await plan(call);
  const old = (await start(call)).task; await finish(call, old);
  await call('taskflow_update', { taskId: old.id, version: old.version, patch: { instructions: '新要求' } });
  assert.equal((await call('taskflow_notifications')).notifications.length, 0);
  await assert.rejects(finish(call, old), { code: 'stale' });
  await assert.rejects(call('taskflow_progress', { ...attempt(old), summary: '迟到过程' }), { code: 'stale' });
  const next = (await start(call)).task; assert.notEqual(old.attempt.id, next.attempt.id); await finish(call, next);
  assert.equal((await call('taskflow_notifications')).notifications.length, 1);
});

test('Qoder：明确中断后保留历史重试，旧子 Agent 不能完成新尝试', async t => {
  const { call } = await fixture(t); await plan(call, [{ title: '委派', mode: 'delegate' }]);
  const old = await claim(call, await start(call), 'old-child');
  await call('taskflow_progress', { ...attempt(old), summary: '完成初步调查' }, 'old-child');
  await call('taskflow_pause', { taskId: old.id, version: old.version, reason: '确认旧执行已中断' });
  const next = await claim(call, await start(call), 'new-child');
  await assert.rejects(finish(call, old, 'old-child'));
  await finish(call, next, 'new-child');
  const task = (await call('taskflow_status')).plan.tasks[old.id];
  assert.equal(task.history.filter(h => h.kind === 'qoder-progress').length, 1); assert.equal(task.sessionHistory[0].sessionId, 'old-child');
});

test('Qoder：受阻/失败不假称完成，父项不能提前完成，通知按父隔离', async t => {
  const { call } = await fixture(t); await plan(call, [{ title: '父', ref: 'p' }, { title: '子', parentId: 'p' }]);
  const parent = (await start(call)).task; await assert.rejects(finish(call, parent), { code: 'children' });
  const child = (await start(call, 'T-002')).task; await finish(call, child, undefined, { status: 'blocked', summary: '缺少真实输入' });
  assert.equal((await call('taskflow_notifications')).notifications.length, 0);
  await assert.rejects(finish(call, parent), { code: 'children' });
  await assert.rejects(call('taskflow_notifications', { ack: ['another-session-notice'] }), { code: 'not-found' });
});

test('Qoder：新会话明确接续闲置计划，不隐式迁移活跃任务或丢失结果', async t => {
  const { call } = await fixture(t); await plan(call, [{ title: '完成' }, { title: '后续' }]);
  const a = (await start(call)).task;
  await assert.rejects(call('taskflow_attach', { planSessionId: 'root' }, 'new-root'), { code: 'busy' });
  await finish(call, a); await call('taskflow_attach', { planSessionId: 'root' }, 'new-root');
  const view = await call('taskflow_status', {}, 'new-root'); assert.equal(view.plan.tasks[a.id].status, 'completed');
  assert.equal(view.plan.tasks[a.id].executionSessionId, 'root');
  const next = await start(call, 'T-002', 'new-root'); await finish(call, next.task, 'new-root');
});

test('Qoder：多进程同时增补无丢失，无长期占用写入锁', async t => {
  const { call, dir } = await fixture(t); await plan(call);
  const program = `import {execute} from ${JSON.stringify(pathToFileURL(source).href)}; await execute(process.argv[1],'taskflow_add',{sessionId:'root',tasks:[{title:process.argv[2]}]});`;
  await Promise.all(Array.from({ length: 12 }, (_, i) => exec(process.execPath, ['--input-type=module', '-e', program, join(dir, 'data'), `进程 ${i}`])));
  const view = await call('taskflow_status'); assert.equal(Object.keys(view.plan.tasks).length, 13); assert.equal(view.plan.seq, 13);
});

test('Qoder：损坏账本不覆盖，读取失败保留原文件', async t => {
  const { call, dir } = await fixture(t); await mkdir(join(dir, 'data'));
  const path = join(dir, 'data/taskflow.json'), bytes = '{ broken state'; await writeFile(path, bytes);
  await assert.rejects(call('taskflow_status')); assert.equal(await readFile(path, 'utf8'), bytes);
});

async function connect(t, entry, cwd, base) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd, env: { ...process.env, TASKFLOW_QODER_DATA: base }, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', b => { stderr += b; });
  const client = new Client({ name: 'taskflow-integration', version: '1.0.0' });
  cleanups.get(t).push(async () => { await client.close(); assert.equal(stderr, '', 'runtime must not log errors on successful requests'); });
  await client.connect(transport); return client;
}

test('Qoder：ZIP 白名单、哈希、许可证与脱离源码的 MCP 握手/工具/资源', async t => {
  const { dir } = await fixture(t);
  const bytes = await readFile(join(root, `dist/qoder-taskflow-${version}.zip`));
  const report = JSON.parse(await readFile(join(root, 'dist/qoder-package-report.json'), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256);
  const files = unzipSync(bytes), installed = join(dir, "plugin with space 'quote' 中文");
  assert.ok(files['.qoder-plugin/plugin.json']); assert.ok(files['runtime/server.cjs']); assert.ok(files['THIRD_PARTY_NOTICES.txt']);
  const manifest = JSON.parse(Buffer.from(files['.qoder-plugin/plugin.json']).toString());
  for (const path of manifest.agents) { assert.match(path, /\.md$/); assert.ok(files[path.replace(/^\.\//, '')]); }
  for (const [path, data] of Object.entries(files)) {
    assert.ok(!path.includes('..') && !path.startsWith('/') && !path.includes('node_modules') && !path.includes('.local/'));
    await mkdir(dirname(join(installed, path)), { recursive: true }); await writeFile(join(installed, path), data);
  }
  const client = await connect(t, join(installed, 'runtime/server.cjs'), dir, join(dir, 'isolated-state'));
  assert.equal(client.getServerVersion().version, version, 'Distributed MCP must advertise the release version');
  const invoke = client.callTool.bind(client);
  client.callTool = request => invoke({ ...request, arguments: { projectPath: dir, ...request.arguments } });
  const listing = await client.listTools(); assert.equal(listing.tools.length, 18);
  const panel = listing.tools.find(t => t.name === 'taskflow_panel'); assert.equal(panel._meta.ui.resourceUri, PANEL_URI);
  assert.deepEqual(panel._meta['qoder/ui'].entrypoints, [{ type: 'thread' }]);
  assert.equal(panel.title, '任务'); assert.match(panel.icons[0].src, /^data:image\/svg\+xml,/);
  const planner = listing.tools.find(t => t.name === 'taskflow_plan');
  assert.equal(planner._meta.ui.resourceUri, PANEL_URI);
  assert.equal(planner._meta['qoder/ui'], undefined);
  const emptyPanel = await invoke({ name: 'taskflow_panel', arguments: {} });
  assert.deepEqual(emptyPanel.structuredContent, { plan: null, contextRequired: true });
  const hostPanel = sessionId => invoke({ name: 'taskflow_panel', arguments: {}, _meta: { 'com.qoder/turnContext': { sessionId } } });
  assert.equal((await hostPanel('no-plan')).structuredContent.plan, null);
  const bad = await client.callTool({ name: 'taskflow_plan', arguments: { sessionId: 'root', title: 'bad' } }); assert.equal(bad.isError, true);
  const create = await client.callTool({ name: 'taskflow_plan', arguments: { sessionId: 'root', title: '独立安装包', goal: '完整 MCP 协议', tasks: [{ title: '实现' }] } }); assert.ok(!create.isError);
  assert.equal(create.structuredContent.plan.title, '独立安装包');
  const startResult = await client.callTool({ name: 'taskflow_start', arguments: { sessionId: 'root', taskId: 'T-001' } });
  const started = startResult.structuredContent.task;
  const completed = await client.callTool({ name: 'taskflow_complete', arguments: { sessionId: 'root', ...attempt(started), status: 'completed', summary: '验证通过' } }); assert.ok(!completed.isError);
  const state = await client.callTool({ name: 'taskflow_panel', arguments: { sessionId: 'root' } }); assert.equal(state.structuredContent.plan.tasks['T-001'].status, 'completed');
  const bound = await hostPanel('root');
  assert.equal(bound.structuredContent.plan.title, '独立安装包');
  assert.equal(bound.structuredContent.projectPath, await realpath(dir));
  // The same long-lived MCP process must route two workspaces independently,
  // even with identical session IDs and a startup cwd in neither workspace.
  const other = join(dir, 'second-project'); await mkdir(other);
  const second = await client.callTool({ name: 'taskflow_plan', arguments: { projectPath: other, sessionId: 'root', title: '另一项目', goal: '隔离', tasks: [{ title: '不能串账' }] } });
  assert.ok(!second.isError);
  const original = await client.callTool({ name: 'taskflow_status', arguments: { sessionId: 'root' } });
  assert.equal(original.structuredContent.plan.title, '独立安装包');
  const missingPath = await invoke({ name: 'taskflow_status', arguments: { sessionId: 'root' } });
  assert.equal(missingPath.isError, true);
  assert.equal((await hostPanel('root')).isError, true, 'ambiguous sessions never pick a project');
  await client.callTool({ name: 'taskflow_plan', arguments: { projectPath: other, sessionId: 'unique-session', title: '当前会话计划', goal: '精确绑定', tasks: [{ title: '当前任务' }] } });
  assert.equal((await hostPanel('unique-session')).structuredContent.plan.title, '当前会话计划');
  assert.equal((await hostPanel('no-plan')).structuredContent.plan, null);
  await client.callTool({ name: 'taskflow_attach', arguments: { projectPath: other, sessionId: 'resumed-session', planSessionId: 'unique-session' } });
  assert.equal((await hostPanel('resumed-session')).structuredContent.plan.title, '当前会话计划');
  assert.equal((await hostPanel('unique-session')).structuredContent.plan.title, '当前会话计划');
  const resource = await client.readResource({ uri: PANEL_URI });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app'); assert.match(resource.contents[0].text, /待办任务清单/);
  assert.deepEqual(resource.contents[0]._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.deepEqual(resource.contents[0]._meta.csp, resource.contents[0]._meta.ui.csp);
  assert.equal(resource.contents[0]._meta['qoder/ui'].preferredDisplayMode, 'inline');
});

test('Qoder：Hook 注入真实会话身份，能冷读取原计划；无身份时不伪造', async t => {
  const { dir } = await fixture(t), base = join(dir, 'state');
  const directory = await projectDirectory(dir, base);
  await execute(directory, 'taskflow_plan', { sessionId: 'known', title: '历史计划', goal: '继续工作', tasks: [{ title: '事项' }] });
  const run = input => new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [join(root, 'dist/qoder-taskflow/runtime/hook.cjs')], { env: { ...process.env, TASKFLOW_QODER_DATA: base } }, (err, stdout, stderr) => err ? reject(err) : resolve({ stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
  const main = await run({ hook_event_name: 'SessionStart', session_id: 'known', cwd: dir });
  const output = JSON.parse(main.stdout); assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(output.hookSpecificOutput.additionalContext, /历史计划/); assert.equal(main.stderr, '');
  assert.ok(output.hookSpecificOutput.additionalContext.includes(JSON.stringify(await realpath(dir))));
  const child = JSON.parse((await run({ hook_event_name: 'SubagentStart', session_id: 'known', agent_id: 'real-child', cwd: dir })).stdout);
  assert.match(child.hookSpecificOutput.additionalContext, /real-child/);
  assert.deepEqual(JSON.parse((await run({ hook_event_name: 'SessionStart', cwd: dir })).stdout), {});
});

test('Qoder：实际打包面板完成 MCP Apps 握手、展开记录、安全 Markdown 和刷新', async t => {
  const { call } = await fixture(t);
  await plan(call, [{ title: '父事项', ref: 'p' }, { title: '子事项', parentId: 'p' }]);
  const a = (await start(call)).task;
  await call('taskflow_progress', { ...attempt(a), summary: '# 检查结果\n\n| 项目 | 结果 |\n| --- | --- |\n| 校验 | 通过 |\n\n<script>window.compromised=1</script>\n\n[危险](javascript:alert(1))' });
  let view = await call('taskflow_status'), initialized = false;
  const toolCalls = [];
  const errors = [], virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e => errors.push(e.message)); virtualConsole.on('error', e => errors.push(String(e)));
  const send = (window, message) => window.dispatchEvent(new window.MessageEvent('message', { data: message, source: window }));
  const dom = new JSDOM(await readFile(join(root, 'dist/qoder-taskflow/runtime/panel.html'), 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://taskflow.test/', virtualConsole,
    beforeParse(window) {
      window.ResizeObserver = class { observe() {} disconnect() {} };
      window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
      window.postMessage = message => queueMicrotask(() => {
        if (message.method === 'ui/initialize') send(window, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'test-host', version: '1.0' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'dark' } } });
        else if (message.method === 'ui/notifications/initialized') {
          initialized = true;
          send(window, { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: { sessionId: 'root', projectPath: '/test/project' } } });
          send(window, { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [{ type: 'text', text: JSON.stringify(view) }], structuredContent: view } });
        } else if (message.method === 'tools/call') {
          toolCalls.push(message.params); send(window, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(view) }], structuredContent: view } });
        }
      });
    },
  });
  cleanups.get(t).push(() => dom.window.close());
  const until = async fn => { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error(`Panel condition timed out: ${errors.join('; ')} ${dom.window.document.body.textContent.slice(0, 600)}`); await new Promise(r => setTimeout(r, 10)); } };
  await until(() => initialized && dom.window.document.querySelectorAll('[role="treeitem"]').length === 2);
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  send(dom.window, { jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } });
  await new Promise(r => setTimeout(r, 10));
  assert.equal(dom.window.document.documentElement.dataset.theme, 'dark', 'partial host context must preserve the theme');
  dom.window.document.querySelector('.task-label').click();
  await until(() => dom.window.document.querySelector('.detail table'));
  assert.equal(dom.window.document.querySelectorAll('.detail script, .detail img, .detail a[href^="javascript:"]').length, 0);
  assert.equal(dom.window.compromised, undefined);
  assert.match(dom.window.document.querySelector('.detail').textContent, /检查结果/);
  assert.equal(dom.window.document.querySelectorAll('[role="treeitem"]').length, 2, 'selecting a task does not hide children');
  dom.window.document.querySelector('.arrow').click();
  await until(() => dom.window.document.querySelectorAll('[role="treeitem"]').length === 1);
  dom.window.document.querySelector('.arrow').click();
  await until(() => dom.window.document.querySelectorAll('[role="treeitem"]').length === 2);
  view = structuredClone(view); view.plan.tasks['T-002'].status = 'completed';
  dom.window.document.querySelector('header button').click();
  await until(() => toolCalls.length >= 1 && dom.window.document.querySelectorAll('.status')[1]?.textContent === '已完成');
  assert.ok(toolCalls.every(c => c.name === 'taskflow_panel' && c.arguments.sessionId === 'root' && c.arguments.projectPath === '/test/project'));
  assert.ok(!dom.window.document.body.textContent.includes('/test/project'));
  assert.ok(!dom.window.document.body.textContent.includes('选择其他计划'));
  send(dom.window, { jsonrpc: '2.0', id: 'host-teardown', method: 'ui/resource-teardown', params: {} });
  await until(() => dom.window.document.querySelector('header button').disabled);
  assert.deepEqual(errors, []);
});

test('Qoder：会话入口空参数跟随宿主、空计划自动出现、切换拒绝迟到结果并释放轮询', async t => {
  const { call } = await fixture(t); await plan(call, [{ title: '旧会话任务' }]);
  const oldView = await call('taskflow_status');
  const newView = structuredClone(oldView); newView.plan.id = 'new-plan'; newView.plan.tasks['T-001'].title = '新会话任务'; newView.sessionId = 'new-session';
  const calls = [], errors = [];
  let initialized = false, held = null, nextView = { plan: null, sessionId: 'root', notifications: [] }, hold = false;
  const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', e => errors.push(e.message));
  const send = (window, message) => window.dispatchEvent(new window.MessageEvent('message', { data: message, source: window }));
  const result = (window, id, view) => send(window, { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(view) }], structuredContent: view } });
  const dom = new JSDOM(await readFile(join(root, 'dist/qoder-taskflow/runtime/panel.html'), 'utf8'), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://taskflow.test/', virtualConsole,
    beforeParse(window) {
      window.ResizeObserver = class { observe() {} disconnect() {} };
      window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
      window.postMessage = message => queueMicrotask(() => {
        if (message.method === 'ui/initialize') send(window, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2026-01-26', hostInfo: { name: 'test', version: '1' }, hostCapabilities: { serverTools: {} }, hostContext: { theme: 'light', displayMode: 'fullscreen' } } });
        else if (message.method === 'ui/notifications/initialized') {
          initialized = true;
          send(window, { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } });
          send(window, { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: nextView } });
        } else if (message.method === 'tools/call') {
          calls.push(message.params);
          if (hold) held = { window, id: message.id }; else result(window, message.id, nextView);
        }
      });
    },
  });
  cleanups.get(t).push(() => dom.window.close());
  const until = async fn => { const end = Date.now() + 4500; while (!fn()) { if (Date.now() > end) throw new Error(`Panel timed out: ${errors.join('; ')} ${dom.window.document.body.textContent.slice(0, 500)}`); await new Promise(r => setTimeout(r, 10)); } };
  const body = () => dom.window.document.body.textContent;
  const button = () => dom.window.document.querySelector('header button');
  await until(() => initialized && body().includes('当前会话暂无任务') && !button().disabled);
  nextView = oldView;
  // Visible polling discovers a newly planned task without a tool-result event.
  await until(() => body().includes('旧会话任务'));
  assert.ok(calls.length > 0 && calls.every(c => c.name === 'taskflow_panel' && Object.keys(c.arguments).length === 0));
  await until(() => !button().disabled);
  hold = true; button().click(); await until(() => held);
  const stale = held;
  send(dom.window, { jsonrpc: '2.0', method: 'ui/notifications/tool-input', params: { arguments: {} } });
  send(dom.window, { jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { structuredContent: newView } });
  await until(() => body().includes('新会话任务'));
  result(stale.window, stale.id, oldView);
  await new Promise(r => setTimeout(r, 30));
  assert.equal(dom.window.document.querySelector('.tree .title').textContent, '新会话任务');
  assert.ok(calls.every(c => Object.keys(c.arguments).length === 0), 'result session IDs must never pin a thread panel');
  const before = calls.length;
  send(dom.window, { jsonrpc: '2.0', id: 'teardown', method: 'ui/resource-teardown', params: {} });
  await until(() => button().disabled);
  dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));
  await new Promise(r => setTimeout(r, 3100));
  assert.equal(calls.length, before); assert.deepEqual(errors, []);
});
