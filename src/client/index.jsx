import React, { useEffect, useState, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { TaskPanel } from './components/task-panel.jsx';
import { ToolPanel } from './components/tool-panel.jsx';
import { SessionTree } from './components/session-tree.jsx';
import { QuickReplies } from './components/quick-replies.jsx';
import { useTaskflow } from './hooks/use-taskflow.mjs';
import css from './styles.css';
import prototypeCss from './generated/prototype.css';
import { TaskIcon } from './components/task-icon.jsx';
import { useHeaderEntryTarget } from './hooks/use-header-entry-target.mjs';
import { executionTarget } from './model.mjs';
import { createToolOpeners } from './tool-openers.mjs';
import { useCompactChecklist } from './hooks/use-compact-checklist.mjs';
import { registerExecutionRecords } from './components/execution-record.jsx';

export const inject = ['slots', 'sessions', 'connection'];
export function createApi(connection) {
  const call = async (method, data) => { const result = await connection.rpc.call('/api', method, data); if (!result.ok) throw new Error(result.error.message); return result.value; };
  return { view: sessionId => call('taskflow/view', { sessionId }), action: (sessionId, action, data) => call('taskflow/action', { sessionId, action, ...data }) };
}
export function apply(ctx) {
  registerExecutionRecords(ctx);
  const api = createApi(ctx.connection), renderers = new Map();
  const panels = new Map(), panelListeners = new Set();
  const updatePanel = (key, value) => { value ? panels.set(key, value) : panels.delete(key); panelListeners.forEach(fn => fn()); };
  ctx.provide('taskflowViews', { register(kind, component) { renderers.set(kind, component); return () => { if (renderers.get(kind) === component) renderers.delete(kind); }; } });
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.dshTaskflow = ''; style.textContent = prototypeCss + '\n' + css; document.head.append(style); return () => style.remove(); });
  ctx.inject(['sidebarRightTabs', 'sidebarRight', 'uiWorkspace'], scope => {
    const openers = createToolOpeners(scope);
    scope.effect(() => scope.sidebarRightTabs.register({ id: 'dsh-taskflow', kind: 'taskflow', priority: 'extension', keepMounted: true, title: () => '待办任务清单', guide: [{ id: 'taskflow', order: 0, title: () => '待办任务清单', icon: TaskIcon, description: () => '持久层级待办' }] }));
    const register = (slot, options, Component) => scope.effect(() => scope.slots.inject(slot, () => scope.slots.register({ name: slot, ...options }, Component)));
    const augment = async (props, value, target) => {
      const sid = typeof target === 'string' ? target : target?.childSessionId || props.sessionId;
      if (target) scope.uiWorkspace.openSession(target);
      const deadline = Date.now() + 2500;
      do {
        const binding = ctx.sessions.binding(sid), input = binding && ctx.conversation?.input?.for(binding.ctx);
        if (input) { input.setDraft(value); input.focus(); return; }
        if (sid === props.sessionId && props.inputActions) { props.inputActions.setDraft(value); return; }
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (Date.now() < deadline);
      throw new Error('负责会话尚未就绪，请返回父会话后增补事项');
    };
    function Panel(props) {
      const view = useTaskflow(api, props.sessionId), tabInfo = props.useTabInfo?.(), key = useRef(Symbol());
      const visible = tabInfo?.tab.visible;
      const compact = useCompactChecklist(visible === true && !tabInfo?.sidebar?.fullscreen && !tabInfo?.panel?.isFloating);
      useEffect(() => { if (tabInfo) updatePanel(key.current, { sid: props.sessionId, visible }); return () => updatePanel(key.current); }, [props.sessionId, visible]);
      const recordTask = Object.values(view.plan?.tasks ?? {}).find(t => t.recordSession?.id === props.sessionId || t.recordHistory?.some(r => r.id === props.sessionId));
      return <div ref={compact.anchor} className="tf-checklist-root"><TaskPanel view={view} sessionId={props.sessionId} action={(type, data) => api.action(props.sessionId, type, data)} navigate={id => scope.uiWorkspace.openSession(id)} augment={value => augment(props, value, recordTask && executionTarget(view.plan, recordTask))}/>{compact.panel && createPortal(<div className="tf-checklist-resizer" {...compact.separator}/>, compact.panel)}{compact.dragging && createPortal(<div className="tf-checklist-resize-shield"/>, document.body)}</div>;
    }
    register('sidebar.right.pane.tab', { key: 'dsh-taskflow' }, Panel);
    function Tree(props) { const current = scope.sidebarRight.mounted; const sid = useSyncExternalStore(current ? listener => current.subscribe(listener) : () => () => {}, current ? () => current.getSnapshot() : () => null); return <SessionTree api={api} sessionId={props.sessionId} currentSessionId={sid} navigate={target => scope.uiWorkspace.openSession(target)}/>; }
    register('sidebar.session.row.trailing', { id: 'taskflow-children', order: 10 }, Tree);
    function Replies(props) {
      const current = scope.sidebarRight.mounted;
      const foreground = useSyncExternalStore(current ? listener => current.subscribe(listener) : () => () => {}, current ? () => current.getSnapshot() === props.sessionId : () => true);
      return <QuickReplies key={props.sessionId} api={api} {...props} foreground={foreground} focus={() => { const binding = ctx.sessions.binding(props.sessionId); if (binding) ctx.conversation?.input?.for(binding.ctx)?.focus(); }}/>;
    }
    register('conversation.input.dock', { id: 'taskflow-quick-replies', order: -10 }, Replies);
    function SessionEntry(props) {
      const entryAnchor = useRef(null), entryTarget = useHeaderEntryTarget(entryAnchor);
      const panelVisible = useSyncExternalStore(fn => { panelListeners.add(fn); return () => panelListeners.delete(fn); }, () => [...panels.values()].some(p => p.sid === props.sessionId && p.visible));
      const current = scope.sidebarRight.mounted;
      const foreground = useSyncExternalStore(current ? listener => current.subscribe(listener) : () => () => {}, current ? () => current.getSnapshot() === props.sessionId : () => true);
      const view = useTaskflow(api, props.sessionId), [mount, setMount] = useState(null), [showTool, setShowTool] = useState(true), [, refreshEntry] = useState(0), autoOpened = useRef(false);
      useEffect(() => { if (mount) mount.parentElement?.classList.toggle('tf-tool-show-tool', showTool); }, [mount, showTool]);
      useEffect(() => { if (view.tool?.open) setShowTool(true); }, [view.tool?.open, props.sessionId]);
      useEffect(() => {
        if (view.plan && !autoOpened.current) { try { scope.sidebarRight.openTab('taskflow'); autoOpened.current = true; } catch {} }
      }, [view.plan?.id, props.sessionId]);
      useEffect(() => { autoOpened.current = false; }, [props.sessionId]);
      useEffect(() => {
        if (!view.tool?.open) { setMount(null); return; }
        // rc.2 has no additive seat to the left of the conversation. This isolated,
        // versioned bridge adds only our portal node and CSS class; never reparent host nodes.
        let cleanup = () => {};
        const attach = () => { const body = [...document.querySelectorAll('[data-conversation-content]')].find(e => e.dataset.conversationSession === props.sessionId && e.dataset.contentPhase !== 'hero'); if (!body) return false; const parent = body.parentElement; const node = document.createElement('div'); node.className = 'tf-tool-mount'; const bodyOnly = parent.classList.contains('workbody'); parent.append(node); parent.classList.add('tf-tool-layout'); if (bodyOnly) parent.classList.add('tf-tool-body'); setMount(node); cleanup = () => { parent.classList.remove('tf-tool-layout', 'tf-tool-show-tool', 'tf-tool-body'); node.remove(); }; return true; };
        let observer;
        if (!attach()) { observer = new MutationObserver(() => { if (attach()) observer.disconnect(); }); observer.observe(document.body, { childList: true, subtree: true }); }
        return () => { observer?.disconnect(); cleanup(); setMount(null); };
      }, [view.tool?.open, props.sessionId]);
      const renderer = (tool, file) => { const Renderer = renderers.get(file?.format) || renderers.get(tool.kind); return Renderer ? <Renderer tool={tool} file={file} sessionId={props.sessionId}/> : null; };
      const expanded = scope.sidebarRight.isExpanded() && (panelVisible || scope.sidebarRight.active()?.kind === 'taskflow');
      const entry = <button type="button" className="tf-entry" title={expanded ? '收起待办任务清单' : '展开待办任务清单'} aria-label="待办任务清单" aria-expanded={expanded} onClick={() => { if (scope.sidebarRight.isExpanded() && (panelVisible || scope.sidebarRight.active()?.kind === 'taskflow')) scope.sidebarRight.toggleExpanded(); else scope.sidebarRight.openTab('taskflow'); refreshEntry(n => n + 1); }}><TaskIcon/><span>任务</span></button>;
      return <><span ref={entryAnchor} className="tf-entry-anchor">{entryTarget ? createPortal(entry, entryTarget) : entry}</span>{view.tool?.open && <span className="tf-mobile-view"><button aria-pressed={!showTool} onClick={() => setShowTool(false)}>看对话</button><button aria-pressed={showTool} onClick={() => setShowTool(true)}>看工具</button></span>}{mount && createPortal(<ToolPanel key={props.sessionId} sessionId={props.sessionId} mount={mount} tool={view.tool} onClose={() => void api.action(props.sessionId, 'close-view', {})} renderer={renderer} openers={openers} foreground={foreground}/>, mount)}</>;
    }
    register('conversation.session.header.utilities', { id: 'taskflow', order: -5 }, SessionEntry);
  });
}
