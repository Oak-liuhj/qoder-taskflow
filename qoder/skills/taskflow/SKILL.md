---
name: taskflow
description: 将复杂目标组织为独立于对话轮次的持久任务树，按依赖执行、按需委派子任务，并保存实际结果。用于多步骤开发、项目推进、恢复既有任务及通过对话调整计划；简单问答无需建立任务树。
---

# Taskflow

通过 taskflow MCP 工具维护权威任务树。先读取 taskflow_status，沿用原 ID 和完成结果，不能用聊天清单或原生临时 todo 覆盖账本。只有用户要求新计划，或当前会话没有计划时才 taskflow_plan。

## 会话与归属

每次调用传入 Hook 注入的真实 sessionId 和当前项目绝对路径 projectPath。桌面端的 MCP 进程由多个项目共享，不能用进程启动目录判断项目；不要漏传 projectPath。独立聊天子会话使用自己的 session_id；历史内嵌 Agent 使用 agent_id，两者不能混为一谈。如果宿主未提供身份或路径，不要编造，先确认当前会话身份与项目。
新会话要继续旧计划时，使用 taskflow_attach，明确旧 planSessionId；这会接续计划而不会重跑任务。默认 taskflow_add 挂在当前聚焦/执行事项下；用 taskflow_focus 改变焦点。根级新增先 taskflow_add 的 parentId 为 null，并在 tasks 中给各项显式 parentId:null。重名或未知父任务应要求用户明确 ID。

parentId 仅表示组成关系；前后阶段通常是同级任务，用 dependsOn 排序。每项保存具体要求、完成标准、复杂度、独立性和 inline/delegate 方式。中高复杂度且可独立交付的事项优先委派。

## 按需执行

用户只要求规划时保存后停止；否则规划后继续实际执行。

1. 执行到某项才 taskflow_start，不提前建立全部执行会话。返回 attempt.id、version 绑定本轮执行。
2. inline 项由当前会话执行，以 taskflow_progress 保存目标、实际操作、发现/验证、下一步或阻塞。记录存在账本和任务面板中，不冒充宿主只读子会话。
3. delegate 项必须创建左侧可见的独立聊天子会话。先发现并读取原生 create_chat_session 的实际 schema（可能名为 mcp__builtin__create_chat_session）；按工具说明选择同一项目的真实 workspace，用自包含 prompt 将完整 dispatch 和 workerInstructions 交给它，设置 callbackMode:supervise；创建即启动。必要时用 list_workspaces 发现项目，不猜 ID。当前默认工作区按宿主说明省略 workspaceId 即继承；不要设置 systemPrompt 覆盖默认规则。保留创建返回的真实子会话 ID。不要调用 Agent、general-purpose 或 taskflow-worker 替代可见会话，create_team_task 是需要已启用团队 squadId 的另一条路线，单事项不必使用。子会话使用自身 Hook session_id 调用 taskflow_claim，成功后才能执行；父会话不能代为 claim/complete。并发已满则等待后重试。宿主工具缺失或创建失败时明确报告并由父会话 pause 留证，重新 start 获取新 attempt 后才重试；禁止静默退回内嵌 Agent。
4. 中高复杂度项开始工作前 taskflow_assess 判断要不要拆解；需要时 taskflow_add 保存下级。若当前 Qoder 环境不允许子 Agent 再委派，明确说明并使用本层 inline 子项，保留 parentId；不要编造孙会话。
5. 等待下级时 taskflow_wait 释放全树并发名额；收到下级结果后 taskflow_resume 重新获取名额。没有名额时不得开始剩余工作。
6. 用 taskflow_complete 提交真实 completed/blocked/failed 结果及证据/产物路径，必须使用 start/claim 对应的 attemptId、version。旧版本结果被拒绝后停止，重新读取状态，不得完成新尝试。

只把最终摘要、证据和产物位置返回直接父 Agent。先通过 complete 持久化结果，再返回最终回复。无需主会话复核，受阻或失败不能报完成。父项必须等待所有下级结束，再完成本层剩余工作。

## 恢复与界面

进程重启不自动重跑事项。真实执行已经中断时，对该项 taskflow_pause，再 start；旧 attempt 随即失效，历史保留。不要暂停其他仍在工作的 Agent。

taskflow_plan 成功后会直接返回可展示的 MCP Apps 任务清单，不需要再调用工具选择项目或计划。会话右侧“任务”入口自动绑定当前会话，已打开的面板会自动刷新。按需用 taskflow_panel 再次展示清单，仍传入 Hook 身份和项目路径；不支持 MCP Apps 时使用 status 的 JSON/文本。不要仅在聊天里写计划或只更新宿主临时 todo，任务清单以 Taskflow 账本为准。面板展示实际层级、状态、要求、执行记录和结果。文件、终端、浏览器预览沿用 Qoder 原生工具；本包没有 DSH 插槽和固定侧栏控制能力。

创建成功不代表执行完成。父会话优先使用 supervise 回调接收完成、权限与提问事件，保留返回的 sessionId/sessionRef。疑似回调遗漏时用 wait_chat_sessions(timeoutMs:0) 只读检查，需要时用 read_chat_session 读取结果，用 send_message_to_chat_session 发送后续指令。不要持续轮询 supervise 会话。创建结果不确定时先查已有会话，不要重复创建。不得把 Taskflow 的 taskflow_wait 当成等待宿主会话结果的工具；它只释放账本并发名额。子会话先 complete 落盘，再返回。父会话读取 taskflow_status/taskflow_notifications 核对真实 executionSessionId 和最终状态，阅读后显式 ack 通知，不确认未读通知。插件不直接唤醒宿主，不代表宿主没有原生会话工具或通知能力；capabilities.plugin 仅描述插件自身集成，host 工具须在当前环境发现。
