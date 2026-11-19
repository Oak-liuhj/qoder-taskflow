# Qoder Taskflow 架构

Qoder 加载插件 manifest、技能、命令与 Hook。Hook 将真实 sessionId 和 projectPath 加入当前模型上下文。模型调用 taskflow MCP 工具维护持久任务；MCP Apps 通过同一服务读取会话清单。

## 执行链路

1. taskflow_status 读取当前项目、当前会话关联的计划。
2. taskflow_plan 或增量工具建立、调整权威任务树。
3. taskflow_start 启动事项；inline 由当前会话执行，delegate 返回 dispatch。
4. 父会话发现宿主 create_chat_session 的实际 schema，创建原生可见聊天，保留真实回执。
5. 子会话以自身 Hook 身份调用 taskflow_claim，按 attemptId、version 和项目路径认领。
6. progress 保存可观察执行摘要，complete 原子保存结果；父会话通过宿主回调或 wait/read 获取最终回复，并读取、确认账本通知。

## 状态与隔离

项目目录根据规范化绝对路径计算 SHA256。每次 MCP 操作获得项目锁、加载账本、进行领域事务并原子提交；并行调用不会覆盖其他操作。损坏 JSON 保留原文件并返回错误。

任务父子关系表示组成，dependsOn 表示前置依赖。每次启动生成 attempt，要求变更提高 version。取消、暂停与重新启动会使旧尝试失效。完成结果与通知绑定同一任务版本及尝试；默认全树并发 2、委派深度 2。

## 面板

规划结果声明 MCP Apps 资源用于内联展示。右侧 thread 入口从宿主请求元数据 com.qoder/turnContext.sessionId 查找精确计划；无身份显示入口提示、无计划显示空状态、项目歧义返回错误。面板可见时每 3 秒刷新，输入切换使旧响应失效，销毁时停止请求。

Markdown 解析为 React 节点，不执行原始 HTML，不加载远程图片，危险链接被过滤。面板没有任意网络连接域名。

## 构建

esbuild 将 MCP、Hook 和前端分别打包，fflate 生成固定时间戳 ZIP；收集实际打包依赖的许可证。发布检查将 ZIP、解压目录和哈希清单逐文件核对。构建报告不包含用户账本或登录态。
