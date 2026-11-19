import { readFile, writeFile } from 'node:fs/promises';

const source = new URL('../docs/prototype/dsh-taskflow-prd.html', import.meta.url);
export async function readPrd() {
  const html = (await readFile(source, 'utf8')).replaceAll('\r\n', '\n');
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);
  return { html, theme: styles[0], layout: styles[1] };
}

// Select and scope the prototype's actual declarations. Do not inject its global
// app/sidebar/composer selectors into the user's DSH host.
const classes = new Set(('plan-panel plan-tabs tab pill iconbtn btn plan-heading progress-label progress-track plan-controls segments task-list task-node task-row task-line task-box task-copy task-title task-meta task-status child-tasks plan-bottom empty tool-panel tool-header binding tool-context tool-content tool-footer browser-window browser-toolbar address code-window file-tab terminal plugin-card tool-caption dialog-head dialog-body dialog-actions notice field detail-kv history subtle dot saved').split(' '));
function scopeSelector(selector) {
  const s = selector.trim();
  if (s.startsWith('.session-row')) return s.replace('.session-row', ':is(.tf-session-root,.tf-session-tree .session-row)');
  if (s.startsWith('.session-children')) return `.tf-session-tree ${s}`;
  if (s.startsWith('.suggestions')) return s.replace('.suggestions', '.tf-quick-replies');
  if (s === 'dialog' || s === 'dialog::backdrop') return s.replace('dialog', '.tf-dialog');
  const names = [...s.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]);
  if (!names.length || !classes.has(names[0])) return null;
  if (s.startsWith('body[')) return s.replace(' .', ' :where(.tf-panel,.tf-tool,.tf-dialog) .');
  if (s.startsWith('.plan-panel')) return s.replace('.plan-panel', '.tf-panel');
  if (s.startsWith('.tool-panel')) return s.replace('.tool-panel', '.tf-tool');
  return `:where(.tf-panel,.tf-tool,.tf-dialog${names[0] === 'dot' ? ',.tf-session-tree,.tf-session-root' : ''}) ${s}`;
}
function scopedRules(css) {
  let result = '', position = 0;
  while (position < css.length) {
    const start = css.indexOf('{', position); if (start < 0) break;
    let depth = 1, end = start + 1;
    while (end < css.length && depth) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; end++; }
    const selector = css.slice(position, start).trim(), body = css.slice(start + 1, end - 1); position = end;
    if (selector.startsWith('@media')) { const inner = scopedRules(body); if (inner) result += `${selector}{${inner}}\n`; }
    else if (!selector.startsWith('@') && !(selector.includes('.plan-panel') && selector.includes('.sidebar'))) { const scoped = selector.split(',').map(scopeSelector).filter(Boolean); if (scoped.length) result += `${scoped.join(',')}{${body}}\n`; }
  }
  return result;
}
export async function syncPrdAssets({ check = false } = {}) {
  const prd = await readPrd();
  const emit = async (path, value) => {
    const target = new URL(path, import.meta.url);
    if (check) { if ((await readFile(target, 'utf8')).replaceAll('\r\n', '\n') !== value) throw new Error(`Generated asset is stale: ${path}; run npm run build`); }
    else await writeFile(target, value);
  };
  const header = '/* Generated from docs/prototype/dsh-taskflow-prd.html.\n * Original DeepSeek UI styles: MIT; see licenses/DeepSeek-MIT.txt.\n * Run npm run build to resync. */\n';
  await emit('../src/client/generated/prototype.css', header + scopedRules(prd.layout));
  const paths = prd.html.match(/const paths=([\s\S]*?);\n/)[1];
  const extraPaths = prd.html.match(/\n(paths\.folder=[^\n]+)/)[1];
  const fish = prd.html.match(/const fish='[\s\S]*?<path d="([^"]+)"/)[1];
  await emit('../src/client/generated/icons.jsx', `// Generated from the MIT-licensed PRD icon paths; see licenses/DeepSeek-MIT.txt.\nimport React from 'react';\nconst paths=${paths};\n${extraPaths}\nexport function Icon({name,...props}) { return <svg viewBox="0 0 24 24" aria-hidden="true" {...props}><path d={paths[name]||paths.file}/></svg>; }\nexport function Fish(props) { return <svg viewBox="0 0 23.16 17.04" aria-hidden="true" {...props}><path d=${JSON.stringify(fish)} fill="currentColor"/></svg>; }\n`);
  return prd;
}
