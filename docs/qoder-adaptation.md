# Qoder 适配记录

日期：2026-11-18；子会话修复更新于 2026-11-19。分支：`codex/qoder-marketplace`，基线 DSH `0.1.4`。Qoder 包单独命名 `qoder-taskflow@0.1.0-alpha.1`，不复用已发布 npm 版本号。

## 接入依据

以下官方页面于上述日期实际获取；原始响应留在被 Git 忽略的 `.local/qoder-research/`，不将它们作为永久 API 承诺。

- [市场](https://qoder.com/zh/marketplace)：能力市场及开发者发布入口 `https://qoder.com/account/apphub-publications`。
- [Plugin Reference](https://docs.qoder.com/cli/plugins-reference)：`.qoder-plugin/plugin.json`、组件声明、市场目录格式。
- [Plugins](https://docs.qoder.com/cli/plugins)：`QODER_PLUGIN_ROOT`、`QODER_PLUGIN_DATA`、本地安装与 validate。
- [Hooks](https://docs.qoder.com/cli/hooks)：exec 形式的 command/args、真实 session_id/agent_id、additionalContext 和 hookEventName。
- [Qoder Plugins](https://docs.qoder.com/qoder/plugins)：ZIP 导入、MCP Apps 界面容器、独立 app 入口及用户授权要求。
- [Extension Publishing](https://docs.qoder.com/qoder/extension-publishing)：本地创建/导入不等于公开发布。
- [Subagent](https://docs.qoder.com/cli/subagent)：独立上下文、原生委派和子 Agent 配置。

Qoder 网页、桌面与 IDE 版本的能力不同。官方公开材料没有提供与 DSH 相同的会话侧栏 keyed slots、只读子会话写入、输入框草稿插槽和自动唤醒接口。本候选使用插件机制实现持久任务核心和 MCP Apps 面板；不把自行写 JSON 当原生会话。会话入口额外使用本机实测的请求元数据，兼容边界见下文。

## 代码与产物

- `src/qoder/`：存储适配、工具协议、执行绑定、Hook、界面。
- `qoder/`：插件元信息、技能、Agent、命令、使用说明。
- `scripts/build-qoder.mjs`：自包含 CommonJS 运行时和内联 MCP Apps 页面，按白名单产生 ZIP 与哈希报告，收集实际打包依赖许可证。
- `test/qoder.test.mjs`：持久性、多个进程写入、迟到结果、通知、真实 MCP stdio 握手/工具/资源、压缩包独立运行等验证。

```sh
npm run build:qoder
npm run test:qoder
npm run check
```

`dist/qoder-taskflow-0.1.0-alpha.1.zip` 是供 Qoder 本地导入的候选；`dist/qoder-package-report.json` 记录 ZIP SHA256 与逐文件哈希。

## 本轮验证结果

- `npm run check`：87 项通过，其中原有 DSH 71 项、Qoder 新增 16 项；12 个宿主版本边界检查通过。
- Qoder 测试覆盖独立 ZIP 解压后的实际 MCP stdio 握手、18 项工具发现与调用、资源读取、Hook 冷读取、12 个进程并发写入、父子归属、依赖、并发释放、版本失效、恢复和通知隔离。
- 初版共享 MCP 进程回归：同一进程、相同 sessionId 在两个项目创建计划后分别读取，目录与内容保持隔离；缺少 `projectPath` 的模型读写请求被拒绝。初版全局目录入口已由后述会话自动绑定替代。
- 打包后的界面在 JSDOM 中完成 MCP Apps 握手，验证树形展开、Markdown 表格、执行记录默认可见、危险 HTML/链接隔离及刷新。该结果不等于真实 Qoder 桌面视觉验收。
- `npm run check:package`：DSH 包白名单、离线生产安装与压缩包 AgentLoop 通过。分支内文档改变使本地 DSH 包哈希不同于正式已发布的 0.1.4；本地包未发布。
- `npm run check:hosts`：DSH `0.2.1-rc.3`、`0.2.2-rc.2`、`0.2.2-rc.3`，各 20 项服务端和 4 项客户端检查通过，使用固定响应模型。
- taskflow 技能通过 skill-creator 的 `quick_validate.py` 校验。
- 本机 Qoder Desktop **0.5.14 stable**（实际目录 `D:\Program Files (x86)\Qoder`，commit `b3ac4400116cbd2aeef3d0ef2a4d0691ee632535`）已按用户批准的手动方案安装启用；已实际发现 Skill，真实模型确认收到 Hook 注入的宿主 sessionId。完整执行验收结果见下文。

当前候选 ZIP 的字节数与 SHA256 以 `dist/qoder-package-report.json` 为准；旧包哈希不再适用。

## Qoder 0.5.14 实机安装检查

2026-11-18 先使用客户端 **Extensions → Plugins → Add Plugins → Upload Plugin**，由用户在原生文件选择器中选择 ZIP；正常导入持续失败后，经用户明确批准改用手动安装。

1. 首包被自带校验器 `qodercli 1.1.86-hotfix.5.3` 拒绝，错误 `plugin.manifest.schema_invalid`，JSON pointer `/agents`，具体原因 `Path must end with .md`。已把目录声明改为 `["./agents/taskflow-worker.md"]`，并补充打包回归检查。
2. 修复包在宿主日志中 **plugin-validation success**、**conflict-check success**。随后 `publish` 阶段将临时目录 `.publishing-<uuid>` 重命名到 `~/.qoder/plugins/cache/local/qoder-taskflow/0.1.0-alpha.1` 时失败，Windows `EPERM`，宿主展示 `EXTENSION_INSTALL_PERMISSION_DENIED`。这不是仍未通过包内容校验。
3. 用户保存工作并重启后仍复现。同一父目录只读 ACL 检查显示当前用户有 FullControl，简单创建、写入及重命名成功；完整插件复制对照连续 3 次均首次 `EPERM`，约 59–67ms 后重试成功。观察支持短暂重命名故障，不能据此归因于特定占用进程或杀毒软件。未修改 ACL。只读检查随附安装器发现该发布步骤直接复制后重命名，没有重试。
4. 用户批准手动方案后，先核对包和源文件哈希，备份设置与注册表，再复制 15 个文件并在最多 3 秒内重试重命名；仅新增 `qoder-taskflow@local` 注册及对应启用字段。安装目录为 `~/.qoder/plugins/cache/local/qoder-taskflow/0.1.0-alpha.1`，逐文件哈希一致，客户端已显示本地插件并启用。备份、计划、安装结果和探测证据保存在被 Git 忽略的 `.local/qoder-acceptance-20261118/`；本次探测目录已清理。

本机随附的 `resources/plugin-creator/skills/references/mcp-apps/spec.md` 同时明确支持工具 `_meta["qoder/ui"].entrypoints` 的 global/thread 入口，资源 `_meta.csp` 和 teardown。初版据此提供项目选择入口；本轮优化改为仅注册 thread“任务”入口及自动绑定。标准 MCP Apps 的 `_meta.ui.csp` 同时保留，页面释放后停止请求。

## 桌面端共享 MCP 进程

实机确认桌面端由 App 启动并复用插件 MCP 进程，不能把该进程的 `cwd` 当成用户当前项目。候选据此改为：Hook 注入真实 `sessionId` 与规范化项目绝对路径 `projectPath`；每个有会话的工具调用必须显式传入路径，由服务端逐请求计算项目隔离目录。子任务 dispatch 同时携带路径。MCP 固定在插件目录启动，缺路径的调用直接拒绝。

Hook 通过显式参数取得与 MCP 一致的 `QODER_PLUGIN_DATA` 数据根目录。创建计划时保存项目路径元数据；会话入口按请求的真实 sessionId 查找对应项目，不默认打开最近计划。安装副本更新后需让 Qoder 刷新插件详情/资源，以重新启动 MCP、更新工具 schema；仅替换磁盘文件不能证明旧进程已加载新版。

## Windows 子 Agent 兼容处理

Qoder Desktop 0.5.14 在本机调用插件限定类型 `qoder-taskflow:taskflow-worker` 时，用该名称生成 `agent-aqoder-taskflow:taskflow-worker-….meta.json`，Windows 因冒号拒绝重命名（`EINVAL`）；此次子 Agent 未能认领任务。父会话代交 delegate 结果被服务端正确拒绝，随后暂停原 attempt 并保存原因。

当时的候选在 Windows 的 dispatch 中改用内置 `general-purpose`，同时传递完整 Taskflow worker 契约：读取自身 Hook 真实身份和项目路径，先 claim，再保存公开执行记录和最终结果，保存成功后返回。非 Windows 仍使用插件 worker。此方案不修改宿主二进制或用户 Agent 配置，也不绕过真实子 Agent 认领。内置 Agent 路线当时已经实机通过，但属于会话内执行，不产生左侧可见聊天条目。该路线已由下述原生聊天子会话方案替代；历史结果保留。插件限定类型的宿主文件名问题并不能证明原生聊天子会话不可用。

## 真实执行与面板验收

在独立会话“Qoder taskflow 实机验收”中，真实模型使用 Hook 注入的身份及 `D:\workspace_wm\dsh-taskflow` 项目路径，创建“Qoder 实机验收 20261118”计划。没有通过编辑账本伪造执行结果。

| 检查 | 实机结果 |
| --- | --- |
| 组件与连接 | 已发现 Skill；Hook 提供真实会话/子 Agent 身份与项目路径；18 项 MCP 工具可见、实际调用成功 |
| T-001 inline | `17×19=323`，公开过程、交叉验证与最终结果持久化，状态 completed |
| T-002 delegate | 依赖 T-001，暂停失败的首次 attempt 后重新 start；内置 general-purpose 真实子 Agent 以自身身份 claim，保存过程及结果 `1+…+10=55`，状态 completed |
| 父子归属与通知 | 子执行身份不同于父会话且正确绑定；父会话读取两条完成通知并显式 ack，均 delivered=true |
| 全局面板 | 侧栏 Taskflow → 选择项目与计划，显示明确项目路径、根事项完成 2/2；点击两项可查看公开过程和结果；T-002 历史保留首次暂停原因 |
| 刷新与冷恢复 | 刷新后状态一致；宿主主进程由 15640 更换为 17344 后，新 MCP 进程 54184 于 07:41:42 UTC ready，新窗口仍可读取同一计划及 T-002 详情，账本 revision 14、任务 ID、attempt 与通知状态保持一致 |

当前安装副本的 15 个文件与候选包逐项校验一致。验收摘要、包哈希、任务/attempt 标识和面板观察文本存于被 Git 忽略的 `.local/qoder-acceptance-20261118/`，不包含模型私有推理。

## 验收边界

本轮已实机验证手动安装启用、组件发现、Hook 身份与路径、MCP 连接、两项真实模型执行、一次真实子 Agent 委派、通知确认、MCP Apps 面板交互及宿主重启后的已完成计划恢复。普通 ZIP 导入仍受上述发布目录瞬态 `EPERM` 影响，不能标记为通过；插件限定 Agent 类型在此 Windows 宿主仍有上述文件名缺陷。

递归孙 Agent、真实多 Agent 并发、执行途中宿主重启、跨设备、卸载/升级保留数据和市场公开发布尚未实机验证。自动测试中的并发与恢复覆盖不能替代这些宿主验收，也未证明原生结果自动唤醒。

完整 DSH 需求中的主侧栏会话挂载、inline 原生记录子会话、工具面板自动打开/停靠及输入框推荐回复仍需对应 Qoder 宿主扩展接口；本候选未声称实现。此次只创建独立验收计划，生产任务、DSH profile、原有任务账本和市场 PR 未改动。Qoder 候选已本地安装启用，尚未公开发布。

## 会话任务面板优化（2026-11-18）

Qoder Desktop 0.5.14 stable 的会话右侧 App 请求在 `params._meta["com.qoder/turnContext"].sessionId` 中携带真实会话 ID，初始工具参数为 `{}`；真实入口和后续轮询均已观测。该元数据尚未列入公开插件文档，是本版本的实测兼容接口。证据保存在本地 `.local/qoder-panel-host/panel-probe.jsonl`。缺失或非法身份显示会话入口提示，不回退全局目录；精确匹配 root、子执行与显式接续别名，重复项目身份拒绝歧义。

入口改为仅 thread，标题“任务”及 checklist SVG icon。面板去掉项目/计划选择与路径，默认展示任务详情，采用紧凑清单、进度和状态标签；支持浅深色、窄右栏与宽屏。可见时每 3 秒只读刷新；空参数入口始终保持 `{}`，不把响应里的 sessionId 固定成另一个会话。模型生成的卡片只使用明确 tool-input 绑定，输入切换会使旧异步请求失效。页面释放停止请求。

`taskflow_plan` 返回同一面板 view 并声明 UI 资源，资源默认 inline，使规划结果直接展示。已经打开的右侧面板自动读取最新账本。纯聊天清单及其他工具的临时 todo 不会自动导入；技能要求模型通过 Taskflow 写入权威计划。宿主没有公开的任意固定右上工具栏按钮或自动弹开 App tab 接口，当前入口位于右上侧栏应用菜单中。

新增回归覆盖真实 metadata 路由、缺上下文、无计划、跨项目歧义、接续别名、内联规划资源、自动发现计划、输入切换和迟到响应隔离；本次 `npm run test:qoder` 为 17 项通过。原版人工选择面板的验收表保留为当时事实，不能用于证明新版界面。

### 新版实机结果

在同一 Qoder 0.5.14 stable 上，已重新加载插件，MCP 日志确认新进程 50724 于 08:28:02 UTC ready。右上“＋”的 Apps 菜单实际出现带图标的“任务”项；宿主当前使用通用插件图标，面板内显示 checklist 图标。打开原验收会话的入口后直接看到 2/2 完成清单和默认详情，没有项目/计划选择、切换计划按钮或文件路径。

独立新会话“Taskflow 面板验收”（`00b1a86e-b122-436c-a984-5e0837514900`）先显示“当前会话暂无任务”，没有混入原会话计划。随后真实模型读取 Skill 和 status，仅调用 taskflow_plan 创建“会话自动展示验收”（`4ca6da1a-9b51-4093-9356-a4cb47f4b43c`）；未调用 taskflow_panel，右侧原已打开的空面板自动出现“检查输入格式”“核对输出摘要”，聊天内也直接展示同一清单。两项均为 pending，T-002 依赖 T-001；点击任务可直接查看对应要求、完成标准和依赖。原计划及完成结果保留，账本 revision 由 14 变为 15，仅新增独立验收计划。

实机发现宿主尺寸变化通知会省略 theme，原处理会回退浅色；已改为保留最近主题，并通过部分 host-context 更新回归。重新打开后的最终右侧面板显示深色主题，窗口尺寸变化及任务切换后仍正常。此前打开的旧页面需关闭重开才能加载新 HTML。

本轮全部回归 `npm run check` 为 88 项通过（DSH 71、Qoder 17），12 个宿主版本边界检查通过。主题修复后再次运行 Qoder 17 项全部通过；`git diff --check` 通过。最终包哈希、安装 15 文件一致性、独立计划状态和观察结论见本地 `.local/qoder-panel-host/ui-acceptance.json`；包哈希仍以 `dist/qoder-package-report.json` 为准。临时 stdin 诊断与环境变量已从安装副本移除；未改用户设置或插件注册表。

## 原生可见子会话修复（2026-11-19）

根因是 Taskflow dispatch 按平台硬编码 `general-purpose` / `taskflow-worker`，技能也只要求内嵌 Agent。status 的顶层静态 false 描述的是插件直接集成能力，不能用来推断宿主缺少聊天子会话或完成回调。单纯调整提示文案之外，start 的结构化契约现改为 `execution.kind: native-chat-session`、`visible:true`、`allowEmbeddedAgent:false`，不再输出 agent 字段；Hook、MCP 指令、工具描述和技能一致要求父会话调用宿主原生聊天工具。

在独立“Taskflow 工具发现”会话中，通过宿主 mcp_get 取回原始 schema，并实际只读调用 list_workspaces。Qoder Desktop 0.5.14 注册了 `mcp__builtin__create_chat_session`、`list_workspaces`、`wait_chat_sessions`、`read_chat_session`、`send_message_to_chat_session`，也注册了需已有已发布团队 squadId 的 `create_team_task`。单事项选择 create_chat_session：必填自包含 prompt；项目工作先按 catalog 的真实 workspaceId 选择；创建即启动；callbackMode:supervise 接收完成/交互回调；创建回执不等于完成。回调疑似遗漏才用 wait(timeoutMs:0)/read 检查。schema 的存在与执行验收分别记录，不能互相替代。跨设备执行尚未验证。

子聊天会话使用自己的 SessionStart/UserPromptSubmit Hook session_id、dispatch 的项目路径与 attempt/version 认领，不新建计划。账本复用现有身份绑定、父层归属、并发、过期尝试和通知规则；历史 agent_id 结果兼容。创建工具不可用或确定失败则 pause 留证，再 start 重试；不确定回执先查已有会话，禁止重复创建或静默退回内嵌 Agent。capabilities 改为区分 plugin 与 host，要求在当前环境发现工具。

本轮自动检查：npm run check 全部 89 项通过（DSH 71、Qoder 18），12 个宿主边界检查通过。额外回归验证 UUID 聊天身份认领、禁止父会话代交、跨计划占用、失败暂停后旧 attempt 认领失效；原有递归归属与全树并发回归继续通过。

本地更新先备份安装副本、逐文件哈希校验；账本不由安装器修改。实机发现插件详情“刷新”没有重启未变更配置的共享 MCP 进程，必须在该插件详情中将 taskflow 连接停用再启用（没有活跃 Taskflow 执行时），待 Ready 并重新调用 status 核对协议；仅看磁盘或 README 不能算新版加载。此次旧 MCP PID 9124 退出，新 PID 45828 启动，真实模型已收到新版 delegation。不要因此改权限或反复导入 ZIP。

本轮接口和独立执行证据存于忽略目录 `.local/qoder-session-delegation-20261119/`，不包含模型私有推理。实机最终结果见后续记录。

### 可见子会话实机结果

后续右上固定入口和左侧父子层级的核对见 [Qoder 原生入口与会话层级接入](qoder-host-ui-integration.md)。已确认宿主保存了原生委派父子关系；当前构建的左侧列表未显示缩进，不能把“子会话可见”当成“可视化层级已完成”。

父会话 `eee676be-9215-4695-ba07-c2b07de58692` 的独立计划 `dea17c87-0f38-4e83-9371-b381b3dc9d29` 仅含一个 delegate 事项 T-001。真实模型调用原生 create_chat_session(callbackMode:supervise)，宿主返回 `c0541bf9-ed8b-55b0-a4e5-7c1573d11977`。左侧工作区列表出现该会话，点击后打开其独立消息与最终回复，未使用内嵌 Agent。该宿主按 prompt 自动命名条目，显示为 prompt 开头；当前没有传入自定义 title 参数。

子会话自身 Hook session_id 与 create 回执一致，实际自行 claim → progress → complete；attempt `bf73a401-4f75-4a5c-9686-4fe930e1e4c0`、version 1，最终 completed，23×29=667，通过 23×30−23 与 29×20+29×3 交叉验证。账本 executionSessionId 与子会话 ID 一致，父会话未代交。宿主 supervise 完成回调实际送达，父会话 read/status 核对后显式 ack 通知。右侧任务面板显示 1/1 已完成及过程和最终结果。

执行中两次无效调用被正确拒绝且未改变账本：子会话一次 progress 多传 projectId，修正后成功；父会话错误调用 taskflow_wait（它未在执行该委派事项），被归属校验拒绝。根会话仅等待宿主回调即可；只有自己正在执行、并等待下级的事项才需释放账本并发名额。这两次拒绝没有导致父代交、状态假完成或重复创建。

独立证据文件 acceptance.json 与 public-tool-evidence.json 记录宿主创建回执、父子工具调用、attempt/结果与通知状态；未保存模型私有推理。对原生产计划和前两次验收计划分别比较完整计划对象 SHA256，三者均保持不变。本次修复只新增独立验收计划，未执行生产计划的 T-003 等事项。原生多层聊天委派、跨设备与执行中断恢复尚未实机验证；不能由本次单事项验收推断全部通过。
