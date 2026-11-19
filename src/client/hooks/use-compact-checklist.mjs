import { useEffect, useRef, useState } from 'react';

const MIN_WIDTH = 280, MAX_WIDTH = 720, STORAGE_KEY = 'dsh-taskflow:checklist-width';
const clamp = (width, max) => Math.round(Math.max(MIN_WIDTH, Math.min(width, max)));
const savedWidth = () => { try { const width = JSON.parse(window.localStorage.getItem(STORAGE_KEY)); return Number.isFinite(width) ? clamp(width, MAX_WIDTH) : 300; } catch { return 300; } };

// The host has no public per-tab width setter. Adapt only the active docked
// checklist's track, preserving the native left column and saved preferences.
export function useCompactChecklist(enabled) {
  const anchor = useRef(null), desired = useRef(null), bridge = useRef(null), stopDrag = useRef(() => {});
  if (desired.current === null) desired.current = savedWidth();
  const [panel, setPanel] = useState(null), [size, setSize] = useState({ width: 300, max: MAX_WIDTH }), [dragging, setDragging] = useState(false);
  const save = () => { try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(desired.current)); } catch {} };
  useEffect(() => {
    if (!enabled) return;
    const panel = anchor.current?.closest('[data-sidebar-right-panel="push"]');
    const frame = panel?.closest('[data-rightbar-col]')?.parentElement;
    if (!frame || !/^\s*[\d.]+px\s/.test(frame.style.gridTemplateColumns)) return;
    const sync = () => {
      const first = frame.style.gridTemplateColumns.match(/^\s*([\d.]+px)\s/)?.[1];
      if (!first) return;
      const viewport = frame.getBoundingClientRect().width || window.innerWidth;
      const max = Math.max(MIN_WIDTH, Math.floor(Math.min(MAX_WIDTH, viewport * .7, viewport - parseFloat(first) - 400)));
      const width = clamp(desired.current, max);
      for (const [name, value] of [['--tf-sidebar-track', first], ['--tf-checklist-width', `${width}px`]]) if (frame.style.getPropertyValue(name) !== value) frame.style.setProperty(name, value);
      bridge.current = { sync, width, max };
      setSize(previous => previous.width === width && previous.max === max ? previous : { width, max });
    };
    sync(); panel.dataset.tfCompactChecklist = ''; setPanel(panel);
    const observer = new MutationObserver(sync); observer.observe(frame, { attributes: true, attributeFilter: ['style'] });
    const resize = typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(sync) : null;
    resize?.observe(frame); window.addEventListener('resize', sync);
    return () => {
      stopDrag.current(); observer.disconnect(); resize?.disconnect(); window.removeEventListener('resize', sync);
      bridge.current = null; setPanel(null); delete panel.dataset.tfCompactChecklist;
      if (!frame.querySelector('[data-tf-compact-checklist]')) { frame.style.removeProperty('--tf-sidebar-track'); frame.style.removeProperty('--tf-checklist-width'); }
    };
  }, [enabled]);
  const onPointerDown = event => {
    if (event.button !== 0 || !bridge.current) return;
    event.preventDefault(); stopDrag.current();
    const startX = event.clientX, startWidth = bridge.current.width, pointerId = event.pointerId, handle = event.currentTarget;
    const move = e => {
      if (e.pointerId !== pointerId || !bridge.current) return;
      desired.current = clamp(startWidth + startX - e.clientX, bridge.current.max); bridge.current.sync();
    };
    const end = e => {
      if (e?.pointerId !== undefined && e.pointerId !== pointerId) return;
      stopDrag.current = () => {};
      window.removeEventListener('pointermove', move, true); window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', end, true); window.removeEventListener('blur', end); handle.removeEventListener('lostpointercapture', end);
      if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
      setDragging(false); save();
    };
    const up = e => { if (e.pointerId === pointerId) { move(e); end(e); } };
    stopDrag.current = end; setDragging(true);
    window.addEventListener('pointermove', move, true); window.addEventListener('pointerup', up, true); window.addEventListener('pointercancel', end, true); window.addEventListener('blur', end); handle.addEventListener('lostpointercapture', end);
    handle.setPointerCapture?.(pointerId);
  };
  const onKeyDown = event => {
    if (!bridge.current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    desired.current = clamp(event.key === 'Home' ? MIN_WIDTH : event.key === 'End' ? bridge.current.max : bridge.current.width + (event.key === 'ArrowLeft' ? 24 : -24), bridge.current.max);
    bridge.current.sync(); save();
  };
  return { anchor, panel, dragging, separator: { role: 'separator', tabIndex: 0, 'aria-label': '调整待办任务清单宽度', 'aria-orientation': 'vertical', 'aria-valuemin': MIN_WIDTH, 'aria-valuemax': size.max, 'aria-valuenow': size.width, onPointerDown, onKeyDown } };
}
