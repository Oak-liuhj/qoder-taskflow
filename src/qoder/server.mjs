import { VERSION } from './version.mjs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import { readFile } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { projectDirectory, sessionProject, rememberProject } from './store.mjs';
import { execute } from './adapter.mjs';
import { PANEL_URI, tools } from './schemas.mjs';

async function main() {
const validator = new AjvJsonSchemaValidator();
const validators = new Map(tools.map(t => [t.name, validator.getValidator(t.inputSchema)]));
const server = new Server({ name: 'qoder-taskflow', version: VERSION }, {
  capabilities: { tools: {}, resources: {} },
  instructions: '使用 Hook 注入的真实 sessionId。已有计划通过增量操作维护，执行到该项才 start/claim。delegate 必须用原生 create_chat_session 创建可见聊天子会话，子会话以自己的 session_id 认领，不用内嵌 Agent 替代；发现宿主实际 schema 后调用。结果先持久化，再由父会话原生 wait/read 读取。taskflow_panel 提供 MCP Apps 任务树。',
});
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    const validate = validators.get(request.params.name);
    if (!validate) throw new Error('未知 Taskflow 工具');
    const validation = validate(request.params.arguments ?? {});
    if (!validation.valid) throw new Error(`工具参数无效：${validation.errorMessage}`);
    const args = validation.data;
    let result;
    if (request.params.name === 'taskflow_panel' && !args.projectPath && !args.sessionId) {
      const sessionId = request.params._meta?.['com.qoder/turnContext']?.sessionId;
      if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 240 || /[\u0000-\u001f\u007f]/.test(sessionId)) {
        result = { plan: null, contextRequired: true };
      } else {
        const scope = await sessionProject(sessionId);
        result = scope ? { ...await execute(scope.directory, 'taskflow_panel', { sessionId }), projectPath: scope.projectPath }
          : { plan: null, sessionId, notifications: [] };
      }
    }
    else {
      if (!args.projectPath || !isAbsolute(args.projectPath)) throw new Error('需要 Hook 提供的项目绝对路径 projectPath，不能猜测 MCP 进程工作目录');
      const directory = await projectDirectory(args.projectPath);
      if (request.params.name === 'taskflow_plan') await rememberProject(directory, args.projectPath);
      result = await execute(directory, request.params.name, args);
      // Planning renders the same live App as the thread entrypoint, without
      // requiring a second model call or an explicit "open separate view" click.
      if (request.params.name === 'taskflow_plan') result = await execute(directory, 'taskflow_panel', args);
      if (result && !Array.isArray(result)) {
        result.projectPath = args.projectPath;
        if (result.dispatch) result.dispatch.projectPath = args.projectPath;
        if (result.plans) result.plans = result.plans.map(p => ({ ...p, projectPath: args.projectPath }));
      }
    }
    const structuredContent = Array.isArray(result) ? { tasks: result } : result ?? { ok: true };
    return { content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: error.code || 'error', message: error.message }) }] };
  }
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: PANEL_URI, name: 'Taskflow', mimeType: 'text/html;profile=mcp-app' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async request => {
  if (request.params.uri !== PANEL_URI) throw new Error('未知 Taskflow 资源');
  const csp = { connectDomains: [], resourceDomains: [] };
  return { contents: [{ uri: PANEL_URI, mimeType: 'text/html;profile=mcp-app', text: await readFile(join(__dirname, 'panel.html'), 'utf8'), _meta: { csp, ui: { csp, prefersBorder: true }, 'qoder/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' } } }] };
});
await server.connect(new StdioServerTransport());
}
main().catch(error => { process.stderr.write(`Taskflow MCP: ${error.message}\n`); process.exitCode = 1; });
