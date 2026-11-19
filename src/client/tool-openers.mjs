import { embedPreview } from './embedded-preview.mjs';
// DSH's documented session file grammar; keep drive colons and encode segments.
export function sessionFileAddress(sessionId, path) {
  const encode = s => encodeURIComponent(s).replace(/%3A/gi, ':');
  return `dsh-resource://file/session/${encode(sessionId)}/${path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').split('/').map(encode).join('/')}`;
}
export function createToolOpeners(ctx) {
  const browserUrls = new Map();
  const get = name => ctx.get ? ctx.get(name) : ctx[name];
  const foreground = sid => {
    const sidebar = get('sidebarRight');
    if (!sidebar?.mounted || sidebar.mounted.getSnapshot() !== sid) throw new Error('请先打开此任务会话，再打开工具产物');
    return sidebar;
  };
  return {
    async openDocument(sid, file, { container } = {}) {
      const sidebar = foreground(sid), address = sessionFileAddress(sid, file.path), tabs = get('sidebarRightTabs');
      let claim;
      try { claim = tabs?.claim(address); } catch { throw new Error('文档预览插件尚未就绪，请启用后重试'); }
      if (!claim) throw new Error('文档预览插件尚未就绪，请启用后重试');
      if (container) {
        if (!sidebar.float || !sidebar.active || !sidebar.closeIn) throw new Error('当前宿主不支持工具区文档预览，请更新宿主');
        const previous = sidebar.active(), expanded = sidebar.isExpanded();
        const restorePanel = () => { if (previous) sidebar.focus(previous.id); if (!expanded && sidebar.isExpanded()) sidebar.toggleExpanded(); };
        // A dedicated occurrence avoids stealing any document already opened by the user.
        sidebar.openResource(address, { revealIfOpened: false });
        const tab = sidebar.active();
        if (!tab || tab.id === previous?.id || tab.contentId !== address) throw new Error('宿主未建立文档预览，请重试');
        try {
          sidebar.float(tab.id);
          restorePanel();
          return { message: '已在工具视图中打开', dispose: embedPreview({ sidebar, sessionId: sid, tabId: tab.id, container }) };
        } catch (error) { sidebar.closeIn(sid, tab.id); restorePanel(); throw error; }
      }
      // Explicit external navigation remains available to integrations.
      await sidebar.openResource(address, { destination: 'float' });
      return '已交给文档插件打开';
    },
    async openBrowser(sid, url, { automatic = false } = {}) {
      const sidebar = foreground(sid);
      if (!get('sidebarRightTabs')?.get('browser')) throw new Error('浏览器插件尚未就绪，请启用后重试');
      if (automatic && browserUrls.get(sid) === url) return '此地址已交给浏览器插件打开';
      sidebar.openTab('browser', { params: { url } });
      browserUrls.set(sid, url);
      return '已交给浏览器插件打开';
    },
  };
}
