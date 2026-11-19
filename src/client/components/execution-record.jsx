import React, { useState } from 'react';
import { MarkdownPreview } from './markdown-preview.jsx';

const labels = { requirements: '任务要求', status: '执行状态', progress: '阶段进展', 'model-call': '模型调用', 'model-output': '模型输出', 'tool-call': '工具调用', 'tool-result': '工具结果', result: '最终结果', process: '执行记录' };

// Legacy logs retain their original durable content; presentation needs no rewrite.
export function executionRecord(data) {
  const source = data?.source, summary = source?.summary;
  if (source?.kind !== 'taskflow' || typeof summary !== 'string' || !/^T-\d+\s/.test(summary)) return null;
  const text = (data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n');
  if (!text.trim()) return null;
  const detail = source.record ?? {};
  const category = detail.category in labels ? detail.category
    : /任务要求$/.test(summary) ? 'requirements'
      : /最终结果|已完成$/.test(summary) ? 'result'
        : /^执行工具：/.test(text) ? 'tool-call'
          : /执行状态$/.test(summary) ? 'status'
            : /执行进展$/.test(summary) ? 'progress' : 'process';
  return { ...detail, taskId: summary.match(/^T-\d+/)[0], category, text, categoryLabel: labels[category] };
}

function formattedJson(text) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return null; }
}

export function ExecutionRecord({ data }) {
  const record = executionRecord(data), [expanded, setExpanded] = useState(true);
  if (!record) return null;
  const { text, category, categoryLabel, taskId } = record;
  const tool = record.tool || text.match(/^执行工具：([^\n]+)/)?.[1];
  const input = category === 'tool-call' ? text.replace(/^执行工具：[^\n]*\n?/, '') : null;
  const json = input === null && category === 'tool-result' ? formattedJson(text) : null;
  return <section className="tf-execution-record" data-taskflow-record={category}>
    <button type="button" className="tf-record-heading" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="tf-record-marker" aria-hidden="true">{category === 'tool-call' ? '↗' : category === 'tool-result' ? '↙' : '•'}</span>
      <strong>{categoryLabel}</strong><span className="tf-record-task">{taskId}</span>
      {tool && <code>{tool}</code>}{record.status === 'failed' && <span className="tf-error">失败</span>}
      {Number.isFinite(record.durationMs) && <span className="tf-record-duration">{(record.durationMs / 1000).toFixed(1)}s</span>}
      <span className="tf-record-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <div className="tf-record-body">
      {record.model?.provider && record.model?.model && <p className="tf-record-model">{record.model.provider} / {record.model.model}</p>}
      {input !== null ? <pre aria-label="工具调用参数"><code>{formattedJson(input) ?? input}</code></pre>
        : json !== null ? <pre aria-label="工具返回结果"><code>{json}</code></pre> : <MarkdownPreview text={text} label="执行内容"/>}
    </div>}
  </section>;
}

// Wrap only our persisted records. Other producers retain their live host renderer.
export function registerExecutionRecords(ctx) {
  const slots = ctx.slots, seat = 'conversation.chat.node';
  if (typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return;
  ctx.effect(() => slots.inject(seat, () => {
    const ours = new Set(); let original, remove, disposed = false;
    const refresh = () => {
      if (disposed) return;
      const entry = slots.entries(seat).find(candidate => candidate.options.key === 'context' && !ours.has(candidate.component));
      if (entry === original) return;
      original = entry; remove?.(); remove = undefined;
      if (!entry) return;
      const Original = entry.component;
      function RecordOrContext(props) { return executionRecord(props.node?.data) ? <ExecutionRecord data={props.node.data}/> : <Original {...props}/>; }
      ours.add(RecordOrContext);
      remove = slots.register({ name: seat, key: 'context', priority: (entry.options.priority ?? 0) - 1, locale: entry.locale, inject: entry.inject }, RecordOrContext);
    };
    const unsubscribe = slots.subscribe(seat, refresh); refresh();
    return () => { disposed = true; unsubscribe(); remove?.(); };
  }));
}
