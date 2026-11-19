import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sessionTree, STATUS } from '../model.mjs';
import { useTaskflow } from '../hooks/use-taskflow.mjs';
import { Icon } from '../generated/icons.jsx';
import { TaskSpinner } from './task-spinner.jsx';

// The host intentionally excludes subagent origins from workspace rows. This
// additive bridge owns only its sibling node; it never binds background agents.
export function SessionTree({ api, sessionId, currentSessionId, navigate }) {
  const view = useTaskflow(api, sessionId), anchor = useRef(null), [mount, setMount] = useState(null), [opened, setOpened] = useState(new Set()), [expanded, setExpanded] = useState(false), groupId = useId();
  const nodes = sessionTree(view.plan);
  const isRoot = view.plan?.rootSessionId === sessionId && nodes.length > 0;
  useEffect(() => {
    if (!isRoot) return;
    const node = document.createElement('div'); node.className = 'tf-session-tree-mount'; node.dataset.taskflowParentSession = sessionId;
    const control = document.createElement('span'); control.className = 'tf-session-toggle-mount';
    const status = document.createElement('span'); status.className = 'tf-session-root-status'; setMount({ tree: node, control, status });
    let attachedRow;
    const clickRow = event => { if (!event.defaultPrevented && !event.target.closest('button, a, input, [role="menuitem"]')) setExpanded(value => !value); };
    const keyRow = event => { if (event.target === attachedRow && ['Enter', ' '].includes(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) setExpanded(value => !value); };
    const detachRow = () => {
      attachedRow?.removeEventListener('click', clickRow); attachedRow?.removeEventListener('keydown', keyRow);
      attachedRow?.classList.remove('tf-session-root');
      attachedRow?.querySelectorAll('.tf-session-native-leading,.tf-session-native-trailing,.tf-session-native-title').forEach(e => e.classList.remove('tf-session-native-leading', 'tf-session-native-trailing', 'tf-session-native-title'));
      attachedRow = null;
    };
    // Slot roots can commit before their host row is attached, or move during
    // sidebar regrouping. Track our own anchor instead of a one-shot DOM lookup.
    const attach = () => {
      const row = anchor.current?.closest('[data-row-key]');
      if (!row?.isConnected || row.dataset.rowKey !== `session:${sessionId}`) { node.remove(); control.remove(); status.remove(); detachRow(); return; }
      if (attachedRow !== row) {
        detachRow(); attachedRow = row; row.classList.add('tf-session-root');
        const trailing = [...row.children].find(e => e.contains(anchor.current));
        trailing?.classList.add('tf-session-native-trailing');
        if (row.firstElementChild !== trailing) row.firstElementChild?.classList.add('tf-session-native-leading');
        if (row.children[1] !== trailing) row.children[1]?.classList.add('tf-session-native-title');
        row.addEventListener('click', clickRow); row.addEventListener('keydown', keyRow);
      }
      if (row.nextElementSibling !== node) row.after(node);
      if (row.firstElementChild !== control) row.prepend(control);
      if (row.lastElementChild !== status) row.append(status);
    };
    const observer = new MutationObserver(attach); observer.observe(document.body, { childList: true, subtree: true }); attach();
    return () => { observer.disconnect(); detachRow(); node.remove(); control.remove(); status.remove(); setMount(null); };
  }, [sessionId, isRoot]);
  const toggle = id => setOpened(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const count = tasks => tasks.reduce((n, t) => n + 1 + count(t.children), 0);
  const render = tasks => tasks.map(t => <div key={t.executionSessionId} className="tf-session-node" data-taskflow-session={t.executionSessionId}><div className={`session-row tf-session-line ${currentSessionId === t.executionSessionId ? 'selected' : ''}`} onClick={() => { navigate(t.target); if (t.children.length) toggle(t.executionSessionId); }}>
    {t.children.length ? <button className="tf-session-arrow" aria-label={`${opened.has(t.executionSessionId) ? '折叠' : '展开'}子会话 ${t.id}`} aria-expanded={opened.has(t.executionSessionId)} onClick={event => { event.stopPropagation(); toggle(t.executionSessionId); }}><Icon name="chevron" style={{ transform: opened.has(t.executionSessionId) ? 'rotate(90deg)' : undefined }}/></button> : t.status === 'running' ? <TaskSpinner label={`${t.id} 进行中`}/> : <Icon name="chat" data-icon="chat"/>}
    <button className="tf-session-link" title={`${t.id} · ${STATUS[t.status]} · ${t.title}`} aria-current={currentSessionId === t.executionSessionId ? 'page' : undefined} aria-expanded={t.children.length ? opened.has(t.executionSessionId) : undefined}>{t.children.length > 0 && t.status === 'running' && <TaskSpinner label={`${t.id} 进行中`}/>}<span className="title">{t.id} {t.title}</span><span className={`dot ${t.status}`} role="img" aria-label={STATUS[t.status]}/></button></div>
    {opened.has(t.executionSessionId) && t.children.length > 0 && <div className="session-children" role="group">{render(t.children)}</div>}
  </div>);
  const label = `“${view.plan?.title}”的 ${count(nodes)} 个子会话`;
  const rootStatus = Object.values(view.plan?.tasks ?? {}).some(t => t.status === 'running') ? 'running' : Object.values(view.plan?.tasks ?? {}).every(t => ['completed', 'cancelled'].includes(t.status)) ? 'completed' : 'pending';
  return <><span ref={anchor} className="tf-session-tree-anchor"/>{mount && <>{createPortal(<span onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}><button type="button" className="tf-session-toggle" title={label} aria-label={`${expanded ? '折叠' : '展开'}${label}`} aria-expanded={expanded} aria-controls={groupId} onClick={() => setExpanded(value => !value)}><Icon name="chevron" style={{ transform: expanded ? 'rotate(90deg)' : undefined }}/></button></span>, mount.control)}{createPortal(<span className={`dot ${rootStatus}`} role="img" aria-label={STATUS[rootStatus]}/>, mount.status)}{createPortal(<nav id={groupId} className="tf-session-tree" aria-label={label} hidden={!expanded} onClick={e => e.stopPropagation()}><div className="session-children">{render(nodes)}</div></nav>, mount.tree)}</>}</>;
}
