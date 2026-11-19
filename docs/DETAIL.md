# Taskflow

A DeepSeek Harness plugin (0.1.3) for persistent task trees, selective nested
sessions and direct-parent completion notifications.

## Requirements

DSH **>=0.2.1-rc.3 <1.0.0-0**, Node.js **>=24.9.0**, and enabled host services for tools,
agents, sessions, systemPrompt and subagents, with a `spawn` provider.
The client requires the conversation, workspace and right-sidebar services.
Full `engines.dsh` declaration: `>=0.2.1-rc.3 <1.0.0-0 || >=0.2.2-0 <1.0.0-0 || >=0.2.3-0 <1.0.0-0 || >=0.3.0-0 <1.0.0-0`.
The declared range is separate from the versions exercised in the acceptance record.

## Workflow

Describe a goal in the main session. The model creates a task plan independently
of `todo_write`. Simple tasks stay in their owner session; independent complex
tasks can spawn a child session and, within configured limits, grandchildren.
A valid completion immediately checks the task and notifies only its direct
parent. No review or parent approval step is added.

Later messages update the same ledger rather than replacing it. Additions attach
to the current task unless the main session explicitly names a parent ID or
unique full title. Editing requirements increments the version; stale execution
results are rejected. Adding children to a completed task reopens its ancestors
and retains the old report.

The right panel displays the hierarchy. Use the detail menu to add or edit a task;
these actions prefill the conversation and take effect after sending. Cancellation
and sibling reordering are direct interface actions. Start/Continue submits a real follow-up to the durable main agent without overwriting your draft. It reports acceptance/errors; external blockers remain explicit. Actual child sessions, grandchildren and retry history appear below the main session in the left navigation, using direct-parent addresses. Tool views support horizontal resizing, floating, dragging, and docking, with per-session local layout preferences.

## Data and tools

The session list uses the prototype's chat and expand icons, state dots and
hierarchy guides. Planning does not create child sessions: inline records appear
on start and delegated sessions on scheduler admission. Existing unstarted records
are preserved but hidden. Nested records attach to their task parent. Every medium/high
task requires a model decision to split or execute directly, recursively at each level.

Above the composer, the current model generates 3–5 quick replies from recent
conversation and task state using an extra short request. Unchanged context is
cached; busy sessions wait and failures offer specific diagnoses and retry. Requests allow
4096 tokens including reasoning and a 60-second timeout. Clicking appends to the draft
without sending or removing references. Set quickReplies=false to disable.

The ledger defaults to `${DSH_HOME}/taskflow` or `~/.dsh/taskflow`. One active writer
is allowed per directory. Back up the directory while the host is stopped, and
also back up native DSH sessions for a complete migration. Interrupted work pauses
on recovery; it is not automatically rerun.

Tools remain host-owned. Taskflow displays actual URLs or text to the left of the
conversation on demand. Markdown, Excel, Word, PowerPoint and PDF files automatically
open through host document preview plugins inside the tool panel, without choosing
a file or viewer. Taskflow does not read document content directly; the host owns
file access, rendering and authorization. Browser results open through the host Browser plugin.
This does not imply shared authentication or live state with external automation
browsers. Files require explicit successful output paths; terminal scripts without
structured paths should use taskflow_open_view with the actual filePath.
Missing plugins offer visible feedback and retry; file load errors appear in the host viewer.

The Tasks entry toggles the checklist. Task progress and key results are saved through
taskflow_progress in the current child session, including records for inline work.
Only the final completion summary is notified to the parent after durable result storage.

Running tasks show an animated progress icon and “进行中” in both the checklist
and child-session list. Waiting, blocked, paused and completed tasks stop rotating.
State polls every 1.2 seconds. Other plugins may register dedicated renderers.

The tool view keeps a compact header and fills its remaining height with document previews, without visible paths, reopen controls or success notices. Multiple documents scroll vertically; failures retain a retry action. The docked checklist starts at 300px; drag its left edge to resize, and the preference is remembered. Narrow windows temporarily constrain the width. Fullscreen, floating tabs and other plugin pages retain the host layout. Suggested replies show a small spinner and a left-aligned loading label while waiting for the current response or generating suggestions, until ready or failed. Waiting does not start another model call.

## Validation status

Core, client and real DSH AgentLoop integration are tested using a deterministic
model adapter. Screenshots are from the labelled local acceptance shell. Full
profile installation, production model planning and third-party tool integration
still require acceptance. See the repository's acceptance record for details.

Original code: Apache-2.0. Imported UI portions: MIT; see NOTICE and licenses/.
