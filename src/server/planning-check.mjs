import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { children } from '../domain/task-service.mjs';

const allowed = new Set(['taskflow_assess', 'taskflow_plan', 'taskflow_status']);
const questions = new Set(['ask_user', 'ask_user_question', 'ask_question']);
const MAX_STEPS = 4, MAX_RETRIES = 2;

/** Transient admission checks; the persistent task ledger remains authoritative. */
export class PlanningCheck {
  constructor(service, enabled = true) { this.service = service; this.enabled = enabled; this.states = new WeakMap(); this.statuses = new Map(); }
  view(sid) { const state = this.statuses.get(sid); return this.service.view(sid).plan && !state?.taskId ? null : state ?? null; }
  publish(agent, state) { this.statuses.set(agent.session.id, { phase: state.phase, retries: state.retries, message: state.message, ...(state.taskId ? { taskId: state.taskId } : {}) }); }
  taskToAssess(agent) {
    const view = this.service.view(agent.session.id), task = view.plan?.tasks[view.currentTaskId];
    if (!this.enabled || !task || task.executionSessionId !== agent.session.id || task.status !== 'running' || task.complexity === 'low' || children(view.plan, task.id).length) return null;
    if (task.decomposition?.version === task.version && !task.decomposition.needsSplit) return null;
    return task;
  }
  enter(agent, turn, messages) {
    if (!this.enabled) return null;
    if (this.service.view(agent.session.id).plan) {
      const task = this.taskToAssess(agent);
      if (!task) { this.statuses.delete(agent.session.id); return null; }
      let state = this.states.get(agent);
      if (state?.turn !== turn || state.taskId !== task.id || state.version !== task.version) {
        state = { turn, taskId: task.id, version: task.version, phase: 'assessing', retries: 0, steps: 0, message: `${task.id} 执行前需要模型判断是否拆解下级事项` };
        this.states.set(agent, state);
      }
      if (++state.steps > MAX_STEPS && state.phase !== 'blocked') this.block(agent, state);
      this.publish(agent, state); return state;
    }
    let state = this.states.get(agent);
    if (state?.turn !== turn) {
      // Don't impose a planning stage on host background agents or system notices.
      if (!messages.some(m => m.source?.kind === 'user')) return null;
      state = { turn, phase: 'assessing', retries: 0, steps: 0, message: '正在判断是否需要任务计划' };
      this.states.set(agent, state);
    }
    // A later step can only enter after the question tool has settled. Resume
    // checking the clarified goal instead of leaving an unlimited needs-info bypass.
    if (state.phase === 'needs-info') { state.phase = 'assessing'; state.steps = 0; state.message = '信息已补充，正在判断任务计划'; }
    if (++state.steps > MAX_STEPS && !['skipped', 'blocked', 'needs-info'].includes(state.phase)) this.block(agent, state);
    this.publish(agent, state);
    return state;
  }
  assess(agent, needsPlan, reason, taskId) {
    const state = this.states.get(agent);
    if (!reason.trim()) throw new Error('请说明任务复杂度判断依据');
    const view = this.service.view(agent.session.id);
    if (view.plan) {
      const ref = taskId || view.currentTaskId;
      if (!ref) throw new Error('请先启动待办事项，再判断是否拆解');
      return this.service.assessDecomposition(agent.session.id, ref, needsPlan, reason);
    }
    if (!this.enabled || !state) return { needsPlan, reason, message: needsPlan ? '请调用 taskflow_plan 保存实际待办' : '可直接回答；尚未创建任务计划' };
    state.phase = needsPlan ? 'planning' : 'skipped';
    state.message = needsPlan ? '需要任务计划，等待保存清单' : reason;
    this.publish(agent, state);
    return { needsPlan, reason, message: needsPlan ? '请立即调用 taskflow_plan；成功返回才代表清单已建立' : '本轮无需清单，可直接回答' };
  }
  guard(exec) {
    const agent = exec.agent, state = agent && this.states.get(agent);
    if (agent && this.taskToAssess(agent)) {
      if (questions.has(exec.name) || ['taskflow_assess', 'taskflow_add', 'taskflow_status'].includes(exec.name)) return;
      return '执行前请先判断当前事项复杂度：taskflow_assess(needsPlan:false, reason, taskId) 表示直接完成；需要拆解则 taskflow_add 在当前任务下保存具体下级，再逐项 taskflow_start。已有主计划不代表子任务无需再次判断。';
    }
    if (!this.enabled || !state || this.service.view(agent.session.id).plan || state.phase === 'skipped') return;
    if (state.phase === 'blocked') return state.message;
    if (questions.has(exec.name)) { state.phase = 'needs-info'; state.message = '等待补充任务信息'; this.publish(agent, state); return; }
    if (allowed.has(exec.name)) return;
    return '尚未建立任务清单：复杂任务先调用 taskflow_plan；短问答先用 taskflow_assess(needsPlan:false, reason) 说明无需计划；信息不足可先提问。';
  }
  block(agent, state) {
    if (state.taskId) {
      state.phase = 'blocked'; state.message = `${state.taskId} 的拆解判断未完成，已停止自动重试。请明确继续此任务，判断是否需要下级事项。`;
      this.publish(agent, state); return;
    }
    state.phase = 'blocked'; state.message = '自动规划未能建立任务清单，已停止自动重试。可在会话中要求重新规划；当前回答或文档不代表清单已生成。';
    this.publish(agent, state);
  }
  stopping(agent, turn, signal) {
    const state = this.states.get(agent);
    if (state?.taskId) {
      if (signal?.aborted || state.turn !== turn || !this.taskToAssess(agent) || state.phase === 'blocked') return;
      if (state.retries >= MAX_RETRIES || state.steps >= MAX_STEPS) { this.block(agent, state); return; }
      state.retries++; this.publish(agent, state);
      agent.steer(createUserMessage({ source: { kind: 'taskflow', form: 'notice', summary: '下级任务拆解检查' }, content: [{ type: 'text', text: `${state.taskId} 尚未完成执行前拆解判断。请结合当前任务的要求、产物和复杂度：需要拆解用 taskflow_add 保存具体下级；可直接执行用 taskflow_assess(needsPlan:false, reason, taskId:"${state.taskId}") 说明依据。不要重建计划，不要重复执行已完成事项。` }] }));
      return;
    }
    if (signal?.aborted || !this.enabled || !state || state.turn !== turn || this.service.view(agent.session.id).plan || ['skipped', 'blocked', 'needs-info'].includes(state.phase)) return;
    if (state.retries >= MAX_RETRIES || state.steps >= MAX_STEPS) { this.block(agent, state); return; }
    state.retries++;
    state.message = `尚未建立任务清单，正在重试（${state.retries}/${MAX_RETRIES}）`;
    this.publish(agent, state);
    agent.steer(createUserMessage({ source: { kind: 'taskflow', form: 'notice', summary: '任务计划未落账检查' }, content: [{ type: 'text', text: `${state.message}。请根据原用户目标处理：复杂或明确要求计划的任务调用 taskflow_plan 保存具体待办；短问答调用 taskflow_assess(needsPlan:false, reason)；缺少信息则提问。不要重复执行已完成的业务操作，不要把输出文档当成任务账本。` }] }));
  }
  async pauseBlocked(agent) {
    const state = this.states.get(agent); if (!state?.taskId || state.phase !== 'blocked') return;
    const t = this.service.view(agent.session.id).plan?.tasks[state.taskId];
    if (t?.mode === 'inline' && t.version === state.version && t.executionSessionId === agent.session.id && t.status === 'running') {
      await this.service.settle(agent.session.id, t.id, t.attempt.id, t.version, { status: 'blocked', summary: state.message });
    }
  }
  forget(agent) { this.states.delete(agent); this.statuses.delete(agent.session.id); }
}
