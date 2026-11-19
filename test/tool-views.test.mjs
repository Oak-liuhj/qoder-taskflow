import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit';
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';
import { registerToolViews, outputFiles } from '../src/server/tool-views.mjs';

test('真实工具管线：读取 arguments、识别已生成文档、浏览器地址和失败结果', async () => {
  const ctx = new Context(), service = new TaskService(new MemoryStore()), errors = [];
  try {
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true });
    const harness = await mountAgentLoopTestHarness(ctx), agent = await harness.create('view-parent', {}, { cwd: process.cwd() });
    await service.create(agent.session.id, { title: '文档', goal: '文档视图', tasks: [{ title: '生成产物' }] });
    registerToolViews(ctx, service, e => errors.push(e));
    for (const [name, execute] of [
      ['write_document', args => ({ filePath: args.path })],
      ['browser_navigate', args => ({ url: args.url, title: '目标页面' })],
      ['browser_click', () => ({ url: 'https://example.com/after-click' })],
      ['bad_write', () => { throw new Error('生成失败'); }],
    ]) ctx.tools.register(defineTool({ name, description: name, parameters: { path: { type: 'string' }, url: { type: 'string' } }, output: { schema: { type: 'json' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] }, execute }));
    let seq = 0;
    const call = async (name, args) => {
      const signal = new AbortController().signal, id = `view-${++seq}`;
      // 0.2.1-rc.3 accepts one parsed call; 0.2.2 selects a batch executor.
      // Exercise the host's real pipeline with its documented input contract.
      const result = await ctx.tools.execute(typeof ctx.tools.selectExecutor === 'function'
        ? { agent, signal, calls: [{ type: 'tool-call', id, name, arguments: JSON.stringify(args) }] }
        : { agent, signal, callId: id, name, arguments: args });
      await service.store.tail; return result;
    };
    for (const [path, format] of [['notes.md', 'markdown'], ['表格.xlsx', 'excel'], ['方案.docx', 'word'], ['汇报.pptx', 'powerpoint'], ['报告.pdf', 'pdf']]) {
      await call('write_document', { path }); const view = service.view(agent.session.id).tool;
      assert.equal(view.phase, 'ready'); assert.deepEqual(view.files, [{ path, format }]); assert.equal(view.sourceTool, 'write_document');
    }
    await call('browser_navigate', { url: 'https://example.com/start' }); assert.equal(service.view(agent.session.id).tool.url, 'https://example.com/start');
    await call('browser_click', {}); assert.equal(service.view(agent.session.id).tool.url, 'https://example.com/after-click');
    await call('bad_write', { path: 'ghost.pdf' }); const failed = service.view(agent.session.id).tool;
    assert.equal(failed.phase, 'failed'); assert.equal(failed.autoOpen, false); assert.deepEqual(failed.files, []); assert.match(failed.content, /生成失败/);
    assert.deepEqual(errors, []);
  } finally { await ctx.fiber.dispose(); }
});

test('工具完成竞态：旧结果不覆盖新操作，关闭后不重新打开，识别不扫描命令正文', async () => {
  const service = new TaskService(new MemoryStore()); await service.create('p', { title: 'p', goal: 'p', tasks: [{ title: 'p' }] });
  await service.openView('p', { id: 'old', kind: 'terminal' }); await service.openView('p', { id: 'new', kind: 'browser', url: 'https://example.com' });
  await service.openView('p', { id: 'old', expectedId: 'old', kind: 'editor', filePath: 'old.docx' }); assert.equal(service.view('p').tool.id, 'new');
  await service.closeView('p'); await service.openView('p', { id: 'new', expectedId: 'new', requireOpen: true, kind: 'editor', filePath: 'late.pdf' }); assert.equal(service.view('p').tool.open, false);
  assert.deepEqual(outputFiles({ command: 'echo secret.pdf', content: 'do not treat notes.md as a file', files: [{ path: '实际.docx' }, 'file:///hidden.pdf', 'javascript:bad.md', 'https://host/a.pdf', 'C:/输出/报告.pdf'] }), ['实际.docx', 'C:/输出/报告.pdf']);
});
