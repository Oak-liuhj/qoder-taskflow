---
description: 规划、执行或恢复持久任务树
argument-hint: 目标、任务 ID 或计划调整要求
---

使用本插件 taskflow 技能处理用户要求：$ARGUMENTS

先 taskflow_status 读取当前会话的持久任务；保留任务 ID、历史和已完成结果。无计划时按复杂度规划，有计划时增量调整并继续执行。使用 Hook 注入的真实会话身份。用户仅要求规划时不要启动。需要查看时调用 taskflow_panel。
