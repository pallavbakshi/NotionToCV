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
                   │
                   └──> Phase 4 (web rewire)
                                   │
            Phase 3 ──────────────┴──> Phase 5 (background worker)
                                                   │
                            Phase 3 ──────────────┴──> Phase 6 (JD pipeline @ scale)
```

Phase 3 (CLI) intentionally precedes Phase 4 (web) — per the vision's **"CLI First"**
mandate, the SDK must be bulletproof headless before we touch the working web app.

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
   (browser, CLI, worker) speak the same state shape defined in Phase 1.

## Current-state anchor (what exists today)

- The agent loop lives **inside** `src/lib/ai-chat/ChatDrawer.svelte` as the recursive
  `runGeneration()` (lines ~450–643): call model → stream/accumulate content + tool
  calls → dispatch via `runAgentTool` → append results → recurse → stop when no tool
  calls. **It has no turn cap today.**
- `src/lib/ai-chat/agentTools.js` already holds a *pure* `runAgentTool(name, args, ctx)`
  and the system prompts — the cleanest part to lift.
- `src/lib/ai-chat/messageParser.js` uses the browser `DOMParser` (the main isomorphic
  blocker).
- `src/lib/layout/` (`computeLayout`, `blockRectMm`, `colWidthMm`, `effectiveBaseStyle`)
  is already headless and Node-importable — preserved as-is.
- Staged changes flow through the `src/lib/shared/stagingStore.js` Svelte store
  (`stagedChanges`) — to be replaced by returned transactions.
- `package.json` already ships `@anthropic-ai/sdk` and `puppeteer`; `linkedom` is the
  one new dependency (Phase 1).
