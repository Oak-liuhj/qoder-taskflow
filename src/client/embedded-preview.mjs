// rc.2/rc.3 expose document viewers as sidebar tabs, not reusable factories.
// Keep the native renderer and its session lifetime; adapt only our own float's
// geometry to the tool viewport. Never move native DOM or reuse a user's tab.
export function embedPreview({ sidebar, sessionId, tabId, container }) {
  const doc = container.ownerDocument, win = doc.defaultView;
  let frame, pane, host, hostLayer, disposed = false;
  const previous = new Map();
  const set = (name, value) => { if (!previous.has(name)) previous.set(name, [pane.style.getPropertyValue(name), pane.style.getPropertyPriority(name)]); if (pane.style.getPropertyValue(name) !== value || pane.style.getPropertyPriority(name) !== 'important') pane.style.setProperty(name, value, 'important'); };
  const restore = () => {
    if (!pane) return;
    pane.classList.remove('tf-host-preview');
    for (const [name, [value, priority]] of previous) value ? pane.style.setProperty(name, value, priority) : pane.style.removeProperty(name);
    if (host) { const [value, priority] = hostLayer; value ? host.style.setProperty('--dsh-dockkit-float-layer', value, priority) : host.style.removeProperty('--dsh-dockkit-float-layer'); }
    previous.clear(); pane = undefined; host = undefined;
  };
  const update = () => {
    if (disposed) return;
    if (!pane?.isConnected || !pane.hasAttribute('data-dockkit-float')) {
      const body = [...doc.querySelectorAll('[data-sidebar-right-tab]')].find(node => node.dataset.sidebarRightTab === tabId && node.closest('[data-dockkit-float]'));
      const nextPane = body?.closest('[data-dockkit-float]');
      if (pane !== nextPane) { restore(); pane = nextPane; }
    }
    if (pane) {
      if (!host) { host = pane.closest('[data-dockkit-host="float"]'); if (host) hostLayer = [host.style.getPropertyValue('--dsh-dockkit-float-layer'), host.style.getPropertyPriority('--dsh-dockkit-float-layer')]; }
      pane.classList.add('tf-host-preview');
      const rect = container.getBoundingClientRect(), scrollport = container.closest('.tool-content')?.getBoundingClientRect() ?? rect;
      const top = Math.max(0, scrollport.top, rect.top), bottom = Math.min(win.innerHeight, scrollport.bottom, rect.bottom);
      const left = Math.max(0, scrollport.left, rect.left), right = Math.min(win.innerWidth, scrollport.right, rect.right);
      const visible = container.isConnected && sidebar.mounted.getSnapshot() === sessionId && rect.width > 0 && rect.height > 0 && bottom > top && right > left && win.getComputedStyle(container.closest('.tf-tool-mount') ?? container).display !== 'none';
      set('visibility', visible ? 'visible' : 'hidden');
      set('left', `${rect.left}px`); set('top', `${rect.top}px`); set('width', `${rect.width}px`); set('height', `${rect.height}px`);
      set('min-width', '0px'); set('min-height', '0px'); set('max-width', 'none'); set('max-height', 'none');
      set('transform', 'none'); set('z-index', container.closest('.tf-tool-floating') ? '1201' : '30');
      const layer = container.closest('.tf-tool-floating') ? '1201' : '60';
      if (host && host.style.getPropertyValue('--dsh-dockkit-float-layer') !== layer) host.style.setProperty('--dsh-dockkit-float-layer', layer);
      set('clip-path', `inset(${Math.max(0, top - rect.top)}px ${Math.max(0, rect.right - right)}px ${Math.max(0, rect.bottom - bottom)}px ${Math.max(0, left - rect.left)}px)`);
    }
    frame = win.requestAnimationFrame(update);
  };
  update();
  return () => {
    if (disposed) return; disposed = true; win.cancelAnimationFrame(frame); restore();
    // closeIn targets this Session even if the user switched away meanwhile.
    sidebar.closeIn(sessionId, tabId);
  };
}
