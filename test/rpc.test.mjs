import test from 'node:test';
import assert from 'node:assert/strict';
import { registerRpc } from '../src/server/rpc.mjs';

test('精确 API RPC：格式、关联 ID、路径与方法匹配，非法请求不执行服务', async () => {
  const routes = new Map(); let reads = 0, actions = 0, recommendations = 0;
  const scope = { connection: { fetch: { register(route) { assert.deepEqual(route.methods, ['POST']); assert.equal(route.requestBody, 'buffered'); routes.set(route.path, route); return () => routes.delete(route.path); } } }, effect: fn => fn() };
  const planningState = { phase: 'blocked', message: '自动规划已停止重试', retries: 2 };
  registerRpc({ inject: (names, fn) => { assert.deepEqual(names, ['connection']); fn(scope); } }, { view: sid => { reads++; return { sessionId: sid }; }, cancel: () => { actions++; } }, { view: () => planningState }, { resume: (sid, taskId, version) => { assert.deepEqual([sid, taskId, version], ['main', 'T-001', 1]); actions++; return { accepted: true }; } }, { request: (sid, refresh) => { recommendations++; assert.equal(sid, 'main'); assert.equal(refresh, true); return { phase: 'generating', items: [] }; } });
  assert.deepEqual([...routes.keys()], ['/api/taskflow/view', '/api/taskflow/action']);
  const raw = (body, path = 'view', contentType = 'application/json') => routes.get('/api/taskflow/' + path).fetch(new Request('http://localhost/api/taskflow/' + path, { method: 'POST', headers: { 'content-type': contentType }, body }));
  const request = (body, path) => raw(JSON.stringify(body), path);
  const valid = { type: 'client-request', rpcId: 'correlation', method: 'taskflow/view', payload: { sessionId: 'main' } };
  assert.equal((await raw('{}', 'view', 'text/plain')).status, 415);
  assert.equal((await raw('{')).status, 400);
  for (const body of [null, {}, { ...valid, rpcId: 1 }, { ...valid, type: 'other' }, { ...valid, method: 'taskflow/action', payload: { sessionId: 'main', action: 'cancel' } }]) assert.equal((await (await request(body)).json()).result.error.code, 'gateway/bad-request');
  for (const payload of [null, {}, { sessionId: 1 }, { sessionId: 'x'.repeat(201) }]) assert.equal((await (await request({ ...valid, payload })).json()).result.error.code, 'invalid');
  assert.equal(reads, 0); assert.equal(actions, 0);
  assert.deepEqual(await (await request(valid)).json(), { type: 'server-response', rpcId: 'correlation', result: { ok: true, value: { sessionId: 'main', planning: planningState } } });
  const action = await (await request({ ...valid, method: 'taskflow/action', payload: { sessionId: 'main', action: 'cancel' } }, 'action')).json();
  const resumed = await (await request({ ...valid, method: 'taskflow/action', payload: { sessionId: 'main', action: 'resume', taskId: 'T-001', version: 1 } }, 'action')).json(); assert.deepEqual(resumed.result, { ok: true, value: { accepted: true } });
  assert.equal(action.result.ok, true); assert.equal(actions, 2); assert.equal(reads, 1);
  const suggested = await (await request({ ...valid, method: 'taskflow/action', payload: { sessionId: 'main', action: 'quick-replies', refresh: true } }, 'action')).json();
  assert.deepEqual(suggested.result.value, { phase: 'generating', items: [] }); assert.equal(recommendations, 1); assert.equal(actions, 2);
});
