# Taskflow for Qoder

Qoder 适配版 **0.1.0-alpha.1**。将复杂目标维护为持久任务树，按依赖执行、按需交给左侧可见的 Qoder 原生聊天子会话，保留执行记录与最终结果。独立于 DSH 的安装、运行时和数据目录。

## 构建与本地导入

构建环境需要 Node.js ≥24.9.0；安装后的 MCP 和 Hook 需要可从 PATH 启动的 Node.js ≥24.9.0，不需要 npm install，不需要配置额外模型密钥。

在源码仓库根目录运行：

```sh
npm ci --ignore-scripts
npm run build:qoder
npm run test:qoder
```

生成 `dist/qoder-taskflow-0.1.0-alpha.1.zip` 和可直接安装的目录 `dist/qoder-taskflow/`。ZIP 内 `.qoder-plugin/plugin.json` 位于顶层；运行依赖、界面和许可证已打包，不包括 node_modules、DSH 宿主和用户账本。

Qoder 桌面：**扩展 → 插件 → 添加插件 → 上传插件**，选择单个 ZIP。Qoder IDE 可使用其插件管理器导入本地目录。支持插件 CLI 的环境也可以：

```sh
qoder plugins validate ./dist/qoder-taskflow
qoder plugins install ./dist/qoder-taskflow --scope local
```

按当前宿主提示重新加载插件。安装界面、CLI 名称和 MCP Apps 支持随 Qoder 产品与版本变化；若本机仅有 `qodercli`，使用它实际提供的同名子命令。检查 taskflow MCP 已连接、技能与 Agent 出现在已安装组件中。

## 使用

在主会话输入：

```text
使用 Taskflow，为当前项目实现文档导入功能。
先建立持久任务树，按依赖执行；独立的复杂事项通过原生 create_chat_session 创建可见子会话，遵循 start 返回的 dispatch。
保留每项的实际过程、验证结果和产物，先保存结果再向直接父任务汇报。
```

也可通过 `/` 选择本插件的 taskflow 命令或技能。`taskflow-status` 命令读取清单；`taskflow_panel` 工具在支持 MCP Apps 的客户端显示层级任务和执行记录，其他客户端返回结构化状态。

Qoder 桌面可从会话右上角 **Open sidebar → More tools / + → Apps → 任务** 打开图标入口。面板自动显示当前会话的任务内容，不需要选择项目或计划，也不显示会话文件路径。切换会话后按宿主传入的会话身份读取；当前会话没有计划时显示空状态。

模型通过 `taskflow_plan` 规划后，工具结果会直接展示任务清单；已经打开的右侧面板在可见时每 3 秒只读刷新。新增、执行和完成事项会同步到同一清单。纯聊天中的列表或其他工具的临时待办不会自动导入，请让模型使用 Taskflow 维护计划。固定在宿主右上角菜单之外的按钮、自动弹开右侧标签，目前没有公开插件接口。

已有计划时直接说“在当前任务下增加移动端校验”“将 T-002 的要求改为支持 TXT”或“继续未完成事项，保留原 ID 和结果”。不重复规划。明确“只规划”则不执行。新会话接续旧计划使用 `taskflow_attach`，提供旧根会话 ID；旧计划仍有活动事项时先在原会话确认中断并暂停。不要暂停其他仍在工作的 Agent。

## 数据与执行

- 每个项目按规范化绝对路径的 SHA256 隔离。账本在 `TASKFLOW_QODER_DATA/projects/<hash>/taskflow.json`；插件通过 `QODER_PLUGIN_DATA` 提供数据根目录，缺省回退到 `~/.qoder/taskflow`。不读写 `~/.dsh`。
- 桌面端可共享同一个 MCP 进程。模型工具调用必须使用 Hook 注入的真实 `sessionId` 和 `projectPath`；缺项目路径时拒绝读写，不回退到 MCP 启动目录。会话面板的空参数只读请求使用 Qoder 0.5.14 实测提供的 `_meta["com.qoder/turnContext"].sessionId` 精确查找项目；无上下文时提示从会话打开，多个项目身份冲突时拒绝猜测。
- 持久化复用 DSH 版本的领域校验和原子文件提交，多个 MCP 进程逐操作竞争写入锁。损坏账本不覆盖、不自动清空。
- Hook 仅注入宿主提供的会话身份及已有计划提示；不读取私有推理、不额外调用模型，不修改宿主配置。
- delegate 事项由父会话发现原生 `create_chat_session` 的实际 schema 并创建、启动可见聊天子会话。子会话使用自己的 Hook `session_id` 认领 dispatch；父会话保留宿主返回的 ID，通过 `callbackMode:supervise` 接收结果，必要时用原生 `wait_chat_sessions(timeoutMs:0)` / `read_chat_session` 检查或读取，再核对账本完成状态。默认全树并发 2、委派深度 2，等待下级释放名额。MCP 本身不直接创建或终止宿主会话。
- 原生会话工具不可用或创建失败时明确报告并 pause 留证，重新 start 后重试；禁止用内嵌 Agent 静默替代。历史内置 Agent 执行记录保留。旧版 Windows 的插件限定 Agent 名冒号 `EINVAL` 不再是默认委派路线。
- 结果绑定任务版本与尝试 ID，迟到结果被拒绝；先落盘，再由原生聊天子会话返回摘要给直接父会话。完成通知保留到直接父会话读取并明确 ack。
- 重启服务不自动暂停或重跑仍可能在别处执行的事项。已确认中断时显式 pause/start，旧尝试失效，历史保留。

## 与 DSH 版的能力差异

| 能力 | Qoder 适配方式 |
| --- | --- |
| 持久任务树、稳定 ID、增量修改、依赖和历史 | 复用领域核心，独立 MCP 工具 |
| 按需真实子执行 | Qoder 原生可见聊天子会话 + dispatch/claim；先发现宿主工具 |
| 递归拆解 | 受账本深度与并发限制；宿主不允许嵌套委派时用本层 inline 子项并说明 |
| inline 执行记录 | 持久化在事项历史和面板中；尚未提供原 DSH 版的真实只读记录子会话 |
| 层级导航与详情 | MCP Apps 会话右侧“任务”图标入口，自动按会话展示与刷新；规划结果内联展示；尚未接入原生会话跳转或固定工具栏按钮 |
| 直接父任务结果 | 持久通知 + 原生 wait/read；不假定自动唤醒，按实际宿主工具执行 |
| 工具与文件预览 | 使用 Qoder 原生能力，尚未实现原 DSH 工具面板的自动停靠集成 |
| 输入框模型推荐回复 | 本适配版尚未实现 |

本版本是可构建、可导入的适配候选，不能视为 DSH 界面的完整移植。自动规划与调度依赖模型实际遵循技能和原生工具；不是独立后台 Agent 服务。

## 市场提交

用户给出的 [Qoder 市场](https://qoder.com/zh/marketplace) 同时展示能力扩展。官方 [插件说明](https://docs.qoder.com/qoder/plugins) 与 [插件参考](https://docs.qoder.com/cli/plugins-reference) 规定本包目录和导入方式。公开市场需在账户的开发者发布入口完成实际提交和审核；本地 ZIP 导入或代码推送 GitHub 不等于市场公开。本候选尚未提交 Qoder 市场，未修改 DSH 的市场条目。

详细接口依据、验证与待验收事项见源码仓库 `docs/qoder-adaptation.md`。本包不要求 Qoder SDK 权限，也不携带登录态或访问令牌。

`capabilities.plugin` 仅描述插件直接集成能力；`host.nativeChatSessions: discover-tools` 要求当前模型发现宿主工具，不能据插件侧 false 推断 Qoder 无法创建原生会话。创建返回的会话 ID 与账本 executionSessionId 应一致；真实左侧显示须以实机验收为准。
