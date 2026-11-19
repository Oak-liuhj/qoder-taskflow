import { createUserMessage } from '@deepseek-ai/dsh-llm';

// 确定消息 ID 与持久 outbox 配合，flush 成功后才确认送达。
export function createNoticeSender(ctx) {
  return async notice => {
    const agent = ctx.agents.get(notice.targetSessionId); if (!agent) return false;
    const messageId = `taskflow-${notice.id}`;
    const hasMessage = value => value && typeof value === 'object' && (value.id === messageId || Object.values(value).some(v => Array.isArray(v) ? v.some(hasMessage) : v && typeof v === 'object' && hasMessage(v)));
    const seen = agent.session.snapshotEvents().some(hasMessage) || [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(m => m.id === messageId);
    if (!seen) {
      const message = createUserMessage({ content: [{ type: 'text', text: `任务 ${notice.taskId} 已完成并自动勾选。\n${notice.report.summary}\n无需再次核对或批准；继续当前父任务剩余工作。` }], source: { kind: 'taskflow', form: 'notice', summary: `${notice.taskId} 已完成` } });
      agent.steer({ ...message, id: messageId });
    }
    // Seeing a message in RAM does not prove that an earlier failed flush succeeded.
    if (!await ctx.sessions.flush(agent.session)) throw new Error('完成通知尚未持久化，保留待重送');
    return true;
  };
}

