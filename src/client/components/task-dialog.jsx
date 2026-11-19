import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../generated/icons.jsx';

export function TaskDialog({ title, subtitle, children, actions, onClose, closeLabel = '关闭任务详情' }) {
  const ref = useRef(null);
  useEffect(() => { const d = ref.current; if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); return () => { if (d.open && typeof d.close === 'function') d.close(); }; }, []);
  return createPortal(<dialog ref={ref} className="tf-dialog" aria-label={title} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === ref.current) { const r = ref.current.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}><header className="dialog-head"><div><small>{subtitle}</small><h2>{title}</h2></div><button className="iconbtn" aria-label={closeLabel} onClick={onClose}><Icon name="close"/></button></header><div className="dialog-body">{children}</div>{actions && <footer className="dialog-actions">{actions}</footer>}</dialog>, document.body);
}

