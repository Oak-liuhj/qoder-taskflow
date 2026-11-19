import React, { useState, useEffect } from 'react';
import { STATUS, visibleTree, progress, taskTarget, sessionPath, executionLabel } from '../model.mjs';
import { TaskIcon } from './task-icon.jsx';
import { Icon } from '../generated/icons.jsx';
import { TaskDialog } from './task-dialog.jsx';
import { TaskSpinner } from './task-spinner.jsx';

export function TaskPanel({ view, sessionId, action, navigate, augment, onError }) {
  const [filter, setFilter] = useState('all'), [scope, setScope] = useState('global'), [collapsed, setCollapsed] = useState(new Set()), [detail, setDetail] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  useEffect(() => { setDetail(null); setError(''); setFeedback(''); }, [sessionId]);
  const p = view.plan, pr = progress(p), path = sessionPath(p, sessionId);
  const perform = async (type, data) => { if (busy) return; setBusy(true); setError(''); setFeedback(''); try { const result = await action(type, data); if (result?.message) setFeedback(result.message); if (type === 'resume' && result?.accepted) setDetail(null); } catch (e) { setError(e.message); onError?.(e); } finally { setBusy(false); } };
  const prompt = async value => { try { await augment(value); setDetail(null); } catch (e) { setError(e.message); } };
  const row = t => <div className="task-node" key={t.id}>
    <div className={`tf-row task-row ${t.status} ${view.currentTaskId === t.id ? 'focused' : ''}`} data-task-id={t.id} data-status={t.status}>
      <div className="task-line"><span className={`task-box ${t.status}`} aria-label={STATUS[t.status]}>{t.status === 'running' ? <TaskSpinner label={`${t.id} 进行中`}/> : t.status === 'completed' ? <Icon name="check"/> : t.status === 'cancelled' ? '−' : null}</span>
        <div className="task-copy"><button className="tf-task task-title" onClick={() => { const target = taskTarget(p, t); if ((typeof target === 'string' ? target : target.childSessionId) !== sessionId) navigate(target); else void perform('focus', { taskId: t.id }); }}>{t.title}</button><div className="task-meta"><code>{t.id}</code><span title={t.executionReason}>· {executionLabel(p, t, sessionId)}</span>{t.version > 1 && <span>v{t.version}</span>}{t.children.length > 0 && <button className="tf-fold" aria-label={`${collapsed.has(t.id) ? '展开' : '折叠'} ${t.title}`} onClick={() => setCollapsed(old => { const n = new Set(old); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; })}><Icon name="chevron" style={{ transform: collapsed.has(t.id) ? '' : 'rotate(90deg)' }}/></button>}</div></div>
        <button className="iconbtn" aria-label={`查看 ${t.id} 详情`} onClick={() => setDetail(t.id)}><Icon name="dots"/></button>
      </div>
      {!['completed', 'cancelled'].includes(t.status) && <div className="task-status"><span className={`pill ${t.status === 'running' ? 'blue' : ''}`}><i className={`dot ${t.status}`}/>{STATUS[t.status]}</span>{['pending', 'paused', 'blocked', 'failed'].includes(t.status) && <button className="btn small outline" disabled={busy} onClick={() => void perform('resume', { taskId: t.id, version: t.version })}>{t.status === 'pending' ? '开始' : '继续'}</button>}</div>}
      {['blocked', 'failed'].includes(t.status) && <p className="tf-blocked-reason"><strong>{t.status === 'blocked' ? '受阻原因：' : '失败原因：'}</strong>{t.report?.summary || '尚未记录原因，请查看会话详情。'}</p>}
      {t.recordError && <p className="tf-blocked-reason" role="status">子会话记录待同步：{t.recordError}</p>}
    </div>
    {!collapsed.has(t.id) && t.children.length > 0 && <div className="child-tasks">{t.children.map(row)}</div>}
  </div>;
  const selected = p?.tasks[detail];
  return <section className="tf-panel" aria-label="待办任务清单">
    <header className="plan-tabs"><span className="tab"><TaskIcon/>待办任务清单</span><span className="pill" style={{ fontSize: 10 }}>持久计划</span><button className="iconbtn" aria-label="查看任务动态" onClick={() => setDetail('activity')}><Icon name="dots"/></button></header>
    {view.loading ? <p className="empty">正在加载任务…</p> : !p ? <div className="empty"><Icon name="check"/><p>暂无任务计划</p><p>在会话中描述目标，模型将根据任务复杂度规划待办。</p></div> : <>
      <div className="plan-heading">{path.length > 1 && <nav className="tf-session-path" aria-label="会话层级">{path.map((part, index) => <React.Fragment key={part.sessionId}>{index > 0 && <span aria-hidden="true">/</span>}{index === path.length - 1 ? <span aria-current="page">{part.title}</span> : <button onClick={() => navigate(part.target)}>{part.title}</button>}</React.Fragment>)}<button onClick={() => navigate(path.at(-2).target)}>返回父会话</button></nav>}<h2>{p.title}</h2><div className="progress-label"><strong>{pr.done} / {pr.total} 项已完成</strong><span>v{p.version} · {pr.percent}%</span></div><div className="progress-track" role="progressbar" aria-label="根任务完成进度" aria-valuenow={pr.percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pr.percent}%` }}/></div></div>
      <div className="plan-controls"><div className="segments">{[['global', '全局计划'], ['local', '当前会话']].map(([id, title]) => <button key={id} className={scope === id ? 'selected' : ''} aria-pressed={scope === id} onClick={() => setScope(id)}>{title}</button>)}</div><select aria-label="任务筛选" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部事项</option><option value="active">未完成</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></div>
      <div className="task-list">{visibleTree(p, { filter, scope, sessionId }).map(row)}</div>
      <footer className="plan-bottom"><button className="btn outline" onClick={() => void prompt(view.currentTaskId ? `在 ${view.currentTaskId} 下新增一个` : '新增一个待办事项：')}><Icon name="plus"/>{view.currentTaskId ? '在当前任务下增补' : '在主任务下增补'}</button><p>稳定 ID · 跨轮保留 · 刷新恢复</p></footer>
    </>}
    {!p && view.planning && view.planning.phase !== 'skipped' && <p role={view.planning.phase === 'blocked' ? 'alert' : 'status'} className={view.planning.phase === 'blocked' ? 'tf-error' : 'tf-planning'}>{view.planning.message}</p>}
    {feedback && <p role="status" className="tf-feedback">{feedback}</p>}
    {(error || view.error) && <p role="alert" className="tf-error">{error || view.error}</p>}
    {selected && <TaskDialog title={selected.title} subtitle={`${selected.id} · 任务详情`} onClose={() => setDetail(null)} actions={<>
      {['pending', 'paused', 'blocked', 'failed'].includes(selected.status) && <button className="btn small primary" disabled={busy} onClick={() => void perform('resume', { taskId: selected.id, version: selected.version })}>继续执行</button>}
      {selected.status !== 'cancelled' && <><button className="btn small outline" onClick={() => prompt(`在 ${selected.id} 下新增一个`)}>增补下级事项</button><button className="btn small outline" onClick={() => prompt(`修改 ${selected.id} 的要求为：`)}>修改要求</button></>}
      {!['cancelled', 'completed'].includes(selected.status) && <button className="btn small danger" disabled={busy} onClick={() => void perform('cancel', { taskId: selected.id, version: selected.version })}>取消任务</button>}
      <button className="btn small" disabled={busy} onClick={() => void perform('reorder', { taskId: selected.id, direction: -1, expectedVersion: p.version })}>上移</button><button className="btn small" disabled={busy} onClick={() => void perform('reorder', { taskId: selected.id, direction: 1, expectedVersion: p.version })}>下移</button>
    </>}><dl className="detail-kv"><dt>状态</dt><dd><span className="pill">{STATUS[selected.status]} · v{selected.version}</span></dd><dt>执行方式</dt><dd>{executionLabel(p, selected, sessionId)}</dd><dt>执行说明</dt><dd>{selected.executionReason || (selected.mode === 'delegate' ? '按需创建真实子会话' : '在负责会话内执行')}{selected.mode === 'inline' && '；此事项在父会话执行，过程与结果保存到只读事项子会话。'}</dd><dt>所属会话</dt><dd><button className="btn small outline" onClick={() => navigate(taskTarget(p, selected))}>{selected.mode === 'inline' && selected.recordSession?.created ? '查看事项子会话' : '打开执行会话'}</button></dd><dt>父级事项</dt><dd>{selected.parentId || '主任务'}</dd><dt>任务要求</dt><dd>{selected.instructions || selected.title}</dd><dt>完成标准</dt><dd>{selected.criteria || '按当前任务要求完成'}</dd></dl>{selected.report && <div className="notice"><strong>{selected.report.version === selected.version ? '执行结果' : `历史结果 v${selected.report.version}（当前要求已变化）`}</strong><p>{selected.report.summary}</p></div>}{error && <p className="tf-error" role="alert">{error}</p>}</TaskDialog>}
    {detail === 'activity' && p && <TaskDialog title="任务动态" subtitle={`持久计划 · v${p.version}`} closeLabel="关闭任务动态" onClose={() => setDetail(null)}>{[...p.events].reverse().map(e => <article className="history" key={e.id}><time>{e.at.replace('T', ' ').slice(0, 19)} · {e.taskId}</time>{e.detail}</article>)}</TaskDialog>}
  </section>;
}

