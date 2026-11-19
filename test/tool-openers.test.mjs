import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolOpeners, sessionFileAddress } from '../src/client/tool-openers.mjs';

test('宿主插件打开：原生文件地址、格式插件检测、前台会话隔离及浏览器参数', async () => {
  const calls = []; let sid = 'parent', supported = true;
  const opener = createToolOpeners({ sidebarRight: { mounted: { getSnapshot: () => sid }, openResource: (...a) => calls.push(a), openTab: (...a) => calls.push(a) }, sidebarRightTabs: { claim: () => { if (!supported) throw new Error('unclaimed'); return { kind: 'text' }; }, get: () => supported } });
  const path = 'C:\\工作目录\\a #?%.docx';
  await opener.openDocument('parent', { path }); assert.deepEqual(calls.pop(), [sessionFileAddress('parent', path), { destination: 'float' }]); assert.match(sessionFileAddress('parent', path), /C:\/%E5/); assert.match(sessionFileAddress('parent', path), /%23%3F%25/);
  await opener.openBrowser('parent', 'https://example.com'); assert.deepEqual(calls.pop(), ['browser', { params: { url: 'https://example.com' } }]);
  sid = 'other'; await assert.rejects(opener.openDocument('parent', { path }), /先打开此任务会话/); assert.equal(calls.length, 0);
  sid = 'parent'; supported = false; await assert.rejects(opener.openDocument('parent', { path }), /文档预览插件尚未就绪/); await assert.rejects(opener.openBrowser('parent', 'https://example.com'), /尚未就绪/);
});

test('所有文档由宿主预览，不访问未注入的 remote.workspaceFiles 或 documentPreviews', async () => {
  const calls = [], claimed = [];
  const services = { sidebarRight: { mounted: { getSnapshot: () => 'p' }, openResource: (...args) => calls.push(args) }, sidebarRightTabs: { claim: address => { claimed.push(address); return { kind: 'text' }; } } };
  const opener = createToolOpeners({ get(name) { assert.ok(name in services, `cannot get property ${name} without inject`); return services[name]; } });
  for (const ext of ['md', 'markdown', 'xlsx', 'xls', 'csv', 'tsv', 'doc', 'docx', 'ppt', 'pptx', 'pdf']) {
    const file = { path: `输出/预览.${ext}` };
    assert.equal(await opener.openDocument('p', file), '已交给文档插件打开');
    assert.deepEqual(calls.at(-1), [sessionFileAddress('p', file.path), { destination: 'float' }]);
  }
  assert.equal(calls.length, 11); assert.deepEqual(claimed, calls.map(call => call[0]));
  services.sidebarRight.openResource = async () => { throw new Error('宿主预览打开失败'); };
  await assert.rejects(opener.openDocument('p', { path: 'a.md' }), /宿主预览打开失败/);
});
