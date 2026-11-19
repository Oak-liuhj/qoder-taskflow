import { useEffect, useState } from 'react';

// dsh-todo-progress occupies the single corner slot. Add only our own portal
// node beside its public entry marker; never replace a slot or move host nodes.
export function useHeaderEntryTarget(anchor) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    const header = anchor.current?.closest('header');
    if (!header) return;
    const node = document.createElement('span');
    node.className = 'tf-header-entry-mount';
    const attach = () => {
      const progress = header.querySelector('[data-conversation-header-corner] [data-tp-entry]');
      if (progress?.parentElement) {
        if (progress.nextElementSibling !== node) progress.after(node);
        setTarget(current => current === node ? current : node);
      } else {
        node.remove();
        setTarget(current => current === null ? current : null);
      }
    };
    const observer = new MutationObserver(attach);
    observer.observe(header, { childList: true, subtree: true });
    attach();
    return () => { observer.disconnect(); node.remove(); };
  }, [anchor]);
  return target;
}
