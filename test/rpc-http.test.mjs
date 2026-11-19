import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import WebServer from '@deepseek-ai/dsh-host-webserver';
import * as Connection from '@deepseek-ai/dsh-client-connection';
import { installConnection } from '@deepseek-ai/dsh-client-connection/client';
const { registerRpc } = await import(process.env.TASKFLOW_TEST_RPC ? pathToFileURL(resolve(process.env.TASKFLOW_TEST_RPC)).href : '../src/server/rpc.mjs');
import { TaskService } from '../src/domain/task-service.mjs';
import { MemoryStore } from '../src/storage/task-store.mjs';

test('真实 WebServer + Connection：资源回退复现 405，精确 API 路由读写、鉴权、Gateway 共存和重载', async () => {
  const ctx = new Context(), clientCtx = new Context(), records = new Map();
  const service = new TaskService(new MemoryStore());
  await service.create('main', { title: 'HTTP 验收', goal: '验证真实传输', tasks: [{ title: '待办一' }] });
  try {
    // Authentication uses only this fixture's in-memory secret and cookie.
    ctx.provide('credentials', { async modifyRecord(key, update) {
      const next = await update(records.get(key));
      if (next !== undefined) records.set(key, next);
      return records.get(key);
    } });
    await ctx.plugin(Connection);
    const removeGateway = ctx.connection.rpc.intercept('/api', method => method === 'gateway/ping', async () => ({ ok: true, value: 'gateway' }));
    assert.throws(() => ctx.connection.rpc.intercept('/api', () => true, async () => ({ ok: true, value: null })), /already has an interceptor/);
    // Plugins can contribute their endpoints before any Web-only service exists.
    const plugin = await ctx.plugin(owner => registerRpc(owner, service));
    await ctx.plugin(WebServer, { host: '127.0.0.1', port: 0, compression: 'none' });
    // Older hosts expose only handler fallbacks; newer hosts serve resources.
    const fallback = typeof ctx.webServer.readResource === 'function'
      ? { resource: async () => new Response('fixture SPA') }
      : (req, res) => { res.writeHead(['GET', 'HEAD'].includes(req.method) ? 200 : 405, { allow: 'GET, HEAD' }); res.end(); };
    ctx.effect(() => ctx.webServer.registerFallback(fallback));
    ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: '/', handler(req, res) {
      if (ctx.connection.authorizeIndex(req, res)) res.end('authenticated fixture');
    } }));
    const base = ctx.webServer.getOrigin();
    const login = await fetch(ctx.connection.authenticatedUrl(base + '/'), { redirect: 'manual' });
    assert.equal(login.status, 303);
    const cookie = login.headers.get('set-cookie').split(';', 1)[0]; await login.body?.cancel();
    installConnection(clientCtx, { transport: { fetch: (path, init) => fetch(new URL(path, base + '/'), { ...init, headers: { ...init.headers, cookie } }) } });
    const call = (method, payload = { sessionId: 'main' }) => clientCtx.connection.rpc.call('/api', method, payload);
    const old = await fetch(base + '/taskflow/view', { method: 'POST', headers: { cookie } });
    assert.equal(old.status, 405); assert.equal(old.headers.get('allow'), 'GET, HEAD'); await old.body?.cancel();
    assert.equal((await call('gateway/ping', {})).value, 'gateway');
    const first = await call('taskflow/view'); assert.equal(first.value.plan.title, 'HTTP 验收');
    const edit = await call('taskflow/action', { sessionId: 'main', action: 'update', taskId: 'T-001', patch: { title: '已修改' }, version: 1 });
    assert.equal(edit.ok, true);
    assert.equal((await call('taskflow/view')).value.plan.tasks['T-001'].title, '已修改');
    const noAuth = await fetch(base + '/api/taskflow/view', { method: 'POST' }); assert.equal(noAuth.status, 401); await noAuth.body?.cancel();
    const untrusted = await fetch(base + '/api/taskflow/view', { method: 'POST', headers: { cookie, origin: 'https://untrusted.invalid' } }); assert.equal(untrusted.status, 403); await untrusted.body?.cancel();
    const guest = ctx.connection.createPeer({ principal: { kind: 'guest' } });
    const denied = await ctx.connection.createSharedFetchHandler('/api').fetch(new Request(base + '/api/taskflow/view', { method: 'POST' }), guest);
    assert.equal(denied.status, 403); await denied.body?.cancel(); await guest.dispose();
    const wrongMethod = await fetch(base + '/api/taskflow/view', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'mismatch', method: 'taskflow/action', payload: { sessionId: 'main', action: 'cancel', taskId: 'T-001' } }) });
    assert.equal((await wrongMethod.json()).result.error.code, 'gateway/bad-request');
    assert.equal((await call('taskflow/view')).value.plan.tasks['T-001'].title, '已修改');
    await plugin.dispose(); await assert.rejects(call('taskflow/view'), /HTTP 404/);
    assert.equal((await call('gateway/ping', {})).value, 'gateway');
    const reloaded = await ctx.plugin(owner => registerRpc(owner, service));
    assert.equal((await call('taskflow/view')).ok, true);
    await reloaded.dispose(); await removeGateway();
  } finally { await clientCtx.fiber.dispose(); await ctx.fiber.dispose(); }
});
