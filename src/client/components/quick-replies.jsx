import React, { useEffect, useRef, useState } from 'react';
import { TaskSpinner } from './task-spinner.jsx';

export function QuickReplies({ api, sessionId, foreground = true, input, inputActions, focus }) {
  const [view, setView] = useState({ phase: 'idle', items: [] }), [error, setError] = useState('');
  const request = useRef(() => {});
  useEffect(() => {
    let alive = true, busy = false; setView({ phase: foreground ? 'loading' : 'idle', items: [] }); setError('');
    if (!foreground) return;
    const load = async (refresh = false) => {
      if (busy) return; busy = true;
      if (refresh) { setView(previous => ({ ...previous, phase: 'loading' })); setError(''); }
      try { const next = await api.action(sessionId, 'quick-replies', { refresh }); if (alive) { setView(next); setError(''); } }
      catch (e) { if (alive) { setView(previous => ({ ...previous, phase: 'unavailable' })); setError(e.message === '不支持的操作' ? '当前后端尚未加载推荐功能，请重启 DSH。' : '推荐服务连接失败，请稍后重试；若刚更新插件，请重启 DSH。'); } }
      finally { busy = false; }
    };
    request.current = load; void load(); const timer = setInterval(load, 1200);
    return () => { alive = false; clearInterval(timer); request.current = () => {}; };
  }, [api, sessionId, foreground]);
  const fill = item => {
    try {
      const draft = input?.draft ?? '';
      if (input?.phase && input.phase !== 'plain') throw new Error('请先完成当前输入操作，再选择推荐回复。');
      if (inputActions?.insertText && Number.isInteger(input?.draftRev)) {
        if (!inputActions.insertText(`${draft ? '\n' : ''}${item.text}`, { start: draft.length, end: draft.length, draftRev: input.draftRev })) throw new Error('草稿已变化，请重试。');
      } else if (!draft && inputActions?.setDraft) inputActions.setDraft(item.text);
      else throw new Error('请先保留现有草稿，再选择推荐回复。');
      focus?.(); setError('');
    } catch (e) { setError(e.message); }
  };
  if (!foreground || (view.phase === 'idle' && !error)) return null;
  return <div className="tf-quick-replies-wrap">
    <nav className="tf-quick-replies" aria-label="模型推荐回复">{view.items?.map(item => <button type="button" key={item.label} title={item.text} onClick={() => fill(item)}>{item.label}</button>)}</nav>
    {['loading', 'generating', 'busy'].includes(view.phase) && <span className="tf-reply-status tf-reply-loading" role="status" title={view.phase === 'busy' ? '等待当前回复完成后生成推荐' : undefined}><span aria-hidden="true"><TaskSpinner/></span><span>正在推荐中...</span></span>}
    {(error || view.phase === 'unavailable') && <span className="tf-reply-status" role="status">{error || view.message}<button type="button" onClick={() => void request.current(true)}>重试</button></span>}
  </div>;
}
