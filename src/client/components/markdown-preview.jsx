import React, { useMemo } from 'react';
import { marked } from 'marked';

const safeHref = href => { try { const u = new URL(href); return ['http:', 'https:', 'mailto:'].includes(u.protocol) && !u.username && !u.password ? href : null; } catch { return href.startsWith('#') ? href : null; } };
// Parse Markdown into React nodes. Raw HTML is text; no HTML injection or remote images.
export function MarkdownPreview({ text, label = 'Markdown 文档预览' }) {
  const nodes = useMemo(() => {
    const render = (tokens, depth = 0) => depth > 64 ? null : tokens.map((t, i) => {
      const inner = () => t.tokens ? render(t.tokens, depth + 1) : t.text;
      switch (t.type) {
        case 'space': return null;
        case 'heading': return React.createElement(`h${t.depth}`, { key: i }, inner());
        case 'paragraph': return <p key={i}>{inner()}</p>;
        case 'strong': return <strong key={i}>{inner()}</strong>;
        case 'em': return <em key={i}>{inner()}</em>;
        case 'del': return <del key={i}>{inner()}</del>;
        case 'code': return <pre key={i}><code>{t.text}</code></pre>;
        case 'codespan': return <code key={i}>{t.text}</code>;
        case 'blockquote': return <blockquote key={i}>{inner()}</blockquote>;
        case 'br': return <br key={i}/>;
        case 'hr': return <hr key={i}/>;
        case 'link': { const href = safeHref(t.href); return href ? <a key={i} href={href} target="_blank" rel="noopener noreferrer">{inner()}</a> : <span key={i}>{inner()}</span>; }
        case 'image': return <span key={i} className="tf-markdown-image">[图片：{t.text || '未命名'}]</span>;
        case 'list': return React.createElement(t.ordered ? 'ol' : 'ul', { key: i, start: t.ordered ? t.start : undefined }, t.items.map((item, j) => <li key={j}>{item.task && <input type="checkbox" checked={!!item.checked} readOnly aria-label={item.checked ? '已完成' : '未完成'}/>} {render(item.tokens, depth + 1)}</li>));
        case 'table': return <div className="tf-markdown-table" key={i}><table><thead><tr>{t.header.map((c, j) => <th key={j}>{render(c.tokens, depth + 1)}</th>)}</tr></thead><tbody>{t.rows.map((row, j) => <tr key={j}>{row.map((c, k) => <td key={k}>{render(c.tokens, depth + 1)}</td>)}</tr>)}</tbody></table></div>;
        default: return <React.Fragment key={i}>{t.type === 'html' ? t.raw : inner() ?? t.raw}</React.Fragment>;
      }
    });
    try { return render(marked.lexer(text, { gfm: true })); } catch { return <pre>{text}</pre>; }
  }, [text]);
  return <article className="tf-markdown-preview" aria-label={label}>{nodes}</article>;
}
