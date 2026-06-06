# Phase 6 PRD — The JD-Matching Pipeline (The Vision)

> **Objective.** Realize the grand vision: a high-throughput career-operations engine that
> ingests a master CV database and a set of target Job Descriptions and, using the
> background agent, produces a **mathematically-fit, spatially-correct, JD-tailored PDF
> per application** — at scale (N JDs → N distinct tailored resumes).

## 1. Context & Dependencies

- **Depends on:** Phase 5 (background workers + queue), Phase 3 (`--strict-capacity`
  enforcement and Node providers), and the full SDK (Phases 1–2).
- **Reuses:** the print pipeline behind `/api/print` (`render-pdf.js`) for final PDF output.

## 2. Goals / Non-Goals

**Goals**
- Ingest a master CV (comprehensive career history) and one or more JDs.
- Per JD: map requirements → blocks, rewrite content within the spatial budget,
  enforce no-overflow.
- Batch fan-out: M JDs → M background jobs → M tailored PDFs.
- A results surface listing each (JD → tailored resume PDF + diff + fit report).

**Non-Goals**
- **Automated submission to job boards/ATS.** "Auto-apply at scale" here means producing
  the tailored artifact per application; actual submission connectors are a separate
  product surface, explicitly out of scope for this phase.
- Net-new agent reasoning logic — tailoring uses the existing engine + tools.

## 3. Functional Requirements

**FR6.1 — Master CV ingestion.** Accept a superset `ResumeState` (all experience) as the
source of truth. It must **not** fabricate experience absent from the master CV
(factuality guardrail).

**FR6.1a — Mandatory Relevance Filter pre-pass.** The master CV is a multi-page,
unconstrained data store; feeding it whole into the tailoring loop bloats the context
window and dilutes the model's attention. A **distinct, required** relevance pre-pass
runs **before** the spatial optimization loop: given the JD requirements (FR6.2), it
selects/ranks the applicable master-CV blocks and hands the tailoring agent only that
focused subset. The pre-pass is separate from the agent loop (a lightweight LLM scoring
step), not the agent's opening turns — so the spatial loop starts already scoped. This is
a hard requirement, not an optimization.

**FR6.2 — JD ingestion + requirement extraction.** For each JD (text/file), an LLM step
produces a structured requirement list used to drive tailoring.

**FR6.3 — Per-JD tailoring run.** For each JD, enqueue a Phase-5 job whose `instruction`
encodes the JD requirements; the engine rewrites mapped blocks within budget with
`--strict-capacity`-equivalent enforcement on (no overflow ships).

**FR6.4 — Batch orchestration.** Submitting M JDs fans out to M jobs via the Phase-5
queue; the pipeline tracks aggregate progress and collects results.

**FR6.5 — PDF generation.** Each completed, tailored `ResumeState` is rendered to a
mathematically-fit PDF via the existing print pipeline.

**FR6.6 — Results surface.** A dashboard listing, per JD: the tailored resume PDF, a
diff summary vs. the master CV, and a **fit report** (which JD requirements mapped to
which blocks, capacity status). A human-review gate precedes any downstream use.

**FR6.7 — Guardrails.** Factuality (constrain to master-CV facts in the prompt + review
gate); capacity (strict, no overflow); per-batch cost ceiling; per-job 30-turn cap.

## 4. Technical Design

- **Orchestration** sits atop Phase 5: the pipeline is a producer that enqueues one job
  per JD and a collector that assembles results — the per-resume work is unchanged SDK.
- **Requirement extraction** (FR6.2) and the **Relevance Filter** (FR6.1a) are dedicated
  LLM pre-passes that run before the tailoring loop, so it starts with both a focused
  instruction and a scoped block subset — never the full master CV.
- **Media at scale:** each fanned-out job inherits Phase 5's dehydration (FR5.8) — the
  master CV's `imageData` is swapped for storage URIs once, so M parallel jobs don't each
  carry M copies of multi-MB base64 headshots through the queue.
- **PDF** reuses `render-pdf.js` / `/api/print` with the tailored state — no new renderer.
- **Fit report** is assembled from the agent's tool results (which blocks it read/edited
  and their final capacity), captured from the event stream during the job.

## 5. Deliverables

- Master-CV + JD ingestion + requirement-extraction step.
- Batch orchestrator (fan-out over Phase-5 queue) + result collector.
- Per-result PDF generation + the results dashboard with fit reports.
- Factuality + cost guardrails.

## 6. Definition of Done

- [ ] Given a master CV and 5 JDs, the pipeline emits 5 **distinct** tailored, non-overflowing PDFs, each demonstrably aligned to its JD.
- [ ] Every PDF passes strict capacity (no overflowing block ships).
- [ ] No tailored resume introduces experience absent from the master CV (factuality check).
- [ ] Each result carries a diff vs. master CV and a fit report; a human-review gate exists before downstream use.
- [ ] The per-resume work runs on the same `src/sdk` engine via Phase-5 jobs (no logic fork).

## 7. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| Hallucinated/fabricated experience | Constrain prompts to master-CV facts; factuality review gate; diff surfaced for every change |
| Cost explosion at scale | Per-batch cost ceiling + per-job 30-turn cap; batch concurrency limits |
| Quality variance across JDs | Fit report + mandatory human review before the artifact is used |
| Over-tailoring that breaks layout | Strict-capacity enforcement; the layout engine remains the hard constraint |
| Whole master CV bloats context / dilutes attention | Mandatory Relevance Filter pre-pass (FR6.1a) scopes blocks before the tailoring loop |
| M jobs each carrying multi-MB base64 images | Inherit Phase 5 dehydration (FR5.8): images → storage URIs before fan-out |
