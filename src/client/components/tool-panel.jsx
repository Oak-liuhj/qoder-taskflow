import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TOOL_NAMES } from '../model.mjs';
import { Icon } from '../generated/icons.jsx';
import { ToolDocument } from './tool-document.jsx';

const fit = (n, min, max) => Math.max(min, Math.min(n, Math.max(min, max)));
const bounds = p => {
  const width = fit(p.width, Math.min(280, window.innerWidth - 16), window.innerWidth - 16);
  const height = fit(p.height, Math.min(200, window.innerHeight - 16), window.innerHeight - 16);
  return { ...p, width, height, x: fit(p.x, 8, window.innerWidth - width - 8), y: fit(p.y, 8, window.innerHeight - height - 8) };
};
const initial = sessionId => {
  let saved; try { saved = JSON.parse(window.localStorage.getItem(`dsh-taskflow:tool-layout:${sessionId}`)); } catch {}
  const p = { floating: saved?.floating === true, dockWidth: 440, width: 560, height: 440, x: 48, y: 80 };
  for (const key of ['dockWidth', 'width', 'height', 'x', 'y']) if (Number.isFinite(saved?.[key])) p[key] = saved[key];
  return bounds(p);
};

export function ToolPanel({ tool, onClose, renderer, mount, sessionId, openers, foreground = true }) {
  const [layout, setLayout] = useState(() => initial(sessionId)), [dragging, setDragging] = useState(false);
  const stopDrag = useRef(() => {}), latest = useRef(layout); latest.current = layout;
  useEffect(() => {
    const parent = mount?.parentElement; if (!parent) return;
    parent.classList.toggle('tf-tool-layout', !layout.floating);
    mount.classList.toggle('tf-floating-mount', layout.floating);
    const clamp = () => setLayout(old => ({ ...bounds(old), dockWidth: fit(old.dockWidth, 240, (parent.getBoundingClientRect().width || 1000) - 320) }));
    clamp(); window.addEventListener('resize', clamp);
    const observer = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(clamp) : null;
    observer?.observe(parent);
    return () => { observer?.disconnect(); window.removeEventListener('resize', clamp); parent.classList.remove('tf-tool-layout'); parent.style.removeProperty('--tf-tool-width'); mount.classList.remove('tf-floating-mount'); };
  }, [mount, layout.floating]);
  useEffect(() => { mount?.parentElement?.style.setProperty('--tf-tool-width', `${layout.dockWidth}px`); try { window.localStorage.setItem(`dsh-taskflow:tool-layout:${sessionId}`, JSON.stringify(layout)); } catch {} }, [layout, mount, sessionId]);
  useEffect(() => () => stopDrag.current(), []);
  const drag = (event, kind) => {
    if (event.button !== 0 || (kind === 'move' && event.target.closest('button,a,input'))) return;
    event.preventDefault(); stopDrag.current();
    const start = { ...latest.current }, x = event.clientX, y = event.clientY, pointerId = event.pointerId;
    setDragging(true);
    const move = e => {
      if (e.pointerId !== pointerId) return;
      const dx = e.clientX - x, dy = e.clientY - y;
      if (kind === 'move') setLayout(bounds({ ...start, x: start.x + dx, y: start.y + dy }));
      else if (start.floating) setLayout(bounds({ ...start, width: start.width + dx, height: kind === 'corner' ? start.height + dy : start.height }));
      else setLayout({ ...start, dockWidth: fit(start.dockWidth + dx, 240, (mount?.parentElement?.getBoundingClientRect().width || 1000) - 320) });
    };
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end); setDragging(false); };
    stopDrag.current = end;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end); window.addEventListener('blur', end);
  };
  const keyboardResize = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault(); const delta = e.key === 'ArrowLeft' ? -24 : 24;
    setLayout(p => p.floating ? bounds({ ...p, width: e.key === 'Home' ? 280 : e.key === 'End' ? window.innerWidth - 16 : p.width + delta }) : { ...p, dockWidth: fit(e.key === 'Home' ? 240 : e.key === 'End' ? Infinity : p.dockWidth + delta, 240, (mount?.parentElement?.getBoundingClientRect().width || 1000) - 320) });
  };
  if (!tool?.open) return null;
  const content = <aside className={`tf-tool ${layout.floating ? 'tf-tool-floating' : 'tf-tool-docked'} ${dragging ? 'tf-tool-dragging' : ''}`} style={layout.floating ? { left: layout.x, top: layout.y, width: layout.width, height: layout.height } : undefined} aria-label={`${TOOL_NAMES[tool.kind]}工具视图`}>
    <header className="tool-header" onPointerDown={e => layout.floating && drag(e, 'move')}><Icon name={tool.kind === 'editor' ? 'code' : tool.kind}/><span>{TOOL_NAMES[tool.kind]}</span><span className="binding">{tool.taskId}</span><button className="iconbtn" aria-label={layout.floating ? '停靠工具视图' : '悬浮工具视图'} title={layout.floating ? '停靠到对话左侧' : '悬浮并拖动位置'} onClick={() => { stopDrag.current(); setLayout(p => ({ ...bounds(p), floating: !p.floating })); }}><Icon name={layout.floating ? 'panel' : 'expand'}/></button><button className="iconbtn" aria-label="收起工具视图" onClick={onClose}><Icon name="close"/></button></header><div className={`tool-content${tool.files?.length ? ' tf-tool-documents' : ''}`}>
      {tool.files?.length && tool.phase !== 'running' && tool.phase !== 'failed'
        ? tool.files.map(file => <ToolDocument key={file.path} tool={tool} file={file} sessionId={sessionId} openers={openers} foreground={foreground}/> )
        : (() => { const rendered = renderer?.(tool); return <>
          {tool.kind === 'browser' && tool.url && tool.phase !== 'running' && tool.phase !== 'failed' && <ToolDocument tool={tool} sessionId={sessionId} openers={openers} foreground={foreground} custom={!!rendered}/>}
          {rendered || (tool.kind !== 'browser' || !tool.url || tool.phase === 'running' || tool.phase === 'failed' ? tool.kind === 'terminal' ? <pre className="terminal">{tool.content}</pre> : <div className="code-window"><div className="file-tab">{tool.title}</div><pre>{tool.content}</pre></div> : null)}
        </>; })()}
    </div>
    <div className="tf-tool-resizer" role="separator" tabIndex={0} aria-label="调整工具视图宽度" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={layout.floating ? window.innerWidth - 16 : Math.max(240, (mount?.parentElement?.getBoundingClientRect().width || 1000) - 320)} aria-valuenow={Math.round(layout.floating ? layout.width : layout.dockWidth)} onKeyDown={keyboardResize} onPointerDown={e => drag(e, 'resize')}/>
    {layout.floating && <div className="tf-tool-corner" aria-hidden="true" onPointerDown={e => drag(e, 'corner')}/>}
    {dragging && <div className="tf-tool-drag-shield"/>}
  </aside>;
  return layout.floating ? createPortal(content, document.body) : content;
}
