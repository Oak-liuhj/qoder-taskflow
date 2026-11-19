# qoder-taskflow

This repository contains the Qoder adaptation of Taskflow. Start with the [Qoder installation and usage guide](qoder/README.md), [adaptation and acceptance notes](docs/qoder-adaptation.md), and [native UI integration limits](docs/qoder-host-ui-integration.md). Run `npm run build:qoder` to generate the Qoder plugin ZIP.

The shared domain core and DSH build tools are retained from the upstream `codex/qoder-marketplace` working snapshot; see [SOURCE_IMPORT.md](SOURCE_IMPORT.md). The upstream DSH documentation follows. Refer to the Qoder guide for supported Qoder features.

## Upstream dsh-taskflow

This branch includes a separate [Qoder adaptation candidate](qoder/README.md), packaged as a `qoder-taskflow` ZIP. See the [adaptation notes](docs/qoder-adaptation.md) for supported features and validation limits.

[简体中文](https://github.com/Oak-liuhj/dsh-taskflow/blob/main/README.md) · [English](https://github.com/Oak-liuhj/dsh-taskflow/blob/main/README_en.md)

[![npm version](https://img.shields.io/npm/v/dsh-taskflow)](https://www.npmjs.com/package/dsh-taskflow)
[![GitHub stars](https://img.shields.io/github/stars/Oak-liuhj/dsh-taskflow?style=social)](https://github.com/Oak-liuhj/dsh-taskflow)

**A [DeepSeek Harness](https://www.deepseek.com/harness/) plugin for persistent task planning and nested session orchestration.**

[`dsh-taskflow`](https://www.npmjs.com/package/dsh-taskflow) turns a goal in the main conversation into a lasting task tree, showing what needs doing, which session owns each task, and what has finished.

- **Persistent checklist** — The model plans tasks according to request complexity. A separate ledger preserves the plan across conversation turns, page refreshes and host restarts.
- **Selective nested delegation** — Simple tasks stay in their owner session. Independent complex tasks can spawn children, which may delegate further within depth and concurrency limits.
- **Completion notifications** — Valid child results check off the task and notify its direct parent, without adding a parent review step.
- **Incremental conversation updates** — Add work beneath the current task or explicitly name a parent in the main conversation; edit requirements, cancel work and reorder siblings.
- **Hierarchical task navigation** — Inspect the task tree, progress, status and details in the right sidebar, then jump to the execution session.
- **On-demand tool views** — Actual host tool calls can show a page or output to the left of the conversation. The tool area starts closed.

Markdown, Excel, Word, PowerPoint and PDF outputs automatically open through the
host's document preview plugins inside the tool view. Multiple files open without
a file or viewer selector. Taskflow does not read document content directly; the
host preview owns file access, rendering and authorization. Enable the host document
preview plugin to use this feature. Missing plugins offer a retry action. Automatic
opening is limited to the foreground task session and does not repeat on polling.
Terminal-generated files without structured output paths require
`taskflow_open_view` with the actual `filePath` or `files`.

Previews follow tool-panel resizing, floating and scrolling. Closing the tool view
releases its own previews and preserves documents opened by the user. The header's
Tasks button toggles the checklist; another active sidebar page switches to Tasks.
Version **0.1.4** expands Taskflow execution records by default, including existing saved records. Inline records distinguish model calls, public model output, tool inputs and results. Available source metadata supplies the model, tool, duration and failure status. Stage reports describe the goal, actual operations, key findings or validation, and next step or blocker, with Markdown tables and code when helpful. Historical records remain intact and missing history is never fabricated.

Execution progress and key findings stay in the current task's child session via
`taskflow_progress`. Inline work writes to its record session; delegated work writes
to its execution session. Final results are saved before notifying the direct parent.

The tool view keeps a compact header and fills its remaining height with document previews, without visible paths, reopen controls or success notices. Multiple documents scroll vertically; failures retain a retry action. The docked checklist starts at 300px; drag its left edge to resize, and the preference is remembered. Narrow windows temporarily constrain the width. Fullscreen, floating tabs and other plugin pages retain the host layout. Suggested replies show a small spinner and a left-aligned loading label while waiting for the current response or generating suggestions, until ready or failed. Waiting does not start another model call.

![Task navigation and conversation](https://raw.githubusercontent.com/Oak-liuhj/dsh-taskflow/main/docs/screenshots/desktop.png)

*Historical development-shell screenshots (0.1.0-alpha.1), using a deterministic model to illustrate the layout. These are not full-host screenshots of the current version. See the guide and [acceptance record](docs/acceptance.md) for the current behavior and validation scope.*

## Install / Update

### In DeepSeek Harness Web or Desktop

Open **Plugins** → **Add plugin** and search for `dsh-taskflow`. If a result points to `Oak-liuhj/dsh-taskflow`, install that entry. If it is not listed, use the CLI below to install by npm package name.

Reload the profile when the host requests it. The plugin uses the host's model, tools and `spawn` subagent provider. Desktop installations need the same Web renderer services.

### Discover through dsh-market

[dsh-market](https://github.com/dsh-market/dsh-market) consumes the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog. Submission, maintainer merge and market refresh are separate stages; a pull request does not establish searchability. The [submission record](marketplace/SUBMISSION.md) tracks that status.

After catalog inclusion and refresh, search for `dsh-taskflow` under **Plugins → Plugin Market**. Confirm the repository is `Oak-liuhj/dsh-taskflow`, the npm package is `dsh-taskflow`, and the host requirement is compatible. For the host's **Discover → Index sources**, the market provides `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`. The published npm package remains directly installable before the catalog refreshes.

On official Desktop, prefer the app's plugin manager. CLI installation must target the profile actually used by that app; installing into `web` does not install into Desktop.

### Using the `dsh` CLI

```sh
dsh plugin --profile web add dsh-taskflow@latest
```

To pin the current version:

```sh
dsh plugin --profile web add dsh-taskflow@0.1.4
```

Replace `web` with your profile name. For an npm-based installation, you can also recheck versions in the plugin details, choose a compatible update and follow the host's reload or restart instructions.

## Usage

Describe your goal in the main conversation. The model plans requests that need several steps, tool operations or independent execution; short questions do not need a plan.

With automatic planning enabled, the model assesses whether a checklist is needed and saves it before executing work. If an answer or document is returned without a saved plan, the plugin sends at most two reminders. Planning stops after four unsuccessful steps and the panel shows the reason. Missing information can be clarified first; short questions may explicitly skip planning. Existing plans are updated incrementally.

| Entry point | What you can do |
| --- | --- |
| **Task navigation** | Inspect progress and status; switch between the global plan and current session, filter, collapse and navigate tasks. |
| **Main conversation** | Create a plan, adjust the overall requirements or identify the parent task for new work. |
| **Child conversation** | Complete assigned work, create subtasks when needed and report to the direct parent. |
| **Task details** | Read requirements, completion criteria and results; add, edit, resume, cancel and reorder tasks. |
| **Tool area to the left** | Show actual tool pages or output when needed. Close it or switch between tools and chat on narrow screens. |

## ✅ Task navigation — one checklist across turns

Click **Checklist icon + 任务 (Tasks)** in the session header to open the **待办任务清单 (To-do checklist)** panel on the right. Tasks appear directly in their parent-child hierarchy, without extra planning or review categories.

| Item | What it tells you |
| --- | --- |
| **Progress** | How much of the plan is complete. |
| **Global plan / Current session** | The whole tree or the part owned by the current session. |
| **Task status** | Pending, running, completed, paused, failed or cancelled work. |
| **Stable task ID** | A precise reference to the same task in later messages. |
| **Execution session** | Whether work stays in the owner session or runs in a child. |
| **Details and activity** | Requirements, completion criteria, results and change history. |

Click a task title to focus it or open its execution session. Collapse branches and filter longer plans.

## 🧩 Child sessions — delegate according to complexity

For example, ask the main conversation:

```text
Build a knowledge-base import module. Plan the work first and delegate independent complex parts to child sessions.
```

The model considers complexity and independence. Simple tasks or work requiring shared context stay in the owner session; suitable complex work can spawn a child. Children may split their work again, with inline execution used at the depth limit.

High-complexity independent work (`high` + `independent: true`) automatically delegates, subject to depth limits. Planning only creates the checklist. Inline records appear when their task starts; delegated execution sessions appear when admitted by the scheduler. Unstarted tasks do not create sidebar sessions. Existing prematurely created records are preserved but hidden until execution. Nested inline items attach to their parent task's record. Every running medium/high-complexity item, including child items, requires a model decision to split or execute directly; decisions persist per task version. Completed results and original attempt history are preserved.
