import { randomUUID } from 'node:crypto';
import { documentPath } from '../domain/tool-view.mjs';

const keys = new Set(['path', 'file', 'file_path', 'filePath', 'filename', 'fileName', 'output_path', 'outputPath', 'absolutePath', 'destination', 'files', 'paths', 'artifacts', 'outputs', 'documents', 'result', 'data']);
export function outputFiles(...values) {
  const found = new Set();
  const visit = (value, depth = 0) => {
    if (depth > 6 || found.size >= 20) return;
    if (typeof value === 'string') { if (documentPath(value)) found.add(value); return; }
    if (Array.isArray(value)) { for (const item of value.slice(0, 50)) visit(item, depth + 1); }
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) if (keys.has(key)) visit(item, depth + 1);
  };
  for (const value of values) if (value && typeof value === 'object') visit(value);
  return [...found];
}
const urlOf = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null; } catch { return null; } };
const kindOf = name => /browser|navigate|web_page/.test(name) ? 'browser' : /bash|pwsh|terminal|command|run_code/.test(name) ? 'terminal' : /^(read|write|edit|str_replace)/.test(name) ? 'editor' : 'plugin';

// Observe admitted results without invoking tools again or reading arbitrary files.
export function registerToolViews(ctx, service, log) {
  const browserUrls = new Map();
  ctx.effect(() => () => browserUrls.clear());
  ctx.on('tools/execute', async (exec, next) => {
    const sid = exec.agent?.session.id;
    if (!sid || !service.view(sid).plan || exec.name.startsWith('taskflow_') || ['structured_output', 'todo_write', 'ask_user'].includes(exec.name)) return next();
    const args = exec.arguments ?? {}, kind = kindOf(exec.name), id = exec.callId || randomUUID();
    const url = kind === 'browser' ? urlOf(args.url) || browserUrls.get(sid) || null : null;
    await service.openView(sid, { kind, title: exec.name, id, url, phase: 'running', sourceTool: exec.name, content: '工具正在执行…' }).catch(log);
    return next();
  }, { global: true });
  ctx.on('tools/result', (exec, result) => {
    const sid = exec.agent?.session.id, current = sid && service.view(sid).tool;
    if (!current || current.id !== exec.callId) return;
    const args = exec.arguments ?? {}, output = (result.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    let parsed; try { parsed = JSON.parse(output); } catch {}
    const files = result.isError ? [] : outputFiles(result.value, result.meta, parsed, args);
    const url = current.kind === 'browser' ? urlOf(result.value?.url) || urlOf(parsed?.url) || current.url : null;
    if (url && !result.isError) browserUrls.set(sid, url);
    const autoOpen = !result.isError && !/browser_(close|install|wait)$/.test(exec.name);
    void service.openView(sid, { ...current, expectedId: current.id, requireOpen: true, kind: files.length ? 'editor' : current.kind, files, filePath: files[0], url, phase: result.isError ? 'failed' : 'ready', autoOpen, content: output }).catch(log);
  }, { global: true });
}
