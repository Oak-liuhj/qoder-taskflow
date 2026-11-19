const string = (description, maxLength = 16000) => ({ type: 'string', minLength: 1, maxLength, description });
const integer = { type: 'integer', minimum: 1 };
const fields = {
  title: string('任务标题', 240), instructions: string('具体要求'), criteria: string('完成标准'),
  complexity: { enum: ['low', 'medium', 'high'] }, independent: { type: 'boolean' },
  mode: { enum: ['inline', 'delegate'] }, parentId: { type: ['string', 'null'], minLength: 1 },
  dependsOn: { type: 'array', items: string('前置任务 ID 或 ref', 240), maxItems: 200 },
};
const object = (properties, required) => ({ type: 'object', additionalProperties: false, properties, required });
const tasks = { type: 'array', minItems: 1, maxItems: 200, items: object({ ...fields, ref: string('同批临时引用', 240) }, ['title']) };
const session = { sessionId: string('Hook 提供的真实 session_id；独立聊天子会话使用自己的 session_id，历史内嵌 Agent 使用 agent_id', 240), projectPath: string('Hook 提供的当前项目绝对路径；共享 MCP 进程不能用启动目录推断项目', 4096) };
const task = { ...session, taskId: string('任务 ID 或唯一完整名称', 240) };
const attempt = { ...task, attemptId: string('start/claim 返回的本次执行 ID', 240), version: integer };
const def = (name, description, properties, required, readOnly = false) => ({ name, description, inputSchema: object(properties, required.length ? [...required, 'projectPath'] : required), annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false } });
export const PANEL_URI = 'ui://taskflow/tasks.html';
const taskIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#8a929e" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m3 6 1.5 1.5L7 4.5M10 6h11M3 12h4m3 0h11M3 18h4m3 0h11"/></svg>`;
const icons = [{ src: `data:image/svg+xml,${encodeURIComponent(taskIcon)}`, mimeType: 'image/svg+xml', sizes: ['24x24'] }];
export const tools = [
  def('taskflow_status', '读取当前持久任务树、要求、历史和直接父任务通知，不启动执行。', session, ['sessionId'], true),
  { ...def('taskflow_panel', '查看当前会话的待办任务清单；会话右侧入口自动绑定宿主会话，无需选择项目或计划。模型调用时传 Hook 的 sessionId 和 projectPath。', session, [], true), title: '任务', icons, _meta: { ui: { resourceUri: PANEL_URI }, 'qoder/ui': { entrypoints: [{ type: 'thread' }] } } },
  { ...def('taskflow_plan', '当前会话无计划时建立持久计划并自动展示任务清单；已有计划不能覆盖。', { ...session, title: string('计划标题', 240), goal: string('总体目标'), tasks }, ['sessionId', 'title', 'goal', 'tasks']), title: '规划任务', icons, _meta: { ui: { resourceUri: PANEL_URI } } },
  def('taskflow_attach', '明确接续旧根会话的闲置计划；旧计划有活跃任务时拒绝。', { ...session, planSessionId: string('旧根会话 ID', 240) }, ['sessionId', 'planSessionId']),
  def('taskflow_add', '增补事项，默认挂在当前执行/聚焦事项下；parentId:null 明确根级新增。', { ...session, tasks, parentId: fields.parentId, planVersion: integer }, ['sessionId', 'tasks']),
  def('taskflow_update', '按版本增量修改要求，旧执行失效，保留历史结果。', { ...task, patch: { ...object(fields, []), minProperties: 1 }, version: integer }, ['sessionId', 'taskId', 'patch', 'version']),
  def('taskflow_cancel', '取消事项及下级，保留历史。', { ...task, version: integer }, ['sessionId', 'taskId', 'version']),
  def('taskflow_focus', '聚焦当前会话负责的事项，后续增补默认挂在此项。', task, ['sessionId', 'taskId']),
  def('taskflow_reorder', '按计划版本移动同级事项，不修改父子和依赖关系。', { ...task, direction: { enum: [-1, 1] }, planVersion: integer }, ['sessionId', 'taskId', 'direction', 'planVersion']),
  def('taskflow_start', '执行到此项时启动；delegate 返回原生可见聊天子会话 dispatch。父会话须发现 create_chat_session 并实际创建启动，不得用内嵌 Agent 替代。', task, ['sessionId', 'taskId']),
  def('taskflow_claim', '已创建的独立聊天子会话用自己的 Hook session_id 认领父任务 dispatch；成功取得全树并发名额后才能执行，父会话不能代交。', { ...attempt, planSessionId: string('dispatch 提供的直接父会话 ID', 240) }, ['sessionId', 'planSessionId', 'taskId', 'attemptId', 'version']),
  def('taskflow_assess', '实际执行 Agent 保存本层是否拆解的判断和依据。', { ...attempt, needsSplit: { type: 'boolean' }, reason: string('拆解或直接执行依据', 2000) }, ['sessionId', 'taskId', 'attemptId', 'version', 'needsSplit', 'reason']),
  def('taskflow_progress', '保存公开执行记录：目标、操作、发现/验证、下一步/阻塞和产物；不存私有推理。', { ...attempt, summary: string('实际执行记录') }, ['sessionId', 'taskId', 'attemptId', 'version', 'summary']),
  def('taskflow_complete', '真实执行 Agent 先持久化 completed/blocked/failed 最终结果，再返回直接父 Agent。', { ...attempt, status: { enum: ['completed', 'blocked', 'failed'] }, summary: string('结果、证据和产物位置') }, ['sessionId', 'taskId', 'attemptId', 'version', 'status', 'summary']),
  def('taskflow_wait', '标记等待下级，释放本项占用的委派并发名额；不阻塞 MCP 请求。', attempt, ['sessionId', 'taskId', 'attemptId', 'version']),
  def('taskflow_resume', '下级全部结束后恢复本层，重新获取全树并发名额。', attempt, ['sessionId', 'taskId', 'attemptId', 'version']),
  def('taskflow_pause', '明确确认执行中断后暂停本项和活跃下级，使旧尝试失效；不终止宿主模型。', { ...task, version: integer, reason: string('实际中断原因', 2000) }, ['sessionId', 'taskId', 'version', 'reason']),
  def('taskflow_notifications', '读取直接发给当前父会话的有效完成通知；阅读后显式 ack。不会唤醒宿主。', { ...session, ack: { type: 'array', maxItems: 200, uniqueItems: true, items: string('已阅读的通知 ID', 500) } }, ['sessionId']),
];
