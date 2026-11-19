const text = description => ({ type: 'string', description });
const enumeration = (description, values) => ({ ...text(description), enum: values });
const reference = description => ({ description, oneOf: [text(description), { type: 'null' }] });
const fields = {
  title: text('具体任务标题'), instructions: text('执行要求'), criteria: text('完成标准'),
  complexity: enumeration('任务复杂度', ['low', 'medium', 'high']),
  independent: { type: 'boolean', description: '能否通过要求、文件和前置结果独立执行；设计、入口实现、整体验证等有独立产物的中高复杂度事项优先 true。共享项目或先后依赖不代表必须共享会话' },
  mode: enumeration('delegate 在子会话独立执行；inline 在父会话执行并自动保存到事项子会话。high 且 independent=true 时自动委派，达到深度上限才转行内', ['inline', 'delegate']),
  parentId: reference('组成归属：父任务 ID、唯一完整名称或本批次已声明 ref；null 表示主目标下的同级根事项。不是执行先后，设计不能仅因依赖勘察而挂在勘察下'),
  dependsOn: { type: 'array', items: text('依赖任务 ID 或本批次已声明 ref'), description: '执行前必须完成的前置事项；同级阶段用此字段排序，不用 parentId。不能依赖父任务或祖先完成' },
};

export const tasksSchema = {
  type: 'array', description: '待办数组，直接传数组；每项至少包含 title。ref 可供同批任务的 parentId/dependsOn 引用。',
  items: { type: 'object', additionalProperties: false, properties: {
    ...fields, title: { ...fields.title, required: true }, ref: text('本批次临时引用'),
  } },
};
export const patchSchema = { type: 'object', description: '仅传需要修改的字段', additionalProperties: false, properties: fields };

// Normalize before defineTool's strict validation, preserving model-facing
// array/object schemas. Only one encoding layer is accepted; never coerce data.
export function normalizeToolArguments(name, args) {
  const field = ['taskflow_plan', 'taskflow_add'].includes(name) ? 'tasks' : name === 'taskflow_update' ? 'patch' : null;
  if (!field || !args || typeof args !== 'object' || Array.isArray(args) || typeof args[field] !== 'string') return args;
  let value;
  try { value = JSON.parse(args[field]); }
  catch { throw new Error(`${field} 不是有效 JSON；请直接传${field === 'tasks' ? '任务数组' : '修改对象'}，不要重复转义`); }
  if (field === 'tasks' ? !Array.isArray(value) : value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} 必须为${field === 'tasks' ? '任务数组' : '修改对象'}，不接受多层 JSON 字符串`);
  }
  return { ...args, [field]: value };
}
