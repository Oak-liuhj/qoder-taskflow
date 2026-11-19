# Taskflow for Qoder

[English](README_en.md) · [源码与问题反馈](https://github.com/Oak-liuhj/qoder-taskflow)

**Qoder 的持久任务编排插件。** 将复杂目标组织为任务树，按依赖执行，按需创建原生聊天子会话，并保存实际过程、结果和产物。

正式版版本号：**0.1.0**。插件广场提交状态见 [发布记录](https://github.com/Oak-liuhj/qoder-taskflow/blob/main/marketplace/SUBMISSION.md)。

## 功能

- 持久任务树：稳定任务 ID、父子关系、依赖、完成标准与历史，跨对话轮次和重启保留。
- 增量维护：通过对话增补、修改、取消、调整顺序，继续未完成事项时保留既有结果。
- 原生聊天委派：独立事项按需调用 Qoder 原生 create_chat_session，子会话以自己的真实身份认领任务。
- 执行记录：保存可观察操作、验证、阻塞、最终摘要及产物位置，拒绝旧尝试和旧版本结果。
- 会话任务面板：右侧“任务”入口自动读取当前会话，展示层级清单、状态、进度与详情，可见时自动刷新。
- 独立项目存储：按项目路径隔离，多个进程写入有锁，损坏账本保留原文件。

## 安装

运行 MCP 和 Hook 需要 **Node.js ≥24.9.0**，且 node 可从 PATH 启动。安装包已包含运行依赖，无需在插件目录执行 npm install，也无需配置额外模型密钥。

Qoder 桌面：**扩展 → 插件 → 添加插件 → 上传插件**，选择 qoder-taskflow-0.1.0.zip，按宿主提示重新加载。插件广场公开后，也可搜索 qoder-taskflow，确认作者 Oak-liuhj 和源码仓库后安装。

支持插件 CLI 的 Qoder 环境可验证并安装解压后的目录：

```sh
qoder plugins validate ./dist/qoder-taskflow
qoder plugins install ./dist/qoder-taskflow --scope local
```

CLI 名称和插件入口随产品版本变化；仅有 qodercli 时使用它实际提供的子命令。安装后检查 taskflow MCP 已连接、技能和命令已加载。

## 使用

在项目主会话输入：

```text
使用 Taskflow，为当前项目实现文档导入功能。
先建立持久任务树，按依赖执行；独立复杂事项创建原生聊天子会话。
保留实际过程、验证结果和产物，先保存结果再向直接父任务汇报。
```

也可通过 / 选择 taskflow 技能或命令；taskflow-status 读取现有清单。若仅需计划，明确“本轮只规划，暂不执行”。已有计划时说“继续未完成事项，保留原 ID 和结果”“在 T-002 下增加校验”或“将 T-003 的要求改为支持 TXT”。

会话右上角 **Open sidebar → More tools / + → Apps → 任务** 打开面板。面板自动绑定当前会话，无计划时显示空状态；模型调用 taskflow_plan 后，聊天内也会展示清单。普通聊天清单和宿主临时 todo 不会自动写入 Taskflow。

独立子会话使用 Qoder 的原生工具，父会话接收 supervise 回调，核对持久结果后确认通知。默认委派深度 2、全树并发 2，等待下级的执行事项可以释放名额。文件、终端和浏览器操作使用 Qoder 自身能力。

新会话接续旧计划需调用 taskflow_attach 并提供旧根会话 ID；若旧计划还有活动事项，先确认实际执行已中断，再在负责会话暂停。不会因 MCP 重启自动暂停或重跑其他会话的工作。

## 数据与权限

账本保存在 QODER_PLUGIN_DATA/projects/<项目路径 SHA256>/taskflow.json；宿主未提供数据目录时回退至 ~/.qoder/taskflow。卸载或清理插件数据前应自行备份。插件不读取模型密钥，不修改宿主数据库、二进制和全局配置。

Hook 注入宿主提供的真实会话身份、项目路径及已有计划提示。模型工具调用必须传入这些身份；缺项目路径时拒绝操作。面板仅按宿主会话元数据精确查找计划，项目身份冲突时拒绝猜测。账本内容和执行摘要会作为工具结果提供给当前 Qoder 会话。

## 兼容范围

已有实机依据为 Qoder Desktop **0.5.14 stable**：技能、Hook、会话面板自动绑定与刷新、单事项原生可见子会话、完成回调及结果通知已验证。正式版构建的自动验证见源码仓库 docs/qoder-adaptation.md。

原生聊天工具必须在当前环境实际发现。多层原生聊天委派、跨设备与真实中断恢复仍需实机验证。面板依赖 MCP Apps；不支持时使用结构化状态。宿主尚未开放固定聊天工具栏按钮和左侧会话缩进配置，本包入口位于 Apps 菜单。详见源码仓库 docs/qoder-host-ui-integration.md。

## 从源码构建

```sh
npm ci --ignore-scripts
npm run check
```

检查会构建并验证 dist/qoder-taskflow-0.1.0.zip 和 dist/qoder-taskflow/，同时生成逐文件哈希、依赖许可证清单与 dist/SHA256SUMS.txt。仅构建运行 npm run build。开发和发布流程见源码仓库 docs/DEVELOPMENT.md、docs/PUBLISHING.md。

本项目采用 Apache-2.0；打包第三方库的许可随包附于 THIRD_PARTY_NOTICES.txt。这是社区插件。
