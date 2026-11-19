// Exact routes share Connection's authenticated /api carrier without taking
// Gateway's singleton interceptor or depending on a Web-only service.
export function registerRpc(ctx, service, planning, actions, replies) {
  ctx.inject(['connection'], scope => {
    for (const operation of ['view', 'action']) {
      const method = `taskflow/${operation}`;
      scope.effect(() => scope.connection.fetch.register({
        path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
        // Connection admits only owner Peers to exact Fetch routes.
        fetch: request => serveRpc(request, method, service, planning, actions, replies),
      }));
    }
  });
}

async function serveRpc(request, method, service, planning, actions, replies) {
  if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return new Response('content type must be application/json', { status: 415 });
  }
  let message;
  try { message = await request.json(); }
  catch { return new Response('body is not JSON', { status: 400 }); }
  const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request';
  const reply = result => Response.json({ type: 'server-response', rpcId, result });
  if (!message || message.type !== 'client-request' || typeof message.rpcId !== 'string' || message.method !== method) {
    return reply({ ok: false, error: { code: 'gateway/bad-request', message: '无效的 RPC 请求或方法与路径不一致', details: {} } });
  }
  const payload = message.payload;
  try {
    if (!payload || typeof payload.sessionId !== 'string' || payload.sessionId.length > 200) throw new Error('缺少有效会话 ID');
    const sid = payload.sessionId;
    if (method === 'taskflow/view') return reply({ ok: true, value: { ...service.view(sid), planning: planning?.view(sid) ?? null } });
    let value;
    if (payload.action === 'quick-replies' && replies) value = await replies.request(sid, payload.refresh === true);
    else if (payload.action === 'close-view') value = await service.closeView(sid);
    else if (payload.action === 'focus') value = await service.focus(sid, payload.taskId);
    else if (payload.action === 'start') value = await service.start(sid, payload.taskId);
    else if (payload.action === 'resume' && actions) value = await actions.resume(sid, payload.taskId, payload.version);
    else if (payload.action === 'cancel') value = await service.cancel(sid, payload.taskId, payload.version);
    else if (payload.action === 'update') value = await service.update(sid, payload.taskId, payload.patch, payload.version);
    else if (payload.action === 'reorder') value = await service.reorder(sid, payload.taskId, payload.direction, payload.expectedVersion);
    else throw new Error('不支持的操作');
    return reply({ ok: true, value: value ?? { ok: true } });
  } catch (error) { return reply({ ok: false, error: { code: error.code ?? 'invalid', message: error.message, details: {} } }); }
}
