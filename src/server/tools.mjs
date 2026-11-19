import { defineTool } from '@deepseek-ai/dsh-tools';
import { tasksSchema, patchSchema, normalizeToolArguments } from './tool-schemas.mjs';

const string = description => ({ type: 'string', description });
const number = description => ({ type: 'number', description });
const required = schema => ({ ...schema, required: true });
const jsonOutput = { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };


/** 把模型工具映射到领域服务；不在此保存任务状态。 */
export function registerTools(ctx, service, runtime, planning, records) {
  const register = (toolName, description, parameters, execute) => {
    const tool = defineTool({
      name: toolName, description, parameters, output: jsonOutput,
      async execute(args, exec) { if (!exec.agent) throw new Error('Taskflow 需要会话上下文'); if (exec.signal.aborted) throw exec.signal.reason; return (await execute(args, exec.agent.session.id, exec)) ?? { ok: true }; },
      presentCall: () => ({ card: 'generic', title: description.split('。')[0] }), presentResult: () => ({ card: 'generic' }),
    });
    const executeValidated = tool.execute;
    tool.execute = async (args, exec) => executeValidated(normalizeToolArguments(toolName, args), exec);
    return ctx.tools.register(tool);
  };
  register('taskflow_plan', '规划并保存当前会话的持久层级待办。已有计划不能覆盖；子会话请用 taskflow_add。', { title: required(string('计划标题')), goal: required(string('用户目标与约束')), tasks: required(tasksSchema) }, (a, sid) => service.create(sid, a));
  register('taskflow_assess', '判断任务复杂度。无计划时 needsPlan 表示是否建立主清单；已有计划且正在执行事项时，表示此事项是否需要继续拆解下级。每层中高复杂度事项执行前均需判断；true 后用 taskflow_add，false 说明直接执行依据。不创建或清空任务。', { needsPlan: required({ type: 'boolean', description: '无计划时是否需要清单；已有计划时当前事项是否需要拆解' }), reason: required(string('判断依据')), taskId: string('已有计划时正在执行的任务 ID；省略取当前任务') }, (a, _sid, exec) => planning?.assess(exec.agent, a.needsPlan, a.reason, a.taskId) ?? { needsPlan: a.needsPlan, reason: a.reason });
  register('taskflow_status', '读取整个持久计划、当前任务、版本和工具视图。不会重置计划。', {}, (_a, sid) => ({ ...service.view(sid), planning: planning?.view(sid) ?? null }));
  register('taskflow_add', '在当前任务或明确指定父任务下增补待办。目标歧义会拒绝，不改变其他事项。', { tasks: required(tasksSchema), parentId: string('可选父任务 ID 或完整名称；不填则为当前任务'), expectedVersion: number('可选计划版本，防止并发增补冲突') }, (a, sid) => service.add(sid, a.tasks, a.parentId, a.expectedVersion));
  register('taskflow_update', '增量修改任务要求。递增版本，中止旧执行；不会重写整棵树。', { taskId: required(string('任务 ID')), version: required(number('当前任务版本')), patch: required(patchSchema) }, (a, sid) => service.update(sid, a.taskId, a.patch, a.version));
  register('taskflow_reorder', '调整同级事项顺序，保留任务 ID、执行状态和历史。', { taskId: required(string('任务 ID')), direction: required(number('-1 上移，1 下移')), expectedVersion: required(number('当前计划版本')) }, (a, sid) => service.reorder(sid, a.taskId, a.direction, a.expectedVersion));
  register('taskflow_cancel', '取消任务及其下级，保留历史会话与已交付记录。取消不等于完成。', { taskId: required(string('任务 ID')), version: required(number('当前任务版本')) }, (a, sid) => service.cancel(sid, a.taskId, a.version));
  register('taskflow_start', '启动事项。inline 在父会话执行并自动保存到事项子会话，delegate 排队并在子会话独立执行；两种方式均在左侧展示子会话。', { taskId: required(string('待启动的任务 ID')) }, (a, sid) => service.start(sid, a.taskId));
  register('taskflow_wait', '等待当前任务下级的执行结果，释放本层并发名额；返回后继续本层工作。', { taskId: required(string('本会话正在执行的任务 ID')) }, (a, sid, exec) => runtime.wait(sid, a.taskId, exec.signal));
  register('taskflow_progress', '将当前任务的执行过程、阶段进展或关键结果保存到当前事项子会话，不向父任务发送过程通知。最终结果通过完成工具或结构化输出报告。', { taskId: string('当前正在执行的任务 ID；省略则取当前任务'), content: required(string('实际执行进展、关键发现或阶段结果，最多16000字符')) }, (a, sid, exec) => { if (!records) throw new Error('事项记录服务尚未就绪'); return records.progress(sid, a.taskId, a.content, exec.callId); });
  register('taskflow_complete', '保存行内事项的真实执行结果并立即勾选、通知直接父任务。委派任务通过最终结构化输出完成。', { taskId: required(string('任务 ID')), version: required(number('执行要求版本')), attemptId: required(string('taskflow_start 返回的 attempt.id')), summary: required(string('实际完成结果、证据或阻塞原因')), status: string('completed（默认）/blocked/failed') }, (a, sid) => service.settle(sid, a.taskId, a.attemptId, a.version, { status: a.status ?? 'completed', summary: a.summary }));
  register('taskflow_open_view', '展示实际工具产物。Markdown 支持预览，Office/PDF 使用宿主文档插件，网页使用浏览器插件；不执行或重跑原操作。', { kind: required(string('browser/editor/terminal/plugin/orchestration')), title: string('当前工具标题'), url: string('实际 HTTP(S) 页面地址，可选'), filePath: string('已生成文件的实际本地或工作区路径，可选；支持 md/markdown/xls/xlsx/csv/tsv/doc/docx/ppt/pptx/pdf'), files: { type: 'array', description: '多个已生成文档的实际路径，最多展示20项', items: string('文件路径') }, content: string('实际工具输出，可选；不是完整文档正文时不要当作文件内容') }, (a, sid) => service.openView(sid, a));
}
