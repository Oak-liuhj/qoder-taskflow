import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { MarkdownPreview } from '../client/components/markdown-preview.jsx';
import './panel.css';

const app = new App({ name: 'Taskflow', version: '0.1.0-alpha.1' }, {}, { autoResize: false });
const labels = { pending: '待执行', queued: '待委派', running: '进行中', awaiting_children: '等待下级', completed: '已完成', blocked: '受阻', failed: '失败', paused: '已暂停', cancelled: '已取消' };
const unpack = result => {
  if (result.isError) throw new Error(result.content?.find(c => c.type === 'text')?.text || '读取失败');
  return result.structuredContent ?? JSON.parse(result.content.find(c => c.type === 'text').text);
};
const Checklist = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 1.5 1.5L7 4.5M10 6h11M3 12h4m3 0h11M3 18h4m3 0h11"/></svg>;

function Panel() {
  const [view, setView] = useState(null), [selected, select] = useState(null);
  const [collapsed, collapse] = useState(new Set()), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const binding = useRef(null), generation = useRef(0), pending = useRef(false), live = useRef(false), ready = useRef(false), identity = useRef(null);
  const receive = useCallback(next => {
    const key = next.plan?.id ?? next.sessionId ?? null;
    if (identity.current !== key) { identity.current = key; select(null); collapse(new Set()); }
    setView(next); setError('');
  }, []);
  const refresh = useCallback(async () => {
    if (!ready.current || !live.current || pending.current) return;
    const token = ++generation.current;
    pending.current = true; setBusy(true);
    try {
      // A thread entrypoint keeps empty arguments so every poll follows the host's
      // current conversation. Only explicit model tool input pins a result card.
      const next = unpack(await app.callServerTool({ name: 'taskflow_panel', arguments: binding.current || {} }));
      if (live.current && token === generation.current) receive(next);
    } catch (e) { if (live.current && token === generation.current) { setView(null); setError(e.message); } }
    finally { if (live.current && token === generation.current) { pending.current = false; setBusy(false); } }
  }, [receive]);
  useEffect(() => {
    live.current = true;
    const invalidate = () => { generation.current++; pending.current = false; setBusy(false); };
    app.onteardown = async () => { live.current = false; ready.current = false; generation.current++; pending.current = false; setConnected(false); return {}; };
    app.ontoolinput = ({ arguments: args }) => {
      invalidate();
      binding.current = args?.sessionId && args?.projectPath ? { sessionId: args.sessionId, projectPath: args.projectPath } : null;
      identity.current = null; setView(null); select(null); collapse(new Set()); setError('');
      void refresh();
    };
    app.ontoolresult = result => {
      if (!live.current) return;
      invalidate();
      try { receive(unpack(result)); } catch (e) { setView(null); setError(e.message); }
    };
    const theme = context => {
      if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
      // Host context notifications can contain only size/display-mode changes.
      // Preserve the last theme when that partial update omits it.
      document.documentElement.dataset.theme = context.theme || document.documentElement.dataset.theme || 'light';
    };
    app.onhostcontextchanged = theme;
    app.connect().then(() => {
      if (!live.current) return;
      ready.current = true; setConnected(true);
      const context = app.getHostContext(); theme(context || {});
      if (context?.displayMode === 'inline') app.setupSizeChangedNotifications();
      void refresh();
    }).catch(e => { if (live.current) setError(e.message); });
    const visible = () => { if (!document.hidden) void refresh(); };
    const timer = setInterval(visible, 3000);
    document.addEventListener('visibilitychange', visible);
    return () => { live.current = false; ready.current = false; generation.current++; clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [receive, refresh]);
  const plan = view?.plan, tasks = Object.values(plan?.tasks || {});
  const task = plan?.tasks[selected] || tasks.find(t => t.status === 'running') || tasks.find(t => t.status !== 'cancelled') || tasks[0];
  const roots = tasks.filter(t => !t.parentId), activeRoots = roots.filter(t => t.status !== 'cancelled');
  const completed = activeRoots.filter(t => t.status === 'completed').length;
  const counts = tasks.reduce((all, t) => { all[t.status] = (all[t.status] || 0) + 1; return all; }, {});
  const toggle = id => collapse(previous => { const next = new Set(previous); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const row = (t, depth = 0) => {
    const children = tasks.filter(c => c.parentId === t.id), expanded = !collapsed.has(t.id);
    return <React.Fragment key={t.id}><div className={`task-row ${task?.id === t.id ? 'selected' : ''}`} role="treeitem" aria-level={depth + 1} aria-expanded={children.length ? expanded : undefined} aria-selected={task?.id === t.id} style={{ paddingLeft: 4 + depth * 16 }}>
      <button className="arrow" aria-label={`${expanded ? '收起' : '展开'} ${t.id}`} disabled={!children.length} onClick={() => toggle(t.id)}>{children.length ? expanded ? '⌄' : '›' : ''}</button>
      <button className="task-label" onClick={() => select(t.id)}><span className={`task-state ${t.status}`} aria-hidden="true">{t.status === 'completed' ? '✓' : t.status === 'failed' || t.status === 'blocked' ? '!' : ''}</span><span className="task-text"><span className="title">{t.title}</span><span className="task-id">{t.id}</span></span><span className={`status ${t.status}`}>{labels[t.status]}</span></button>
    </div>{expanded && children.map(c => row(c, depth + 1))}</React.Fragment>;
  };
  return <main><header><h1><Checklist/>待办任务清单</h1><button className="refresh" aria-label="刷新" title="刷新任务" disabled={!connected || busy} onClick={refresh}><svg className={busy ? 'spinning' : ''} viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></svg></button></header>
    {error ? <p role="alert" className="error">{error} <button onClick={refresh}>重试</button></p> : !view ? <p className="empty" role="status">正在读取任务…</p> : !plan ? <section className="empty"><Checklist/><h2>{view.contextRequired ? '请在会话中打开任务' : '当前会话暂无任务'}</h2><p>{view.contextRequired ? '在会话右侧的应用菜单中打开“任务”，即可查看对应清单。' : '让模型规划任务后，清单会自动显示在这里。'}</p></section> : <><section className="plan"><div className="plan-heading"><h2>{plan.title}</h2><span>{completed}<span className="muted"> / {activeRoots.length} 已完成</span></span></div><p>{plan.goal}</p><progress aria-label="根事项完成进度" max={activeRoots.length || 1} value={completed}/><div className="counts"><span>{tasks.length} 项任务</span>{['running', 'pending', 'queued', 'blocked', 'failed'].filter(s => counts[s]).map(s => <span key={s}>{labels[s]} {counts[s]}</span>)}</div></section>
      <div className="layout"><section className="tree" role="tree" aria-label="层级任务">{roots.map(t => row(t))}</section>
      {task && <section className="detail" aria-label="任务详情"><div className="detail-heading"><span className="eyebrow">任务详情 · {task.id}</span><span className={`status ${task.status}`}>{labels[task.status]}</span></div><h2>{task.title}</h2><p className="detail-meta">{task.mode === 'delegate' ? '子会话执行' : '当前会话执行'} · 版本 {task.version}</p>
        {task.instructions && <><h3>任务要求</h3><MarkdownPreview text={task.instructions}/></>}{task.criteria && <><h3>完成标准</h3><MarkdownPreview text={task.criteria}/></>}
        {!!task.dependsOn?.length && <p className="detail-meta">前置依赖：{task.dependsOn.join('、')}</p>}
        {task.decomposition && <><h3>拆解判断</h3><p>{task.decomposition.reason}</p></>}
        {(task.history || []).filter(r => r.kind === 'qoder-progress').map((r, index) => <section className="record" key={index}><h3>执行记录 <time>{r.at}</time></h3><MarkdownPreview text={r.summary}/></section>)}
        {task.report && <section className="result"><h3>最终结果</h3><MarkdownPreview text={task.report.summary}/></section>}
        <details><summary>历史记录（{task.history?.length || 0}）</summary>{(task.history || []).filter(r => r.kind !== 'qoder-progress').map((r, index) => <section key={index}><p className="detail-meta">{r.kind || labels[r.status]} · {r.at}</p>{r.summary && <MarkdownPreview text={r.summary}/>}</section>)}</details>
      </section>}</div></>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Panel/>);
