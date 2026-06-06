# Phase 3 PRD — CLI Harness (Headless Proof)

> **Objective.** Ship `scripts/resume-agent.cjs`: a Node CLI that runs the full SDK
> headlessly against a JSON resume + instruction, **auto-accepts** the staged edits,
> prints a unified diff plus a layout-capacity report, and writes optimized JSON — with
> **no browser anywhere**. This phase provides the Node implementations of both providers.
> **This is the milestone that proves environment-agnosticism.**

## 1. Context & Dependencies

- **Depends on:** Phase 2 (the engine) and Phase 1 (contracts, normalized `Delta`,
  isomorphic parser).
- **Reuses:** `src/lib/layout/` for capacity reporting; the rendering pipeline behind
  `/api/screenshot` (`render-svg.js` / `render-pdf.js` / `@napi-rs/canvas` / `puppeteer`)
  for the Node screenshot provider.
- **Convention:** matches existing `scripts/test-phase*.cjs` CJS harness style.

## 2. Goals / Non-Goals

**Goals**
- A Node `modelProvider` (direct `@anthropic-ai/sdk`, env-supplied key) emitting the
  Phase-1 normalized `Delta` shape.
- A Node `screenshotProvider` (direct Puppeteer render of a single block) → base64.
- CLI arg parsing per the high-level PRD §4.1.
- Auto-accept: apply the staged transaction to the state and write the output JSON.
- Deterministic console output: unified text diff per changed block + layout-capacity
  numbers, shown **before** writing.
- `--strict-capacity`: reject edits that overflow.

**Non-Goals (owned by later phases)**
- Web rewire → Phase 4.
- Server queue / background execution → Phase 5.
- Multi-resume / JD batch scale → Phase 6 (this phase is **single resume, single run**).

## 3. Functional Requirements

**FR3.1 — Inputs.** `--input <resume.json>` (a `ResumeState`), optional `--jd <file>`,
`--prompt <string>`. The CLI composes the `instruction` from `--prompt` and/or the JD text.

**FR3.2 — Run.** Instantiate `ResumeAgentEngine` with the Node providers; call
`optimizeResume`; consume the `AgentEvent` stream. With `--verbose`, log each `tool_call`,
`tool_result`, and the capacity numbers returned by `update_block_content`.

**FR3.3 — Auto-accept.** On `done`, merge `transaction.stagedChanges[*].proposedContent`
into the corresponding blocks' `content`, then write `--output <file>`. (No interactive
prompt — auto-accept is the CLI contract.)

**FR3.4 — Deterministic diff + capacity.** Before writing, print a per-changed-block
**unified diff** of plaintext old→new, alongside the layout-engine capacity for the
proposed content (`max_lines`, `current_lines_used`, `lines_remaining`, `is_overflowing`),
computed via `computeLayout`/`blockRectMm`.

**FR3.5 — `--strict-capacity`.** Any staged change whose proposed content yields
`is_overflowing === true` is **not applied**; it is logged as rejected. The process exits
non-zero if any change was rejected (so pipelines can gate on it).

**FR3.6 — Node `modelProvider`.** Maps the engine's request (`messages`, `systemPrompt`,
`model`, `tools`) onto `@anthropic-ai/sdk` streaming and normalizes the response into the
Phase-1 `Delta` iterable. Reads the key from env (e.g. `ANTHROPIC_API_KEY`).

**FR3.7 — Node `screenshotProvider`.** Renders the target block headlessly via Puppeteer
(reusing the server render path) and returns base64. If Puppeteer is unavailable, the
provider throws gracefully and the tool returns the existing structured error — the loop
continues (screenshots are advisory, not required).

**FR3.8 — Packaging.** `scripts/resume-agent.cjs` is CJS; it `await import()`s the ESM
SDK (`src/sdk/index.js`). Runnable as `node scripts/resume-agent.cjs ...`.

## 4. Technical Design

- **New files:**
  ```
  scripts/resume-agent.cjs        # arg parsing, run, diff, write, exit codes
  src/sdk/providers/node.js       # nodeModelProvider, nodeScreenshotProvider
  ```
- **ESM/CJS interop:** the harness is `.cjs` to match the repo's existing scripts but the
  SDK is ESM (`"type": "module"`) — use dynamic `import()` inside the harness.
- **Diff:** a minimal unified-diff over block plaintext (no new heavy dep required).
- **Capacity report** reuses the exact `computeLayout` path `runAgentTool` already uses,
  so CLI numbers match what the agent saw.

## 5. Deliverables

- `scripts/resume-agent.cjs`
- `src/sdk/providers/node.js`
- A sample `fixtures/sample-resume.json` and a short usage note in the harness `--help`.

## 6. Definition of Done

- [ ] `node scripts/resume-agent.cjs --input fixtures/sample-resume.json --prompt "..." --output /tmp/out.json --verbose` runs end-to-end with **no browser process**, producing a coherent tailored `out.json`.
- [ ] `--jd <file>` path composes a JD-driven instruction and tailors accordingly.
- [ ] `--strict-capacity` blocks a deliberately oversized edit (logged rejected, non-zero exit), while the same run without the flag applies it.
- [ ] `--verbose` prints tool calls + capacity numbers identical to what the engine computed.
- [ ] The SDK code path executed is byte-identical to Phase 2's (only the injected providers differ) — no `src/sdk` logic forks for CLI.

## 7. Risks & Mitigations

| Risk | Mitigation |
| :--- | :--- |
| Puppeteer in CLI is heavy/slow or absent in CI | Screenshot tool is advisory (FR3.7); loop proceeds without it; CI run can disable screenshots |
| ESM/CJS interop friction | Dynamic `import()` in the `.cjs` harness; documented pattern |
| Model nondeterminism makes "coherent output" hard to assert in CI | Assert structural invariants (valid JSON, no overflow under `--strict-capacity`, blocks unchanged when locked) rather than exact text |
| Key handling on a dev machine | Read from env only; never log the key; `--verbose` redacts |
