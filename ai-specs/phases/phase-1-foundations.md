# Phase 1 PRD — Foundations: Contracts & Isomorphic Boundaries

> **Objective.** Establish the data contracts, the SDK's public interface surface, and
> resolve the two browser-coupled boundaries (HTML parsing, host capabilities) so every
> later phase builds on a stable, environment-neutral substrate. **No agent-loop
> extraction and no change to the running app's behavior** happen in this phase — it is
> purely additive scaffolding plus one isomorphic refactor.

## 1. Context & Dependencies

- **Depends on:** nothing. This is the first phase.
- **Operates on:** `src/lib/ai-chat/messageParser.js`, and creates a new `src/sdk/` tree.
- **Does not touch the runtime path:** `ChatDrawer.svelte`'s `runGeneration` is left
  exactly as-is and continues to serve the live app.

## 2. Goals / Non-Goals

**Goals**
- Define the canonical `ResumeState` JSON schema (the serialized canvas).
- Define the SDK's public interface (`ResumeAgentEngine`, `optimizeResume`, the
  `AgentEvent` union) as typed signatures/JSDoc — **interface only, no implementation**.
- Make `messageParser.js` isomorphic (native `DOMParser` in browser, `linkedom` in Node).
- Define the `ModelProvider` and `ScreenshotProvider` interfaces and ship their
  **browser implementations** (thin wrappers over today's `/api/chat` and
  `/api/screenshot` calls).

**Non-Goals (owned by later phases)**
- Extracting/porting the agent loop → Phase 2.
- The 30-turn cap, event emission logic → Phase 2.
- Node providers, CLI → Phase 3.
- Rewiring `ChatDrawer` → Phase 4.

## 3. Functional Requirements

**FR1.1 — `ResumeState` schema.** A single documented source of truth for the resume
state object passed between hosts. Minimum fields, derived from current usage in
`agentTools.js` (`ctx`) and `PolishedToolbar.svelte` (print payload):
- `title: string`
- `paddingMm: number`
- `templateName: string`
- `themeColors: object`
- `pageCount: number`
- `blocks: Block[]`, where `Block = { id, type, name?, content: Node[], canvas: {page,col,row,colSpan,rowSpan}|null, locked?: boolean, source?: 'canvas'|'notion' }`

**FR1.2 — SDK interface skeleton.** `src/sdk/index.js` exports a `ResumeAgentEngine`
class with constructor `({ modelProvider, screenshotProvider, model?, maxTurns = 30 })`
and `optimizeResume(state, instruction, opts?)` typed to return an
`AsyncIterable<AgentEvent>`. It also exposes a public, synchronous
`validateBlockLayout(block, rect, layoutCtx)` (adopted from the source PRD §3) that runs
`computeLayout` and returns the capacity shape (`max_lines`, `current_lines_used`,
`lines_remaining`, `is_overflowing`) — the standalone primitive that `--strict-capacity`
(Phase 3) and the JD pipeline (Phase 6) gate on without a full agent run. Bodies may be
`throw new Error('not implemented')` — this phase ships the **contract**, not the logic.

**FR1.3 — `AgentEvent` union.** Define the event types the engine will emit:
`{ type: 'text', delta }`, `{ type: 'tool_call', id, name, args }`,
`{ type: 'tool_result', id, name, result }`, `{ type: 'staged_change', blockId, change }`,
`{ type: 'error', error }`, `{ type: 'done', reason: 'model_complete' | 'max_turns' | 'aborted', transaction }`.

**FR1.4 — Isomorphic parser.** `messageParser.js` must not reference the global
`DOMParser` directly. Introduce an internal adapter: when `typeof window !== 'undefined'`
use native `DOMParser`; otherwise lazy-`import('linkedom')`. `sanitizeHtmlWithoutCss`
and `parseHtmlToTiptapJson` keep identical signatures and outputs. Browser behavior is
byte-for-byte unchanged.

**FR1.5 — `ModelProvider` interface + browser impl.** Interface: an async function
`({ messages, systemPrompt, model, tools, signal }) => AsyncIterable<Delta>` where
`Delta` is the normalized streaming shape `{ content?: string, tool_calls?: [...] }`.
The browser implementation extracts the existing SSE fetch+parse logic from
`ChatDrawer.svelte:463–539` into `src/sdk/providers/browser.js` (calls `/api/chat`).

**FR1.6 — `ScreenshotProvider` interface + browser impl.** Interface:
`async (payload) => base64String`. Browser implementation wraps the existing
`fetch('/api/screenshot')` (currently `agentTools.js:219`), including its
`AbortController` timeout.

**FR1.7 — Zero regression.** The new `src/sdk/` modules are not yet imported by the
running app. Manual smoke of the web app shows identical behavior.

## 4. Technical Design

- **`src/sdk/` tree introduced this phase:**
  ```
  src/sdk/
    index.js            # ResumeAgentEngine (interface skeleton)
    types.js            # ResumeState, Block, AgentEvent, provider type JSDoc
    providers/
      browser.js        # browserModelProvider, browserScreenshotProvider
  ```
- **Parser adapter** lives inside `messageParser.js` (or a sibling `domAdapter.js`) so
  callers are untouched.
- **`Delta` normalization** is defined here so Phase 2's engine and Phase 3's Node
  provider both target the same shape — the OpenRouter/OpenAI-style `choices[].delta`
  currently parsed inline becomes the canonical interface.
- **Dependency added:** `linkedom` (Node-only HTML parsing). `@anthropic-ai/sdk` and
  `puppeteer` already present.

## 5. Deliverables

- `src/sdk/index.js`, `src/sdk/types.js`, `src/sdk/providers/browser.js`
- Refactored `src/lib/ai-chat/messageParser.js` (isomorphic)
- `package.json` updated with `linkedom`
- `scripts/test-sdk-phase1.cjs` — Node smoke test: parse a fixture HTML string through
  `parseHtmlToTiptapJson` under `linkedom` and assert it equals the known-good Tiptap JSON.

## 6. Definition of Done

- [ ] `ResumeState`/`Block`/`AgentEvent` documented in `types.js` and referenced by the index.
- [ ] `src/sdk/index.js` imports cleanly (interface present, providers typed).
- [ ] `node scripts/test-sdk-phase1.cjs` passes — Node parse output matches browser output for fixtures.
- [ ] No file under `src/sdk/` imports `svelte` or touches `window` outside the parser adapter's guarded branch.
- [ ] Web app manual smoke: chat, agent edits, screenshots all behave exactly as before (no module is wired yet).

## 7. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| `linkedom`'s DOM differs subtly from browser `DOMParser` (whitespace, entity handling) | Shared fixtures + golden-output test (FR1.4 / deliverable); adapter isolates the difference to one file |
| Interface churns once Phase 2 implements it | Derive the interface directly from the existing `runGeneration` payload and `runAgentTool(ctx)` shape so it matches reality, not a guess |
