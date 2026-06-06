# Phase 6 Completion — Working Session Prompt

## What this project is

NotionToCV is a Svelte 5 + Vite app that turns Notion-exported resume blocks into a
spatially-constrained A4 CV. It has a 6-phase "Agentic Resume SDK" baked in:

- **SDK** (`src/sdk/`) — `ResumeAgentEngine` is an async generator that calls an LLM in a
  loop (up to 30 turns), yielding `AgentEvent` objects (`text`, `tool_call`, `tool_result`,
  `staged_change`, `error`, `done`). Zero Svelte, zero browser globals.
- **Providers** — `browserModelProvider/browserScreenshotProvider` proxy through Vite
  route handlers; `nodeModelProvider/nodeScreenshotProvider` call the Anthropic SDK and
  POST to `/api/screenshot` directly.
- **Background worker** (`server/agent/`) — queue, worker, image store. Jobs dehydrate
  `imageData` to `file://` URIs before enqueueing; images rehydrate lazily on first
  screenshot call. Concurrency cap: 5 jobs. Wall-clock timeout: 20 min.
- **CLI** (`scripts/resume-agent.cjs`) — `--input`, `--output`, `--prompt`, `--jd`,
  `--strict-capacity`, `--verbose`, `--model`.
- **JD pipeline** (`scripts/jd-pipeline.cjs`) — master CV + N JDs → requirement
  extraction LLM pass → relevance filter pass → per-JD tailoring via the SDK engine
  (strict capacity) → PDF generation → results written to `server/agent/results/<batchId>/`.
- **Dashboard** (`src/lib/views/Dashboard.svelte`) — lists saved CVs + Applications section
  that reads `server/agent/results/` batches. Per-result: expand toggle, "✓ Approve & Edit"
  button (fetches tailored JSON → materializes as new editable resume in localStorage →
  navigates to editor), PDF download link (for `status === 'done'` only).

## State of Phase 6 right now

Phases 1–5 are complete. Phase 6 is a **prototype** — the pipeline script and results
surface exist, but three product requirements from the PRD are not yet implemented:

### Gap 1 — No dashboard master-CV designation (FR6.1)

The PRD says:
> The user designates one saved CV as their "master" from the dashboard.

**Current state:** Master CV is CLI-only (`--master master.json`). There is no way to
mark a saved CV as master from the dashboard UI. `Dashboard.svelte` shows CV cards with
"Edit CV" and "Delete" buttons but no master designation control.

**What needs building:**
- A "Set as Master" button/toggle on each CV card in the dashboard (or a star/pin icon)
- Persist the master CV ID to `localStorage` key `notionToCV_masterCvId`
- Visual indicator on the designated master card
- A "Run JD Pipeline" button/entry point on the dashboard that is only enabled when a
  master CV is designated — this is where the user submits JDs and kicks off the pipeline
  via the web UI rather than the CLI

### Gap 2 — Fit report lacks requirement→block mapping (FR6.6)

The PRD says:
> fit report: which JD requirements were mapped to which blocks

**Current state:** The fit report (built in `scripts/jd-pipeline.cjs`, written to
`<batchId>/<name>-fit-report.json`) has:
```json
{
  "role": "...",
  "requirementsCount": 4,
  "blocksScoped": 7,
  "blocksChanged": 3,
  "changedBlocks": [
    { "id": "...", "name": "...", "type": "paragraph", "diff": { "old": "...", "new": "..." } }
  ],
  "capacityViolations": [],
  "toolCalls": 12,
  "doneReason": "model_complete"
}
```

Missing: **which JD requirement drove each block change.** The extracted requirements
(from the FR6.2 pre-pass) exist in memory during the pipeline run but are not threaded
into the per-block diff objects.

**What needs building:**
- In `jd-pipeline.cjs`: after tailoring, run a lightweight LLM scoring step: given the
  requirements list and the set of `changedBlocks`, ask the model to output a JSON mapping
  `{ blockId: [requirementIndex, ...] }`. Add this as `requirementMapping` to the fit report.
- In `Dashboard.svelte`: render the requirement→block mapping in the expanded detail panel.
  Each changed block should show which requirements it addresses. Each requirement should
  show which blocks address it (or flag if no block addresses it — a gap).

### Gap 3 — Factuality guardrail is prompt-only (FR6.7)

The PRD says:
> Factuality (constrain to master-CV facts in the prompt + review gate)

**Current state:** The tailoring instruction includes "Do NOT fabricate experience." but
there is no automated check comparing tailored content against the master CV. The human
review gate (Approve & Edit) exists, which partially satisfies the review-gate clause.

**What needs building:**
- In `jd-pipeline.cjs`: after tailoring, run a factuality check LLM pass for each changed
  block: given the original block content (from `changedBlocks[i].diff.old`) and the
  proposed content (`diff.new`), ask the model "Does the proposed content introduce any
  claims, roles, skills, technologies, or metrics not present in the original? Answer YES
  or NO with a brief reason."
- Store the result as `factualityFlags: [{ blockId, flagged: bool, reason: string }]` in
  the fit report.
- In `Dashboard.svelte`: show a ⚠ badge on changed blocks with `flagged: true` in the
  expanded detail panel. If any block is flagged, show a banner in the result row:
  "⚠ Factuality review needed".

## Key files to read before starting

```
src/lib/views/Dashboard.svelte          — where Gaps 1 and 2/3 (display) need changes
scripts/jd-pipeline.cjs                 — where Gaps 2 and 3 (pipeline) need changes
src/App.svelte                          — handleApproveApplication, look at how resumes
                                          are stored/retrieved (localStorage)
ai-specs/phases/phase-6-jd-pipeline.md — full PRD with all FRs
```

## Constraints to respect

- **Svelte 5 reactivity**: use `$state`, `$derived`, `$props()`. No `$:` reactive statements.
- **No new dependencies**: use the existing `@anthropic-ai/sdk` for LLM calls in the
  pipeline (same `simpleLLMCall` helper pattern already in `jd-pipeline.cjs`).
- **Don't break the existing pipeline flow**: the CLI script still works; the new
  dashboard JD submission UI is additive on top.
- **Don't commit API keys**: `ANTHROPIC_API_KEY` is read from env only.
- **localStorage schema**: master CV ID → `notionToCV_masterCvId` (single string).
- **No git commit messages mentioning AI authorship**.

## Suggested order of attack

1. Read the files listed above before touching anything.
2. Implement Gap 1 (master-CV designation) — it's self-contained to Dashboard.svelte +
   App.svelte, and unblocks the "Run JD Pipeline" UI entry point.
3. Implement Gap 2 (requirement→block mapping) — pipeline side first, then display.
4. Implement Gap 3 (factuality flags) — pipeline side first, then display.
5. Verify the build passes: `npm run build`.

## What "done" looks like

- A CV card in the dashboard has a "Set as Master" toggle. One CV can be the master at a
  time. The master card is visually distinct.
- A "Run JD Pipeline" action is accessible from the dashboard when a master is set,
  letting the user paste or upload JDs and kick off a batch (can call the same pipeline
  logic, either as a server route or by spawning the CLI script).
- Each fit report JSON contains `requirementMapping` and `factualityFlags`.
- The expanded result detail in the dashboard shows requirement→block links and ⚠ badges
  on factuality-flagged blocks.
- `npm run build` passes clean.
