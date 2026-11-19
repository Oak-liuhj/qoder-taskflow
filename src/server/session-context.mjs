import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { PLANNING_PROMPT } from './prompts.mjs';

export function registerSessionContext(ctx, service, config, planning) {
  ctx.systemPrompt.section({ name: 'taskflow', order: 155, text: config.autoPlan === false ? PLANNING_PROMPT.replace(/^[^\n]+/, '你是持久任务计划的负责人。仅当用户明确要求任务计划时调用 taskflow_plan。已有计划只做增量修改，不用 todo_write 充当账本。') : PLANNING_PROMPT, interpolate: false });
  ctx.on('agent/pre-step', async ({ agent, turn }, next) => {
    const decision = await next(); if (decision.kind === 'reject') return decision;
    const view = service.view(agent.session.id);
    if (!view.plan && config.autoPlan === false) return decision;
    const state = planning?.enter(agent, turn, decision.messages);
    if (state?.phase === 'blocked') { await planning?.pauseBlocked(agent); return { kind: 'reject' }; }
    const content = view.plan ? JSON.stringify({ title: view.plan.title, planVersion: view.plan.version, currentTaskId: view.currentTaskId, tasks: Object.values(view.plan.tasks).map(t => ({ id: t.id, title: t.title, parentId: t.parentId, complexity: t.complexity, independent: t.independent, decomposition: t.decomposition, mode: t.mode, status: t.status, version: t.version, attempt: t.attempt, dependsOn: t.dependsOn })) }) : state?.phase === 'skipped' ? `本轮已判定无需清单：${state.message}。可直接回答，无需重复判断；任务范围改变时可重新判断。` : '本会话尚无持久计划。复杂多步骤任务先调用 taskflow_plan 保存数组；短问答先用 taskflow_assess(needsPlan:false, reason) 判断无需计划。若缺少信息可先提问。根据当前工具声明与错误修正输入，不要因历史调用失败而跳过规划。';
    const assessment = state?.taskId ? `\nTaskflow 执行前拆解检查：${state.taskId} 是中高复杂度事项。必须根据实际工作判断是否需要下级：需要则 taskflow_add 在当前任务下保存子事项；无需拆解则 taskflow_assess(needsPlan:false, reason, taskId:"${state.taskId}") 保存依据。对子事项也应用相同规则，可再次生成孙事项。先判断再执行，不要把已有主清单当作已完成判断。` : '';
    return { ...decision, messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: `${view.plan ? 'Taskflow 当前持久状态（已有计划，不得重建）' : 'Taskflow 规划检查'}：\n${content}${assessment}` }], source: { kind: 'taskflow', form: 'notice', summary: '持久任务状态' } })] };
  }, { global: true });
  ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => { planning?.stopping(agent, turn, signal); await planning?.pauseBlocked(agent); }, { global: true });
  ctx.on('agent/disposed', ({ agent }) => { planning?.forget(agent); }, { global: true });
  ctx.tools.guard(exec => {
    const denial = planning?.guard(exec); if (denial) return denial;
    const sid = exec.agent?.session.id; if (!sid || !service.view(sid).plan) return;
    if (['subagent', 'subagent_fork', 'workflow'].includes(exec.name)) return '请用 taskflow_add / taskflow_start 委派，保留层级与并发限制';
  });
}
