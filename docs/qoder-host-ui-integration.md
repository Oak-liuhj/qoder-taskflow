# Qoder 原生入口与会话层级接入

核对日期：2026-11-19。目标：本机 Qoder Desktop 0.5.14 stable。

本次要求是：右上角在 **Open sidebar** 旁增加“图标 + 任务”按钮，单击打开当前会话的 Taskflow；左侧原生会话列表按父子关系展示委派任务，沿用宿主样式。这两项目前均未实现，不能用现有 Apps 菜单入口或插件面板内任务树代替验收。

## 右上角入口

自带 `resources/plugin-creator/skills/references/mcp-apps/spec.md` 的 `qoder/ui.entrypoints` 只声明 global、thread、settings。`plugin-guide.md` 给出的 thread 路径是 Open sidebar → More tools，或 + → Apps。现有插件正确注册了标题为“任务”的 thread 入口，但此入口不会增加与 Open sidebar 并列的按钮。

随安装包核对的 renderer `out/renderer/assets/DB5RheoM.js`：

- `NV0` 渲染会话头操作区；`U51` 固定组合终端与 sidebar 按钮，没有在此观察到插件按钮 contribution slot。
- App-plugin 的 `hostHeader/headerActions` 针对插件自己的 `location: "workbench"` 页面，挂载至 `workbench-header-actions`；不能用于聊天的 `chat-session-header-icon-actions`。

当前未找到满足指定位置的正式插件接口。不能向 entrypoints 添加猜测的 toolbar 类型，也不能把 workbench 页面入口当作聊天工具栏入口。

宿主需提供的接入：在会话头开放动作注册，允许已启用的 thread App 提供 icon、label 和打开动作；点击时复用现有 thread App 打开流程，传入当前真实 sessionId，直接激活对应 tab。以下是接口需求，尚无可用的 manifest 参数可配置此行为。

验收需覆盖：按钮与 Open sidebar 并列；一次点击直接打开任务；重复点击复用 tab；切换父/子会话后显示对应任务；无计划显示空状态；插件停用后移除按钮；深浅主题与窄窗口沿用宿主样式。

## 左侧父子会话

只读查询宿主 `main.sqlite` 中上轮独立验收的两个会话，已确认：

| 字段 | 实际值 |
| --- | --- |
| 父 sessionId | eee676be-9215-4695-ba07-c2b07de58692 |
| 子 sessionId | c0541bf9-ed8b-55b0-a4e5-7c1573d11977 |
| 两者 workspaceId | 1efc2e7f-19e2-4fd3-a2ea-d51e80586ab0 |
| 子 extra_json.delegationParent.sessionId | eee676be-9215-4695-ba07-c2b07de58692 |
| 子 delegationParent.authorityEndpointId | a4b16007-7dac-4dae-a6cd-49fdae97b644 |
| 原生创建 provenance | action=create，initiator 为上述父会话，callbackMode=supervise，status=accepted |

两者均为未归档 standard 会话，origin_session_id 为 null。宿主已记录正确的委派父子归属；无需让 Taskflow 再补写关系，也不应手工改宿主数据库。`create_chat_session` 的已发现 schema 没有 parentSessionId/title 参数，不添加臆造参数。

renderer 中已有基于 `delegationParent` 的 `y0t` 树计算：校验父会话存在、authority/workspace 一致，处理环路与置顶例外；`Hee` 按树展开列表，并生成 guides。问题在可视化：`aL` 使用 `paddingLeft: 0`，guides 没有用于缩进；`L0t = false` 也没有输出树形引导线。子项上下文仍用于控制拖拽等行为。实机左侧观察到父子会话相邻，但外观没有缩进层级。

因此应复用宿主已有父子数据和列表组件，由宿主补齐缩进、引导线及展开/收起交互；不需要改 Taskflow 的 dispatch/claim 协议。当前未找到让插件配置这些原生行样式的正式接口。`L0t` 是当前构建中的常量，不是已发现的用户设置，不能声称改一个配置即可开启。

验收需覆盖：父→子→孙层级；点击仍打开真实独立会话；原生状态、菜单、选中和键盘操作保持一致；折叠/展开；虚拟滚动；跨工作区、孤儿关系、环路、置顶、归档和历史恢复。以上是所需宿主改动与验收项，尚未作为新功能实机通过。

## 证据与改动范围

ASAR SHA256：`5721b4dabee9680ba5d200cf18f903d9d28c3032975bb073aec9626a82317c2f`。源码函数名和常量仅适用于该构建；bundle 字符位置不可当成跨版本接口。

本地忽略目录 `.local/qoder-sidebar-20261119/` 保存限定源码摘录、哈希和只读查询结果。REA 对宿主桥接/插件加载的分析为 partial，不能据此宣称所有宿主机制都已排除；这里的接口结论限定于自带文档、已核对的注册与渲染路径。宿主数据库仅在只读事务内查询上述验收会话，没有写入。

本轮只补充定位与接入说明；未修改宿主二进制、配置、现有任务账本或插件运行时代码，没有生成或安装声称支持这两项的新包。
