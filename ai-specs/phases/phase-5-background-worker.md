# Phase 5 PRD — Background Worker & Server Handoff

> **Objective.** Run the **identical** SDK as a server-side background job so a user can
> dispatch a heavy or long-running optimization, close the tab, and be notified when the
> result is ready for review. No logic fork from the CLI/browser — the worker imports the
> same `src/sdk` engine.

## 1. Context & Dependencies

- **Depends on:** Phase 2 (engine) and Phase 3 (Node providers — the worker reuses
  `nodeModelProvider` and `nodeScreenshotProvider`). Phase 4 is the expected dispatcher
  (the web app initiates handoff) but not a hard code dependency.
- **Reuses:** the `ResumeState` contract, the `--strict-capacity` enforcement concept,
  the server render path for screenshots.

## 2. Goals / Non-Goals

**Goals**
- A queue API to enqueue an optimization job and retrieve its status/result.
- A worker that pulls jobs and runs `optimizeResume` with server providers.
- Web handoff UX: serialize current canvas → enqueue → notify on completion → load the
  result as staged changes for review (reusing Phase 4's staging UI).

**Non-Goals (owned by Phase 6)**
- Multi-resume / multi-JD batch fan-out and the JD-matching pipeline.
- Auto-applying to job boards.

## 3. Functional Requirements

**FR5.1 — Job model.** `{ id, status: 'queued'|'running'|'done'|'error', input: { state, instruction, opts }, output?: { transaction }, error?, createdAt, updatedAt }`,
scoped to a user.

**FR5.2 — Enqueue endpoint.** `POST /api/agent/queue` accepts `{ state, instruction, opts }`,
validates the `ResumeState`, enforces size limits, returns `{ jobId }` immediately.

**FR5.3 — Status/result + cancel endpoints.**
- `GET /api/agent/job/:id` — returns status and, when `done`, the staged transaction.
- `DELETE /api/agent/job/:id` — cancels a queued or running job (signals the
  worker's `AbortController`; sets status to `'cancelled'`). Auth-scoped: a user can
  only cancel their own jobs.
- Completed jobs expire after **7 days** and are purged; the result must be applied or
  discarded within that window.

**FR5.4 — Worker.** Pulls queued jobs and runs the same `ResumeAgentEngine.optimizeResume`
with `nodeModelProvider` + `nodeScreenshotProvider`, off the request thread. Persists the
resulting transaction to the job record. Honors the 30-turn cap, `AbortSignal` (job
cancel), and optional `--strict-capacity`-equivalent option.

**FR5.5 — Web dispatch UX.** A "Run in background" action lives in `ChatDrawer.svelte`
(alongside the existing "Chat with AI" flow) for long-running optimizations. It
serializes the current canvas to `ResumeState` (after dehydration per FR5.8), calls the
enqueue endpoint, and returns control instantly (tab can be closed).

Completion notification uses **client-side polling**: on return to the app, the UI polls
`GET /api/agent/job/:id` at a reasonable interval (e.g. 5s) until status is `done` or
`error`. A persistent in-app banner indicates a job is in progress. Server-push
(WebSocket/SSE) is a future enhancement, not required for this phase.

On `done`, the result is loaded: `transaction.stagedChanges` is fed into the existing
`stagedChanges` store path (same as Phase 4's `staged_change` event handler) for
accept/deny review.

**FR5.6 — Safety.** Per-job turn cap (30), payload size ceiling, auth scoping so a user
can only read their own jobs, and a per-job cost/time budget guard.

**FR5.7 — No fork.** The worker contains **no** agent logic of its own — it is provider
injection + job lifecycle around the shared SDK.

**FR5.8 — Media dehydration at the queue boundary.** `ResumeState` blocks carry **inline
base64** image data (`block.imageData`, set via `canvas.toDataURL`/`readAsDataURL` —
verified at `CanvasBlock.svelte:316,321`). Passing multi-MB data URIs through the job
queue causes memory bloat and latency. Before enqueue, **dehydrate**: replace each
`imageData` data URI with a storage reference URI (upload to blob storage → store the URI).

**Storage is an open decision**, defined behind an `ImageStore` interface (same pattern
as `JobQueue`): a starter implementation can use the local filesystem or an existing
bucket; production swaps to S3/R2/etc. with no queue or engine change.

The worker **rehydrates** on demand — the Node `screenshotProvider` fetches the image
from storage when it needs to render. The agent's text/layout reasoning never needs the
bytes, so most jobs never rehydrate at all. The queued payload stays small and bounded.

## 4. Technical Design

- **Queue/infra is a decision, behind an interface.** The high-level PRD suggests
  Bull/Redis; to avoid premature infra, define a small `JobQueue` interface and allow a
  starter implementation (in-process or DB-backed) swappable for Redis/Bull later. The
  engine never knows which is used.
- **New surfaces:**
  ```
  server/agent/queue.js     # JobQueue interface + starter impl
  server/agent/worker.js    # pulls jobs → runs src/sdk engine with node providers
  server/agent/imageStore.js  # ImageStore interface + starter impl (dehydration/rehydration)
  routes: POST /api/agent/queue, GET /api/agent/job/:id, DELETE /api/agent/job/:id
  ```
- **Providers** are exactly Phase 3's `src/sdk/providers/node.js`.
- **Result review** reuses Phase 4's staging mapping: a fetched transaction is fed into
  the same `stagedChanges` store path.

## 5. Deliverables

- Enqueue + status + cancel endpoints.
- `JobQueue` interface + starter impl + the worker runner.
- `ImageStore` interface + starter impl (dehydration/rehydration).
- Web "Run in background" dispatch in `ChatDrawer` + polling-based completion banner + result-load-into-staging.

## 6. Definition of Done

- [ ] Enqueue a deep-optimization job, close the browser tab; the worker completes it off-main-thread; the result is retrievable.
- [ ] Reopening the app polls and surfaces "optimized CV ready" banner; loading it populates the staging UI for accept/deny.
- [ ] `DELETE /api/agent/job/:id` cancels a running job and signals the worker's AbortController.
- [ ] Jobs older than 7 days are purged automatically.
- [ ] The worker runs the same `src/sdk` engine as the CLI (verified — no duplicated loop), with the 30-turn cap honored.
- [ ] A user cannot read or cancel another user's job (auth scoping test).
- [ ] A `imageData` data URI in the input state is dehydrated before enqueue and never appears in the queued payload.

## 7. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| Introducing Redis/Bull infra prematurely | `JobQueue` interface; ship a DB/in-process starter; swap later with no engine change |
| Long jobs burn cost/time | 30-turn cap + per-job budget guard + cancel |
| Stale result vs. edited canvas on return | Store the input state snapshot with the job; show the diff against the snapshot, not the live (possibly-changed) canvas |
| Multi-MB base64 images bloat the queue | Dehydrate `imageData` → storage URI before enqueue; worker rehydrates only when rendering (FR5.8) |
