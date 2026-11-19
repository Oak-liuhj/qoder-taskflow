import { projectDirectory, snapshot } from './store.mjs';
import { realpath } from 'node:fs/promises';

export async function hook(input, base) {
  if (!['SessionStart', 'UserPromptSubmit', 'SubagentStart'].includes(input.hook_event_name)) return {};
  const sessionId = input.agent_id || input.session_id;
  if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 240 || typeof input.cwd !== 'string') return {};
  const state = await snapshot(await projectDirectory(input.cwd, base));
  const plan = Object.hasOwn(state.sessions, sessionId) ? state.plans[state.sessions[sessionId]] : undefined;
  const context = [
    `Taskflow 当前真实身份 sessionId=${JSON.stringify(sessionId)}。${input.agent_id ? '这是子 Agent 的真实 agent_id。' : '这是宿主 session_id。'}`,
    `Taskflow 当前项目 projectPath=${JSON.stringify(await realpath(input.cwd))}。每次 MCP 调用都传此 projectPath；共享 MCP 进程的工作目录不代表当前项目。`,
    '需要持久任务编排时使用 taskflow 技能与 MCP 工具；简单问答无需规划。delegate 使用原生 create_chat_session 创建可见聊天子会话，以自己的 Hook session_id 认领父 dispatch，不重新规划；不要用内嵌 Agent 替代可见会话。不要编造身份或把普通记录当宿主子会话。',
  ];
  if (plan) context.push(`已有持久计划 ${JSON.stringify(plan.title)}；先 taskflow_status，沿用 ID 和结果，不重建。${Object.values(plan.tasks).filter(t => !['completed', 'cancelled'].includes(t.status)).length} 项未结束。`);
  return { hookSpecificOutput: { hookEventName: input.hook_event_name, additionalContext: context.join('\n') } };
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) { raw += chunk; if (Buffer.byteLength(raw) > 1024 * 1024) throw new Error('Hook input too large'); }
  process.stdout.write(JSON.stringify(await hook(JSON.parse(raw), process.argv[2])));
}
// Bundled entrypoint; failures are reported without blocking ordinary Qoder work.
if (process.env.TASKFLOW_HOOK_TEST !== '1') main().catch(error => { process.stderr.write(`Taskflow hook: ${error.message}\n`); process.exitCode = 1; });
