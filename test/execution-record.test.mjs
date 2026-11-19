import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import * as ReactDOM from 'react-dom';
const { SlotCore } = await import(process.env.TASKFLOW_TEST_SLOTS ?? '@deepseek-ai/dsh-client-ui-slots');

async function component() {
  const compiled = await build({ entryPoints: ['src/client/components/execution-record.jsx'], bundle: true, write: false, format: 'esm', platform: 'node', packages: 'external' });
  await mkdir('.local/tests', { recursive: true }); await writeFile('.local/tests/execution-record.mjs', compiled.outputFiles[0].text);
  return import('../.local/tests/execution-record.mjs');
}

async function withDom(fn) {
  const dom = new JSDOM('<!doctype html><div id="record"></div>'), saved = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const container = dom.window.document.getElementById('record'), root = createRoot(container);
  try { await fn({ dom, container, root }); }
  finally { await act(async () => root.unmount()); dom.window.close(); for (const [name, value] of saved) value ? Object.defineProperty(globalThis, name, value) : delete globalThis[name]; }
}

const record = (summary, text, detail) => ({ source: { kind: 'taskflow', form: 'notice', summary, ...detail ? { record: { version: 1, ...detail } } : {} }, content: [{ type: 'text', text }] });

test('子任务过程默认展示真实正文，兼容旧日志、Markdown与工具结果，拒绝不安全HTML', async () => {
  const { ExecutionRecord, executionRecord } = await component();
  assert.equal(executionRecord(record('持久任务状态', '内部规划快照')), null);
  assert.equal(executionRecord({ source: { kind: 'other', summary: 'T-002 执行过程' }, content: [] }), null);
  await withDom(async ({ dom, container, root }) => {
    const legacy = record('T-002 执行过程', '## 关键发现\n\n已读取两份文档。\n\n| 文件 | 结果 |\n| --- | --- |\n| a.md | 通过 |\n\n```js\nconst count = 2;\n```\n\n<script>window.executed = true</script>\n\n[危险链接](javascript:alert(1))');
    await act(async () => root.render(React.createElement(ExecutionRecord, { data: legacy })));
    assert.match(container.textContent, /已读取两份文档/); assert.match(container.textContent, /关键发现/);
    assert.equal(container.querySelector('button').getAttribute('aria-expanded'), 'true');
    assert.equal(container.querySelector('table td').textContent, 'a.md'); assert.match(container.querySelector('pre').textContent, /const count = 2/);
    assert.equal(container.querySelector('script'), null); assert.equal(container.querySelector('a[href^="javascript:"]'), null);
    await act(async () => container.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.equal(container.querySelector('.tf-record-body'), null);
    await act(async () => container.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.match(container.textContent, /已读取两份文档/);
    await act(async () => root.render(React.createElement(ExecutionRecord, { key: 'tool', data: record('T-002 工具调用', '执行工具：read_file\n{"path":"a.md","lines":20}', { category: 'tool-call', tool: 'read_file' }) })));
    assert.match(container.querySelector('pre').textContent, /\n  "path": "a.md"/);
    await act(async () => root.render(React.createElement(ExecutionRecord, { key: 'result', data: record('T-002 工具结果', '{"error":"权限不足"}', { category: 'tool-result', tool: 'read_file', status: 'failed', durationMs: 1250 }) })));
    assert.match(container.textContent, /工具结果.*read_file.*失败.*1.3s/s); assert.match(container.querySelector('pre').textContent, /权限不足/);
  });
});

test('原生SlotCore只替换Taskflow记录展示，其他上下文透传，宿主重载与卸载恢复原生组件', async () => {
  const { registerExecutionRecords } = await component(), core = new SlotCore(), seat = 'conversation.chat.node';
  const removeRoot = core.register({ name: 'root', children: { [seat]: { kind: 'keyed', scope: 'session' } } }, () => null);
  const Original = props => React.createElement('p', { 'data-original': props.marker }, '原生上下文：' + props.node.data.content[0].text);
  let removeOriginal = core.register({ name: seat, key: 'context' }, Original);
  const cleanups = [], ctx = { slots: { entries: key => core.entries(key), subscribe: (key, fn) => core.subscribe(key, fn), register: (options, C) => core.register(options, C), inject: (_key, fn) => fn() }, effect: fn => { const off = fn(); if (off) cleanups.push(off); } };
  const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  try {
    registerExecutionRecords(ctx); await settle();
    assert.notEqual(core.entriesOfSlot(seat)[0].component, Original);
    await withDom(async ({ container, root }) => {
      let Renderer = core.entriesOfSlot(seat)[0].component;
      const data = record('T-002 执行进展', '实际读取完成，样本数为 2。');
      await act(async () => root.render(React.createElement(Renderer, { node: { data } })));
      assert.match(container.textContent, /实际读取完成/); assert.equal(container.querySelector('[data-original]'), null);
      const native = { source: { kind: 'skill' }, content: [{ type: 'text', text: '技能原文' }] };
      await act(async () => root.render(React.createElement(Renderer, { marker: 'preserved', node: { data: native } })));
      assert.equal(container.querySelector('[data-original]').dataset.original, 'preserved'); assert.match(container.textContent, /原生上下文：技能原文/);
      removeOriginal(); await settle();
      const Reloaded = props => React.createElement('p', { 'data-reloaded': true }, props.node.data.content[0].text);
      removeOriginal = core.register({ name: seat, key: 'context' }, Reloaded); await settle();
      Renderer = core.entriesOfSlot(seat)[0].component;
      await act(async () => root.render(React.createElement(Renderer, { node: { data: native } })));
      assert.ok(container.querySelector('[data-reloaded]'));
      cleanups.splice(0).reverse().forEach(fn => fn()); await settle();
      assert.equal(core.entriesOfSlot(seat)[0].component, Reloaded);
    });
  } finally { cleanups.reverse().forEach(fn => fn()); removeOriginal(); removeRoot(); }
});

test('实际发布客户端加载旧/新记录，模型信息与正文可见，反复启停不累积槽位或样式', async () => {
  const source = await readFile(process.env.TASKFLOW_TEST_CLIENT ?? 'client.js', 'utf8');
  await withDom(async ({ dom, container, root }) => {
    let plugin;
    const browser = dom.window;
    browser.__ModuleLoader__ = { load({ id, factory }) { assert.equal(id, 'dsh-taskflow'); plugin = factory(name => { if (name === 'react') return React; if (name === 'react-dom') return ReactDOM; throw new Error(`Unexpected runtime import: ${name}`); }); } };
    vm.runInNewContext(source, { window: browser, document: browser.document, console }, { timeout: 5000 });
    const core = new SlotCore(), seat = 'conversation.chat.node';
    const removeRoot = core.register({ name: 'root', children: { [seat]: { kind: 'keyed', scope: 'session' } } }, () => null);
    const Native = props => React.createElement('p', { 'data-native': true }, props.node.data.content[0].text);
    const removeNative = core.register({ name: seat, key: 'context', priority: 20 }, Native);
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    const cleanups = [];
    const ctx = { slots: { entries: key => core.entries(key), subscribe: (key, fn) => core.subscribe(key, fn), register: (options, C) => core.register(options, C), inject: (key, fn) => { assert.equal(key, seat); return fn(); } }, connection: { rpc: { call() { throw new Error('Rendering records must not call the model or server'); } } }, sessions: {}, provide() {}, inject() {}, effect: fn => { const off = fn(); if (off) cleanups.push(off); } };
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        plugin.apply(ctx); await settle();
        assert.equal(core.entries(seat).length, 2); assert.equal(document.querySelectorAll('style[data-dsh-taskflow]').length, 1);
        const Renderer = core.entriesOfSlot(seat)[0].component;
        assert.equal(core.entriesOfSlot(seat)[0].options.priority, 19);
        const old = record('T-002 执行过程', '旧记录实际结果：发现 2 个入口。');
        const model = record('T-002 模型输出', '## 校验步骤\n\n- 读取入口\n- 校验结果：2 项通过', { category: 'model-output', model: { provider: 'fixture', model: 'journal-test' } });
        await act(async () => root.render(React.createElement('div', null, [old, model].map((data, i) => React.createElement(Renderer, { key: i, node: { data } })))));
        assert.equal(container.querySelectorAll('[aria-expanded="true"]').length, 2);
        assert.match(container.textContent, /旧记录实际结果/); assert.match(container.textContent, /fixture \/ journal-test/); assert.equal(container.querySelectorAll('li').length, 2);
        assert.match(document.querySelector('style[data-dsh-taskflow]').textContent, /\.tf-record-body/);
        await act(async () => root.render(null));
        cleanups.splice(0).reverse().forEach(fn => fn()); await settle();
        assert.equal(core.entries(seat).length, 1); assert.equal(core.entriesOfSlot(seat)[0].component, Native);
        assert.equal(document.querySelectorAll('style[data-dsh-taskflow]').length, 0);
      }
    } finally { cleanups.reverse().forEach(fn => fn()); removeNative(); removeRoot(); delete browser.__ModuleLoader__; }
  });
});

test('宿主上下文组件延迟加载时自动接入，空白及无关记录保持原生渲染', async () => {
  const { registerExecutionRecords } = await component(), core = new SlotCore(), seat = 'conversation.chat.node';
  const removeRoot = core.register({ name: 'root', children: { [seat]: { kind: 'keyed', scope: 'session' } } }, () => null);
  const cleanups = [], ctx = { slots: { entries: key => core.entries(key), subscribe: (key, fn) => core.subscribe(key, fn), register: (o, C) => core.register(o, C), inject: (_key, fn) => fn() }, effect: fn => cleanups.push(fn()) };
  const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  let removeNative;
  try {
    registerExecutionRecords(ctx); await settle(); assert.equal(core.entries(seat).length, 0);
    const Native = () => React.createElement('p', { 'data-native': true }, '原生展示');
    removeNative = core.register({ name: seat, key: 'context' }, Native); await settle();
    await withDom(async ({ container, root }) => {
      const Renderer = core.entriesOfSlot(seat)[0].component;
      for (const data of [record('T-002 执行过程', '   '), record('持久任务状态', '内部计划'), { source: { kind: 'skill', summary: 'T-002 执行过程' }, content: [{ type: 'text', text: '技能内容' }] }]) {
        await act(async () => root.render(React.createElement(Renderer, { node: { data } })));
        assert.ok(container.querySelector('[data-native]')); assert.equal(container.querySelector('.tf-execution-record'), null);
      }
    });
  } finally { cleanups.reverse().forEach(fn => fn?.()); removeNative?.(); removeRoot(); }
});
