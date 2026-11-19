# Taskflow for Qoder

[简体中文](README.md) · [Source and issues](https://github.com/Oak-liuhj/qoder-taskflow)

A Qoder plugin for persistent task trees, native chat-session delegation, execution records, and result handoff. Stable version: **0.1.0**. Marketplace submission status is recorded in the source repository's marketplace/SUBMISSION.md.

## Features

- Persistent task IDs, hierarchy, dependencies, requirements, completion criteria, and history.
- Incremental edits, cancellation, ordering, and explicit continuation without rebuilding the plan.
- Independent work delegated through Qoder's native visible chat sessions, with real session identity and attempt binding.
- Durable progress and results; stale attempts and results are rejected.
- A session-bound MCP Apps task panel with automatic refresh and task details.
- Separate project ledgers, atomic commits, and locking across processes.

## Installation and use

Requires **Node.js ≥24.9.0** available as node in PATH. Runtime dependencies are bundled; no npm installation or extra model credentials are needed after importing the plugin.

In Qoder Desktop, open **Extensions → Plugins → Add Plugins → Upload Plugin** and select qoder-taskflow-0.1.0.zip. Reload as requested and check that the taskflow MCP server, skill, and commands are available. Once publicly listed, search for qoder-taskflow and verify the author is Oak-liuhj.

For Qoder products with the plugin CLI, validate and install the extracted directory:

```sh
qoder plugins validate ./dist/qoder-taskflow
qoder plugins install ./dist/qoder-taskflow --scope local
```

Use the CLI name and subcommands provided by your product. In the project chat, ask:

```text
Use Taskflow to implement document import in this project.
Create a persistent task tree and execute it in dependency order.
Delegate independent complex work to native visible chat sessions.
Save actual progress, verification evidence, and results before reporting to the parent.
```

Use /taskflow-status to read the plan. Open **Open sidebar → More tools / + → Apps → 任务** for the current session's panel. Planning also renders the panel inline. Existing plans are updated incrementally. Explicitly ask for planning only to defer execution.

Delegation defaults to depth 2 and two concurrent tasks across the tree. The parent receives native supervise callbacks and acknowledges persisted results. The plugin discovers host tools before using them; it does not replace missing native chat tools with an embedded agent.

## Storage and compatibility

Project ledgers live under QODER_PLUGIN_DATA/projects/<path SHA256>/taskflow.json, with a fallback to ~/.qoder/taskflow. Back up plugin data before removal. Hooks provide real host session identities and project paths. Missing paths and ambiguous project identities are rejected. The plugin does not read model keys or modify host binaries, databases, or global configuration. Tool results expose ledger records to the current Qoder conversation.

Prior real-host verification covers Qoder Desktop **0.5.14 stable**, session panels, Hooks, one native visible child chat, completion callbacks, and durable results. Automated release verification is documented in the source repository's docs/qoder-adaptation.md. Recursive native chats, cross-device execution, and real interrupted-run recovery still need host testing. Fixed chat-header buttons and native sidebar indentation require host APIs. MCP Apps support varies; structured status remains available.

## Development

```sh
npm ci --ignore-scripts
npm run check
```

This builds and checks dist/qoder-taskflow-0.1.0.zip, the unpacked plugin directory, package hashes, and bundled license notices. Use npm run build to build only. See docs/DEVELOPMENT.md and docs/PUBLISHING.md in the source repository.

Community plugin. Apache-2.0 project source; bundled dependency licenses are included in THIRD_PARTY_NOTICES.txt.
