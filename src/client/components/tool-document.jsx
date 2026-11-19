import React, { useEffect, useRef, useState } from 'react';

export function ToolDocument({ tool, file, sessionId, openers, foreground, custom = false }) {
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [hasOpened, setHasOpened] = useState(false);
  const opened = useRef(new Set()), generation = useRef(0), container = useRef(null), preview = useRef(null);
  const target = file?.path || tool.url;
  const open = async (automatic = false) => {
    const current = ++generation.current; setLoading(true); setError('');
    try {
      preview.current?.dispose(); preview.current = null;
      const result = await (file ? openers.openDocument(sessionId, file, { container: container.current }) : openers.openBrowser(sessionId, tool.url, { automatic }));
      if (generation.current === current) { preview.current = typeof result === 'object' ? result : null; setHasOpened(true); }
      else result.dispose?.();
    } catch (e) { if (generation.current === current) setError(e.message); }
    finally { if (generation.current === current) setLoading(false); }
  };
  useEffect(() => {
    setLoading(false); setError(''); setHasOpened(false);
    return () => { generation.current++; preview.current?.dispose(); preview.current = null; opened.current.clear(); };
  }, [sessionId, target, tool.id, foreground]);
  useEffect(() => {
    const key = `${sessionId}:${tool.id}:${target}`;
    if (!openers || !foreground || custom || !target || tool.phase !== 'ready' || tool.autoOpen === false || opened.current.has(key)) return;
    opened.current.add(key);
    void open(true);
  }, [sessionId, tool.id, tool.phase, tool.autoOpen, target, foreground, openers, custom]);
  return <div className="tf-document-view">
    {(error || (tool.autoOpen === false && !hasOpened && !loading)) && <div className="tf-document-actions">{error && <p role="alert" className="tf-error">{error}</p>}<button className="btn small outline" disabled={!openers || !foreground || loading} onClick={() => void open()}>{error ? '重试打开' : '打开预览'}</button></div>}
    {loading && <p role="status" className="tf-preview-loading">正在打开预览…</p>}
    {file ? <div ref={container} className="tf-document-preview-target" aria-label={`${file.path} 文档预览`}/> : <div className="notice">{`网页操作由 ${tool.sourceTool || '浏览器工具'} 执行。浏览器视图打开相同地址；登录状态和页面进度由对应浏览器插件管理。`}</div>}
  </div>;
}
