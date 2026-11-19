# dsh-market 收录申请

## 投稿位置

- 市场应用：[dsh-market/dsh-market](https://github.com/dsh-market/dsh-market)。其 [Submit your plugin](https://github.com/dsh-market/dsh-market#submit-your-plugin) 说明目录来自 awesome-dsh-plugin，要求向目录仓库投稿。
- 目录仓库：[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)。遵循其 [contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)。
- 唯一投稿文件：`data/plugins/Oak-liuhj__dsh-taskflow.yml`，内容取自本目录的同名文件。分类为 `workflow`，不修改其他条目及生成的 README。

## 状态（2026-11-18）

- npm：[`dsh-taskflow@0.1.4`](https://www.npmjs.com/package/dsh-taskflow/v/0.1.4) 已发布，`latest` 指向 0.1.4，独立生产安装和运行检查通过。
- 已发布代码：[`6174061`](https://github.com/Oak-liuhj/dsh-taskflow/commit/61740612507aee65656dc016f0e9ed470d5cfa92)，标签 [`v0.1.4`](https://github.com/Oak-liuhj/dsh-taskflow/tree/v0.1.4)。[Windows / Ubuntu CI](https://github.com/Oak-liuhj/dsh-taskflow/actions/runs/44236327493) 通过。
- 本次发布子任务执行记录默认展开、模型/工具分类展示、旧日志兼容及真实步骤编号修复；npm 0.1.4 与标签 v0.1.4 对应，未覆盖旧版本。
- 目录 PR：[#16424 — Add Oak-liuhj/dsh-taskflow](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16424)，已提交并更新至 0.1.4 发布信息与可读子任务执行记录描述，等待维护者审核。仅新增自己的 YAML；合并、目录刷新、实际搜索和安装入口需分别确认，当前不宣称市场已收录。
- 市场准备提交：[`773f45d`](https://github.com/Oak-liuhj/dsh-taskflow/commit/773f45d0cc4db9aaf8b03881ea75c62f63937bf5)。修正历史截图的实际 PNG 编码并补充格式校验；图标与 5 张声明截图均通过 GitHub 下载和本地字节核对。
- 投稿前校验：目录仓库原生 `check-submission.mjs` 检查 1 条并通过，`validateEntries` 在包含新条目的 11,745 条目录上通过。本项目 `npm run check` 通过 71 项测试及 12 项版本边界；PR 的远端校验以 GitHub 检查页为准。

## 规范核对

| 要求 | 项目对应 |
| --- | --- |
| 真实、公开且创建满一天的仓库 | 仓库创建于 2026-11-13，有分层源码、构建产物与测试。 |
| `dsh-plugin` topic | GitHub 仓库已设置。 |
| 可安装的 `dsh.bundle` | package.json 声明 `./cordis.patch.yml`，插件 ID 为 `taskflow`。 |
| 功能描述准确、非营销描述 | 一句话说明模型规划、持久任务树、执行时建子会话、递归委派及直接父通知。 |
| 仅新增自己的 YAML | 使用规范文件名、合法的 `workflow` 分类和中英文描述；不写 `npm:` 自定义字段。 |
| GitHub 托管位图 | `assets/icon.png` 为 180×180 PNG。 |
| 截图在作者仓库声明 | 根目录 `screenshots.json` 引用 5 张仓库内 PNG，扩展名与实际编码一致；是标记为开发验收环境的历史 alpha 截图，不宣称为 0.1.4 原生宿主截图。 |
| npm 与代码仓库关联 | 已发布包的 `repository.url` 为 `git+https://github.com/Oak-liuhj/dsh-taskflow.git`，由市场自动关联。 |
| 宿主兼容性可检查 | `engines.dsh` 与 DSH peer 范围一致；精确验证 0.2.1-rc.3、0.2.2-rc.2 和 0.2.2-rc.3，未声称覆盖所有未来版本。 |

## PR 正文

Title: `Add Oak-liuhj/dsh-taskflow`

Adds one `workflow` entry for [dsh-taskflow](https://github.com/Oak-liuhj/dsh-taskflow), published as [dsh-taskflow@0.1.4](https://www.npmjs.com/package/dsh-taskflow/v/0.1.4).

The plugin keeps a model-planned task tree in a persistent ledger independently of the host's `todo_write` projection. Planning alone does not create every child session: sessions are created when their tasks start. Tasks can delegate recursively within configured depth and concurrency limits. Child progress stays in its task session, with expanded readable records for public model output, tool inputs/results and stage findings; the final result notifies the direct parent without a separate parent review gate. Conversation updates edit the existing tree across turns.

Reviewer entry points: `src/storage/task-store.mjs`, `src/domain/task-service.mjs`, `src/application/task-runtime.mjs`, `src/server/planning-check.mjs` and `src/server/inline-sessions.mjs`.

The repository declares `dsh.bundle.patch`, has the `dsh-plugin` topic, and was created on 2026-11-13. The npm package's `repository` points to this exact repository. The icon is a GitHub-hosted PNG; author-owned `screenshots.json` declares historical alpha development-shell screenshots, explicitly labelled in the README. These are not full-host screenshots of 0.1.4.

Validation: 71 source tests, 12 host version boundary checks, isolated production tarball installation and deterministic real AgentLoop integration. Exact-host checks cover 0.2.1-rc.3, 0.2.2-rc.2 and 0.2.2-rc.3, each with 20 server integration tests and 4 actual-client/SlotCore tests; Windows and Ubuntu release CI passed. Registry download matches the tested tarball (SHA-256 `e13e319c9b8dbff6e236482f5fa275e79ca823e5ba24da588c2a74db91d6e1f4`). Full production-model behavior and native desktop visual acceptance are not claimed; scope is recorded in `docs/acceptance.md`.

Only `data/plugins/Oak-liuhj__dsh-taskflow.yml` is added. No other entries or generated READMEs are changed. No manual npm mapping field is added.

## 合并后核验

维护者合并后，再检查目录构建、索引刷新以及市场中的搜索结果是否指向正确仓库与 npm 包。目录可能延迟刷新；npm 已发布不等于目录已收录，PR 已创建也不等于已合并。
