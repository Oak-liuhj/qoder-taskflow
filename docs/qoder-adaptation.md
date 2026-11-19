# Qoder 验证记录

更新日期：2026-11-19。当前正式版源码与包版本：0.1.0。

## 正式版整理

源码、依赖、构建、CI、用户说明与发布流程仅面向 Qoder。保留 MCP、Hook、面板、技能与领域账本，移除其他宿主入口、界面、调试服务、依赖与投稿资料。版本从插件 manifest 注入运行时。构建包自包含，附带第三方许可和哈希清单。

本版自动验证结果与包哈希见 dist/qoder-release-validation.json、dist/qoder-package-report.json 和 dist/SHA256SUMS.txt。包验证覆盖独立解压运行、MCP 握手、18 项工具发现、资源读取、Hook、项目隔离、并发写入、归属与旧结果拒绝，以及面板握手和刷新。领域回归覆盖计划、依赖、版本、取消、存储与排序。

本轮 npm ci 从精简锁文件安装成功，npm run check 的 38 项测试及正式版检查全部通过，git diff --check 通过。解压包实际 MCP 握手返回 0.1.0。旧构建产物移至本地忽略目录，dist/ 仅保留当前正式版和对应校验文件。未重新安装当前正式版到用户的 Qoder 环境。

## 已有 Qoder 实机依据

下列观察来自 2026-11-18 至 2026-11-19 的 Qoder Desktop 0.5.14 stable，先于本轮正式版整理；不能视为新 ZIP 的重新安装验收。

- 插件校验通过后，Windows 导入阶段出现临时目录重命名 EPERM。此前经用户授权手动安装成功，并核对安装文件哈希。此历史处理不代表正常 ZIP 导入问题已由插件解决。
- 技能可发现，真实模型收到 Hook 注入的宿主 sessionId 和项目路径；桌面共享 MCP 不能使用启动 cwd 代替当前项目。
- 右侧 Apps 菜单实际显示“任务”。已有会话显示正确计划，新会话显示空状态；真实模型规划后，已打开面板自动出现清单，聊天也内联显示。
- 主题通知可能省略 theme；面板保留最近主题，并通过部分上下文更新回归。
- 独立单事项验收中，父会话通过原生 create_chat_session(callbackMode:supervise) 创建左侧可见子聊天。子会话自身 claim → progress → complete，真实会话 ID 与账本一致，宿主完成回调送达，父会话读取后确认通知，面板显示 1/1 完成。
- 宿主保存 delegationParent 父子关系，但该构建左侧列表没有可视缩进；固定聊天工具栏按钮也未发现可用插件接口。

## 正式版实机待验收

纯 Qoder 0.1.0 ZIP 的重新安装/更新、原生多层聊天委派、跨设备执行和真实执行中断恢复仍需实机验证。历史单事项结果不扩展为全部通过。

## 接口依据

- [Qoder Plugins](https://docs.qoder.com/qoder/plugins)
- [Plugin Reference](https://docs.qoder.com/cli/plugins-reference)
- [CLI Plugins](https://docs.qoder.com/cli/plugins)
- [Hooks](https://docs.qoder.com/cli/hooks)
- [Subagent](https://docs.qoder.com/cli/subagent)

面板会话元数据 com.qoder/turnContext.sessionId 为 Qoder 0.5.14 的实测兼容接口，不能视为所有版本的永久承诺。缺身份或项目歧义时拒绝猜测。更多界面限制见 qoder-host-ui-integration.md。
