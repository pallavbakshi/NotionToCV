# Phase 4 PRD — Web Client Re-integration

> **Objective.** Rewire `ChatDrawer.svelte` to consume the SDK engine instead of its own
> in-component loop, injecting the browser providers, with **zero user-visible
> regression**. Delete the now-duplicated loop so there is a single source of truth.

## 1. Context & Dependencies

- **Depends on:** Phase 2 (engine) and Phase 1 (browser providers). Phase 3 is not
  strictly required but, by exercising the engine for real, substantially de-risks this.
- **Replaces:** `ChatDrawer.svelte` `runGeneration()` (lines ~450–643).

## 2. Goals / Non-Goals

**Goals**
- `ChatDrawer` calls `engine.optimizeResume(...)` and consumes the `AgentEvent` stream to
  update `chatList` live.
- Inject the browser `modelProvider` (`/api/chat`) and `screenshotProvider`
  (`/api/screenshot`) from Phase 1.
- Apply `staged_change` events / the final transaction to the `stagedChanges` store.
- Remove the old in-component loop body.
- Preserve **every** existing behavior (see FR list).

**Non-Goals**
- Server queue / background dispatch → Phase 5.
- Any new product feature — this phase is a behavior-preserving swap.

## 3. Functional Requirements

**FR4.1 — Event → UI mapping.** Translate engine events to the existing `chatList`
message shapes:
- `text` delta → append to the streaming assistant message (today's 515–520).
- `tool_call` → the "⚙️ Tool use…" status message (today's 584–599).
- `tool_result` → the tool-result message + "Executed tool" status flip (today's 619–630).
- `staged_change` → `stagedChanges.set(...)` (today's 605–607).
- `done` / `error` → finalize, run `saveChats()`, clear `isGenerating`.

**FR4.2 — Host keeps building attachments.** The attachment serialization (block chips,
polished-CV screenshots, denied-change notices, text/image files — `ChatDrawer.svelte:391–446`)
remains in the host and produces the normalized initial `messages` handed to the engine.

**FR4.3 — Both modes through the engine.** Agent mode (tools on) and read-only coach mode
(`getSystemPromptOutline`, no tools) both route through `optimizeResume` via the Phase-2
`mode` flag. No separate code path survives in the component.

**FR4.4 — Preserved behaviors.** Streaming text render; tool-call status messages;
staged red/green inline diffs and accept/deny; **stop/abort** (the component's
`abortController` becomes the `AbortSignal` passed to `optimizeResume`); `saveChats`
persistence; chat history list; error-message rendering (today's 647–676); attachments.

**FR4.5 — 30-turn cap live.** The production agent path now inherits the 30-turn ceiling
from the engine; a run that hits it ends cleanly with a user-visible completion (not a hang).

**FR4.6 — Loop deleted.** The body of `runGeneration` is removed; the component retains
only the thin glue (build messages → iterate events → mutate `chatList`/store → persist).

## 4. Technical Design

- `ChatDrawer.svelte` imports `ResumeAgentEngine` and the browser providers; constructs
  the engine once (or per-send) with `{ modelProvider, screenshotProvider }`.
- The recursive `runGeneration` becomes a `for await (const ev of engine.optimizeResume(...))`
  loop with a `switch (ev.type)` mapping to the existing `chatList` mutations.
- `$stagedChanges` continues to be the store the Notion pane reads — only the *writer*
  changes (from inline `stagedChanges.set` inside the loop to the event handler).

## 5. Deliverables

- Rewired `src/lib/ai-chat/ChatDrawer.svelte` (loop removed, engine consumed).
- Any small glue module if the event→message mapping is non-trivial (optional).

## 6. Definition of Done

- [ ] Full manual regression passes: agent edits stage correctly; accept/deny works; screenshots work; coach mode works; history save/restore works; stop button aborts; attachments (blocks, polished CV, files) work; error states render.
- [ ] `ChatDrawer.svelte` no longer contains the model-calling/tool-dispatch loop (only event consumption).
- [ ] No `src/sdk/` module imports Svelte; `ChatDrawer` is the only glue layer.
- [ ] The message/tool payload sent to `/api/chat` is unchanged from pre-refactor (verified by snapshot/network compare).

## 7. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| Subtle streaming/staging behavioral drift | Run old vs new side-by-side on identical inputs; diff the resulting `chatList` message sequence; the guardian-style strict review before merge |
| Abort semantics change (mid-stream vs between-turns) | Explicitly test stop during text streaming and during a tool call |
| Coach mode regressions (no-tools path) | Dedicated manual pass on read-only feedback + attachment-only prompts |
