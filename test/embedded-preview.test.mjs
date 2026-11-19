import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { embedPreview } from '../src/client/embedded-preview.mjs';
import { createToolOpeners } from '../src/client/tool-openers.mjs';

test('宿主文档预览随工具视口定位、裁剪和悬浮，切会话隐藏，释放仅关闭自己的标签', async () => {
  const dom = new JSDOM('<aside class="tf-tool"><div class="tool-content"><div id="target"></div></div></aside><div data-dockkit-host="float"><div data-dockkit-float="ours" style="left:9px"><header data-dockkit-float-grip></header><div data-sidebar-right-tab="doc-1">实际插件正文</div></div></div><div data-dockkit-float="user">用户原文档</div>', { pretendToBeVisual: true });
  const doc = dom.window.document, container = doc.getElementById('target'), pane = doc.querySelector('[data-dockkit-float="ours"]'), host = pane.parentElement;
  let sid = 's', rect = { left: 40, top: 100, right: 440, bottom: 500, width: 400, height: 400 };
  container.getBoundingClientRect = () => rect;
  container.parentElement.getBoundingClientRect = () => ({ left: 40, top: 80, right: 460, bottom: 400 });
  const closed = [], sidebar = { mounted: { getSnapshot: () => sid }, closeIn: (...args) => closed.push(args) };
  const nextFrame = () => new Promise(resolve => dom.window.requestAnimationFrame(resolve));
  let dispose;
  try {
    dispose = embedPreview({ sidebar, sessionId: 's', tabId: 'doc-1', container });
    assert.equal(pane.style.left, '40px'); assert.equal(pane.style.width, '400px'); assert.equal(pane.style.visibility, 'visible'); assert.match(pane.style.clipPath, /100px/);
    assert.equal(doc.querySelector('[data-sidebar-right-tab]').parentElement, pane, '不搬动宿主节点');
    container.closest('aside').classList.add('tf-tool-floating'); rect = { ...rect, left: 120, right: 520, width: 400 };
    await nextFrame(); assert.equal(pane.style.left, '120px'); assert.equal(host.style.getPropertyValue('--dsh-dockkit-float-layer'), '1201');
    sid = 'other'; await nextFrame(); assert.equal(pane.style.visibility, 'hidden');
    dispose(); dispose(); assert.deepEqual(closed, [['s', 'doc-1']]); assert.equal(pane.style.left, '9px'); assert.equal(host.style.getPropertyValue('--dsh-dockkit-float-layer'), '');
    assert.equal(pane.classList.contains('tf-host-preview'), false); assert.equal(doc.querySelector('[data-dockkit-float="user"]').textContent, '用户原文档');
  } finally { dispose?.(); dom.window.close(); }
});

test('嵌入预览创建独立标签并恢复任务面板，不移动用户已有文档；失败清理新标签', async () => {
  const dom = new JSDOM('<div id="target"></div>', { pretendToBeVisual: true });
  const calls = []; let active = { id: 'tasks', kind: 'taskflow' }, expanded = false, fail = false;
  const sidebar = { mounted: { getSnapshot: () => 's' }, active: () => active, isExpanded: () => expanded,
    openResource: (address, options) => { calls.push(['open', options]); expanded = true; active = { id: 'owned-preview', contentId: address }; },
    float: id => { calls.push(['float', id]); if (fail) throw new Error('宿主悬浮失败'); },
    focus: id => { active = { id, kind: 'taskflow' }; }, toggleExpanded: () => { expanded = !expanded; }, closeIn: (...args) => calls.push(['close', ...args]) };
  try {
    const openers = createToolOpeners({ sidebarRight: sidebar, sidebarRightTabs: { claim: () => ({ kind: 'text' }) } });
    const preview = await openers.openDocument('s', { path: 'a.md' }, { container: dom.window.document.getElementById('target') });
    assert.equal(preview.message, '已在工具视图中打开'); assert.equal(active.id, 'tasks'); assert.equal(expanded, false);
    assert.deepEqual(calls.slice(0, 2), [['open', { revealIfOpened: false }], ['float', 'owned-preview']]);
    preview.dispose(); assert.deepEqual(calls.at(-1), ['close', 's', 'owned-preview']);
    fail = true; await assert.rejects(openers.openDocument('s', { path: 'b.pdf' }, { container: dom.window.document.getElementById('target') }), /悬浮失败/);
    assert.deepEqual(calls.at(-1), ['close', 's', 'owned-preview']);
  } finally { dom.window.close(); }
});
