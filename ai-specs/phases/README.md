# Agentic Resume SDK — Phased PRD Index

This directory decomposes the [vision](../vision.md) and [high-level PRD](../prd-high-level.md)
into six **MECE** (mutually exclusive, collectively exhaustive) phases. Each phase
is a self-contained PRD with its own scope, deliverables, and definition of done.
Earlier phases build the core; later phases reach the vision.

## The arc

| Phase | Title | Outcome | Proves |
| :---- | :---- | :------ | :----- |
| [1](./phase-1-foundations.md) | Foundations: Contracts & Isomorphic Boundaries | Canonical state schema, SDK interface, isomorphic parser, injectable providers | The substrate is environment-neutral |
| [2](./phase-2-agentic-engine.md) | The Agentic Engine (Core Loop Extraction) | Pure host-agnostic loop with a 30-turn cap, event stream, staged transactions | The agent runs with **zero** Svelte/browser deps |
| [3](./phase-3-cli-harness.md) | CLI Harness (Headless Proof) | `resume-agent.cjs`: JSON in → tailored JSON out, no browser | **Milestone** — decoupling is real |
| [4](./phase-4-web-integration.md) | Web Client Re-integration | `ChatDrawer` becomes a thin consumer of the SDK | No UX regression; one source of truth |
| [5](./phase-5-background-worker.md) | Background Worker & Server Handoff | Fire-and-forget server jobs running the same SDK | Passive, off-main-thread execution |
| [6](./phase-6-jd-pipeline.md) | The JD-Matching Pipeline (The Vision) | Master CV + JDs → N tailored, spatially-correct PDFs at scale | The grand vision |

## Dependency graph

```
Phase 1 ──> Phase 2 ──> Phase 3 (CLI, headless proof)
                   │           │
                   └──> Phase 4 (web rewire)
                               │
                   Phase 2 ────┤
                   Phase 3 ────┴──> Phase 5 (background worker)
                                           │
                               Phase 3 ────┴──> Phase 6 (JD pipeline @ scale)
```

- Phase 3 (CLI) intentionally precedes Phase 4 (web) — per the vision's **"CLI First"**
  mandate, the SDK must be bulletproof headless before we touch the working web app.
- Phase 5 depends on **both** Phase 2 (engine) and Phase 3 (Node providers) — it reuses
  `nodeModelProvider` and `nodeScreenshotProvider` from Phase 3's `src/sdk/providers/node.js`.
- Phase 4 is not a hard dependency of Phase 5 but provides the staging UI that
  Phase 5's result-review flow reuses.

## Cross-cutting decisions (locked, apply to every phase)

These were settled during design and are **not** re-litigated per phase:

1. **Injected capabilities, not embedded keys.** The SDK never holds a raw API key
   or a hardcoded `fetch`. Both the LLM transport and the screenshot capability are
   passed in as providers (`modelProvider`, `screenshotProvider`). The browser host
   injects providers that proxy through its existing `/api/chat` and `/api/screenshot`
   endpoints (key stays server-side); Node hosts inject direct `@anthropic-ai/sdk` and
   Puppeteer implementations. This is the single mechanism that makes the SDK agnostic.

2. **Agent SDK, not chat SDK.** The primitive is an autonomous tool-calling loop driven
   to a goal, not a request/response message exchange. The conversational UI is one host
   rendering the loop's intermediate steps.

3. **The model decides completion; 30 turns is the only backstop.** The loop ends when
   the model stops emitting tool calls. A hard ceiling of **30 tool-call turns per user
   interaction** guarantees a background worker can never spin forever. There is no
   separate "goal-state" gate second-guessing the model.

4. **The layout engine is the moat, and it informs — it does not gate.** Every
   `update_block_content` returns real spatial-budget numbers (lines used / remaining /
   overflow) so the model self-corrects. `--strict-capacity` (Phase 3+) is an optional
   enforcement flag for automated pipelines, not a core loop mechanic.

5. **Canonical `ResumeState` JSON is the serialization contract.** All three hosts
   (browser, CLI, worker) speak the same state shape defined in Phase 1. Blocks may
   carry `imageData` (base64 data URI for headshot/image blocks); this field is defined
   in Phase 1's schema and **dehydrated to a storage URI** before crossing any queue
   boundary (Phase 5+).

6. **No Tiptap `Editor`/`EditorView` in the SDK — headless Tiptap APIs are fine.**
   The SDK uses `getSchema(extensions)` + ProseMirror `DOMParser` for headless HTML→inline-node
   conversion (`htmlToInlineNodes`). The full Tiptap `Editor` (which requires a browser
   mount point and `requestAnimationFrame`) is a web-host concern only.

## Phase completion status

| Phase | Status | Notes |
| :---- | :----- | :---- |
| Phase 1 | **Complete** | `src/sdk/index.js`, `types.js`, `providers/browser.js` shipped; `messageParser.js` isomorphic; `linkedom` added; `test-sdk-phase1.cjs` 7/7 passing |
| Phase 2 | **Complete** | `src/sdk/engine.js` — 30-turn loop, full event stream, staged transactions, coach mode, `validateBlockLayout`; `test-sdk-phase2.cjs` 24/24 passing |
| Phase 3 | **Complete** | `scripts/resume-agent.cjs` — headless CLI with `--strict-capacity`, `--jd`, `--verbose`, `--model`; `src/sdk/providers/node.js` — Anthropic SDK streaming + screenshot via `/api/screenshot` |
| Phase 4 | **Complete** | `ChatDrawer.svelte` rewired to `ResumeAgentEngine`; `agentTools.js` / `spatialUtils.js` deleted; final transaction merged on `done`; background-cancel wired to stop button |
| Phase 5 | **Mostly complete** | Queue, worker, image dehydration/lazy-rehydration, routes, polling UI, 5-job concurrency cap, 20-min wall-clock timeout; known gap: auth is localStorage-based (no real server sessions) |
| Phase 6 | **Prototype** | `scripts/jd-pipeline.cjs` + dashboard results surface + approve-into-editor flow; known gaps: no dashboard master-CV selector, fit report lacks requirement→block mapping, no automated factuality check |

## Pre-Phase-1 state (for historical context)

- The agent loop lived **inside** `src/lib/ai-chat/ChatDrawer.svelte` as the recursive
  `runGeneration()` (lines ~450–643). It had no turn cap.
- `src/lib/ai-chat/messageParser.js` used the browser `DOMParser` directly (now isomorphic).
- `src/lib/layout/` was already headless and Node-importable — preserved as-is.
- Staged changes flowed through `src/lib/shared/stagingStore.js` Svelte store — to be
  replaced by returned transactions in Phase 2.
- `package.json` ships `@anthropic-ai/sdk` and `puppeteer`; `linkedom` was added in Phase 1.
