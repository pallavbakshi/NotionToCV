# Phase 2 PRD — The Agentic Engine (Core Loop Extraction)

> **Objective.** Lift the recursive agent loop out of `ChatDrawer.svelte` into a pure,
> host-agnostic engine that drives tool-calling to completion (model-decided) or a hard
> **30-turn cap**, emitting events and returning a staged-changes transaction — with
> **zero** Svelte or browser dependencies. Validated entirely headlessly with a mock
> model provider; the live web app is **not** rewired in this phase.

## 1. Context & Dependencies

- **Depends on:** Phase 1 (`ResumeState`, `AgentEvent`, `ModelProvider`/`ScreenshotProvider`
  interfaces, the normalized `Delta` shape, isomorphic parser).
- **Source of truth to port:** `ChatDrawer.svelte` `runGeneration()` (lines ~450–643),
  specifically the SSE accumulation (463–539), tool dispatch (579–638), and recursion (641).
- **Already pure (relocate, don't rewrite):** `runAgentTool`, prompts (`agentTools.js`),
  `findNeighbors` (`spatialUtils.js`).

## 2. Goals / Non-Goals

**Goals**
- Implement `ResumeAgentEngine.optimizeResume` as an async generator (the loop).
- Add the **30-turn hard cap** (does not exist today).
- Relocate tools, spatial helpers, and prompts into `src/sdk/`; swap the screenshot
  `fetch` for the injected `screenshotProvider`.
- Emit `AgentEvent`s; accumulate staged changes internally and return them as a
  transaction (no `stagedChanges.set`).
- Prove correctness with a scripted mock `modelProvider` (no network, no browser).

**Non-Goals (owned by later phases)**
- Wiring `ChatDrawer` to the engine → Phase 4.
- Node providers / CLI → Phase 3.
- Persistence (`saveChats`), UI message rendering → stays in the host (Phase 4).

## 3. Functional Requirements

**FR2.1 — The loop.** `optimizeResume(state, instruction, { signal })` runs:
model call (via `modelProvider`) → accumulate streamed `content` + `tool_calls` →
for each tool call, dispatch through `runAgentTool` → append tool results to the
internal message history → recurse. The engine **owns** the LLM message history; the
host does not manage it.

**FR2.2 — Termination.** The loop ends when the model returns a turn with **no** tool
calls (`reason: 'model_complete'`). A counter caps tool-call turns at `maxTurns`
(default 30); on reaching it the loop stops and emits `done` with `reason: 'max_turns'`,
returning whatever is staged so far.

**FR2.3 — Event emission.** The generator yields, in order: `text` deltas as they stream,
a `tool_call` event when a call is dispatched, a `tool_result` when it returns, a
`staged_change` whenever `runAgentTool` proposes content, and a terminal `done`
(or `error`). This is the stream a UI host renders live.

**FR2.4 — Staged transaction.** Staged changes accumulate inside the engine (the merge
`runAgentTool` currently returns via `stagedChangesUpdate`). The final `done` event
carries `transaction = { stagedChanges }`. **No Svelte store is referenced.**

**FR2.5 — Tool relocation + provider injection.** Move `agentTools.js` → `src/sdk/tools.js`,
`spatialUtils.js` → `src/sdk/spatial.js`, prompts → `src/sdk/prompts.js`. The
`get_block_screenshot` branch calls `ctx.screenshotProvider(payload)` instead of
`fetch('/api/screenshot')`. Layout imports (`computeLayout`, `blockRectMm`, `colWidthMm`,
`effectiveBaseStyle`, `initFonts`) stay pointed at `src/lib/layout/` unchanged.

**FR2.6 — Abort.** `optimizeResume` accepts an `AbortSignal`; the loop checks it between
turns and before each model call, terminating with `reason: 'aborted'`.

**FR2.7 — Mode parameter.** The engine supports both the tools-enabled "agent" path and
the read-only "coach" path (today's `getSystemPromptOutline`, no tools). A `mode` /
`tools` flag selects prompt + whether tools are passed to the provider. The coach path
emits only `text` and `done`.

**FR2.8 — Host-built initial messages.** The engine receives an already-normalized
initial message array. Host-specific attachment serialization (block chips, screenshots,
denied-change notices — `ChatDrawer.svelte:391–446`) **stays in the host** and is not
the engine's concern; the engine only sees normalized `messages`.

**FR2.9 — Public `validateBlockLayout`.** Implement the Phase-1 interface method:
`validateBlockLayout(block, rect, layoutCtx)` wraps the same `computeLayout`/`blockRectMm`
path `runAgentTool` uses internally and returns the capacity object. The
`update_block_content` tool and this public method share one implementation (no duplicate
capacity logic) so CLI/pipeline gating and in-loop checks always agree.

## 4. Technical Design

- **New/moved files:**
  ```
  src/sdk/
    engine.js     # ResumeAgentEngine.optimizeResume — the async-generator loop
    tools.js      # AGENT_TOOLS + runAgentTool (screenshot via provider)
    spatial.js    # findNeighbors (ex-spatialUtils.js)
    prompts.js    # getAgentSystemPrompt / getSystemPromptOutline
  ```
- **Loop mechanics** mirror the proven recursion but invert control: where
  `runGeneration` *wrote into `chatList`*, the engine *yields events*; where it called
  `stagedChanges.set`, the engine *accumulates and returns*.
- **`modelProvider` contract** (from Phase 1) returns an async iterable of `Delta`s;
  the engine's accumulation logic is the existing 523–533 tool-call assembly, lifted
  verbatim against the normalized shape.
- **Turn counter** wraps the recursion (or converts it to an explicit `while (turn < maxTurns)` loop — preferred, since unbounded recursion is what we're fixing).
- **Determinism:** a mock `modelProvider` yields scripted deltas, enabling exact
  assertions without network or model variance.

## 5. Deliverables

- `src/sdk/engine.js`, `src/sdk/tools.js`, `src/sdk/spatial.js`, `src/sdk/prompts.js`
- `scripts/test-sdk-phase2.cjs` — mock-provider harness covering: a normal
  read→update→stop run; the 30-turn cap (script a provider that never stops); abort
  mid-loop; and a `staged_change` → final `transaction` assertion.

## 6. Definition of Done

- [ ] `grep -rl "svelte\|/api/\|stagingStore\|window\." src/sdk/` returns nothing (except the Phase-1 parser's guarded `window` check).
- [ ] Mock run produces the expected ordered event sequence and an exact staged transaction.
- [ ] 30-turn cap test: a never-stopping provider halts at exactly 30 turns with `reason: 'max_turns'`.
- [ ] Abort test: signalling mid-loop yields `reason: 'aborted'` and stops further model calls.
- [ ] Coach mode produces text + done with no tool calls.
- [ ] The live web app still runs on the old `runGeneration` (engine is built but unwired) with no behavior change.

## 7. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| History/payload drift from what `/api/chat` expects | Keep the message/tool payload byte-identical to current `requestPayload`; snapshot-test it |
| Converting recursion → loop introduces an off-by-one in the cap | Explicit test asserting exactly 30 turns, plus a 1-turn and 0-turn edge test |
| Hidden coupling discovered during extraction (e.g., something reads `chatList` mid-tool) | The earlier guardian-style diff review before merge; mock harness forces the seams open |
