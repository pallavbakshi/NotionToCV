# Layout Designer v2 — Economical Placement PRD

**Status:** Proposed
**Owner:** Layout Designer
**Supersedes the open questions in:** `docs/layout-designer-agent.md`
**Date:** 2026-06-07

---

## 1. Problem Statement

The Layout Designer agent places blocks validly but **not economically**. It stuffs prose into 2-column columns that run tall and skinny, leaves large vertical gaps, and produces unbalanced pages. The output is correct (no overlaps, no overflow) but visually poor.

This is not a single bug. The root cause is structural: **the system measures and rewards validity, never economy.** The agent therefore satisfices — it finds any legal slot and moves on. Combined with a spatially-blind feedback loop and the weakest available model, the result is greedy, myopic, wasteful placement.

### Confirmed root causes (grounded in current code)

| # | Root cause | Evidence |
|---|---|---|
| R1 | **No objective function for economy.** `place_block` returns only validity + overflow. Nothing scores wasted space, aspect ratio, or balance. | `src/sdk/tools.js` `runLayoutDesignerTool` → `place_block` success branch (returns `status`, `message`, `lines_used/max_lines` only) |
| R2 | **No pre-placement measurement.** The agent cannot ask "how many rows does this need at 2 vs 3 vs 4 cols?" before committing. It guesses, overflows, and bumps `rowSpan` — converging tall-and-narrow. | overflow feedback only advises "Increase rowSpan", `tools.js` place_block |
| R3 | **Defaults + prompt actively bias narrow.** `DEFAULT_SPANS.paragraph = {colSpan:2,rowSpan:1}`; prompt says "paragraph → 2×1". 2 cols × 1 row ≈ one line, so any real paragraph overflows and gets stretched vertically. | `tools.js` `DEFAULT_SPANS`; `prompts.js` `getLayoutDesignerPrompt` rules |
| R4 | **Agent is spatially blind.** `read_canvas` returns a list of rects, not a free-space map. The LLM must mentally rasterize occupancy and find gaps — a task LLMs fail at. | `tools.js` `read_canvas` branch |
| R5 | **Screenshots are per-block, not per-page.** `get_block_screenshot(id)` renders one block. The agent never sees page-level whitespace or balance, yet is asked to judge "overall visual balance." | `tools.js` `get_block_screenshot`; `providers/browser.js` `browserScreenshotProvider` (takes `blockId`) |
| R6 | **Wrong cognitive split.** The LLM does both arithmetic (bounds, collision, row math) and semantics (grouping). It is bad at the former; the overlap-retry loop is the model brute-forcing coordinates. | `engine.js` retry via rejection messages |
| R7 | **Weakest model on the hardest task.** Layout uses `google/gemini-3.1-flash-lite`; the Content Editor uses `claude-sonnet-4-5`. Spatial packing is near the bottom of flash-tier capability. | `ChatDrawer.svelte`, `engine.js` model selection |

---

## 2. Goals & Non-Goals

### Goals
- **G1.** Make "economical" a **computable objective**, not prose guidance.
- **G2.** Let the agent **measure** a block's footprint at every width *before* placing it.
- **G3.** Give the agent **spatial perception**: a free-space map and a whole-page screenshot.
- **G4.** Shift the labor: **LLM decides semantics, deterministic code does packing math.**
- **G5.** Preserve the live, one-block-at-a-time build UX and the existing Accept/Deny rollback flow.

### Non-Goals
- No content rewriting (stays with Content Editor). Formatting cleanup + font choice remain in scope.
- No template switching, no color/style changes.
- Not building a fully autonomous optimal bin-packer in v2 Phase 1 — that's the Phase 4 target.

---

## 3. Definition of "Economical" (the objective function)

This is the heart of the PRD. Every other change exists to serve this definition.

### 3.1 Per-block fit quality

For a block placed at `(colSpan, rowSpan)` with measured content:

- `linesUsed` — true wrapped line count at that width (from `computeLayout`).
- `minRowSpan` — `ceil(usedHeightMm / ROW_MM)`; smallest rowSpan that avoids overflow.
- `area` — `colSpan × rowSpan` (grid cells).
- `aspectRatio` — `rowSpan / colSpan` (grid units). High = tall-thin = bad.
- `avgCharsPerLine` — readability proxy. Target band **45–90 chars**; outside is penalized.
- `utilization` — `linesUsed / maxLines` at the chosen rowSpan. Target **0.7–1.0**.

**Critical rule (resolves a flaw in the source opinions):** **Do not minimize `area` alone.** A `4×4` and a `2×8` have identical area (16) but the `2×8` is a tall column that fragments the page. Ranking must be:

> **1) readability in band → 2) lowest area → 3) lowest aspectRatio → 4) utilization in band.**

### 3.2 Page-level score

`score = 100 − Σ penalties`. Hard fails set `valid:false`.

| Penalty | Severity | Definition |
|---|---|---|
| Overlap | hard fail | any cell collision |
| Overflow | hard fail | `linesUsed > maxLines` |
| Out of bounds | hard fail | `col+colSpan > 4` or `row+rowSpan > 53` |
| Extra page | large | a page used that the content could have avoided |
| Excess vertical gap | medium | unused gap > 2 rows that is not a deliberate section break |
| Tall-thin block | medium | `aspectRatio` above threshold (e.g. paragraph with `rowSpan/colSpan > 2`) |
| Orphan heading | medium | heading at page bottom, its section body on next page |
| Section split across pages | medium | grouped blocks straddle a page boundary |
| Column imbalance | small | paired side-by-side blocks differ in height > 2 rows |
| Low utilization | small | block much taller than its content (`utilization < 0.5`) |
| Cramped | small | `avgCharsPerLine > 90` or zero breathing room |

These thresholds are **defaults to tune**, not final law.

---

## 4. Target Architecture

End-state is a **hybrid**: the LLM does what it's good at (semantics), deterministic code does what it's good at (geometry).

```
LLM:    group blocks into sections, assign importance & order,
        choose relative widths (full-width / two-up / sidebar)
  ↓
CODE:   measure each block at candidate widths/fonts,
        pack sections into pages, compute free space, score candidates
  ↓
LLM:    pick among scored candidates / explain / spot-fix
  ↓
CODE:   apply placements (live, one at a time → existing canvas_change events)
```

**Explicitly rejected:** having the LLM author a full multi-block coordinate plan as JSON and iterating on it (proposed in opinion-01). That re-introduces exactly the coordinate arithmetic the LLM is worst at and burns tokens/turns. The LLM authors **semantics and relative intent**; code authors **coordinates**.

We reach this in phases so each phase ships value independently and keeps the live UX.

---

## 5. Tooling Specification

All tools live in `LAYOUT_DESIGNER_TOOLS` / `runLayoutDesignerTool` in `src/sdk/tools.js`. They reuse the existing layout engine — no new geometry math is invented.

Available primitives already imported or trivially importable: `computeLayout`, `blockRectMm`, `colWidthMm`, `effectiveBaseStyle` (`src/lib/layout/index.js`); `GUTTER_MM=4`, `ROW_MM=5` (`src/lib/layout/units.js`); `canvasToRect`, `findNeighbors` (`src/sdk/spatial.js`); `anyOverlap`, `rectsOverlap` (`src/lib/polished/canvasUtils.js`).

`computeLayout(block, rect, ctx)` returns `{ lines, usedHeightMm, maxLines, linesRemaining, overflow }` — verified in `src/lib/layout/block.js` / `paragraph.js`. This is enough to build every tool below.

### 5.1 `measure_block_fit` — NEW (highest priority)

> Returns the footprint of a block at each column width, with a ranked recommendation. Does **not** mutate the canvas.

```
measure_block_fit(id: string, font?: FontName) →
{
  id, type, plaintextLength,
  options: [
    { colSpan, linesUsed, minRowSpan, area, aspectRatio, avgCharsPerLine, fitQuality }
    // one per colSpan in [1,2,3,4] (and per font if font omitted → sweep allowed fonts)
  ],
  recommended: { colSpan, rowSpan, font, reason }
}
```

**Implementation:** for each `colSpan`, build `virtualWidthMm = colSpan*cw + (colSpan-1)*GUTTER_MM`, run `computeLayout` against a tall virtual rect (`heightMm` very large so nothing truncates), read `lines.length` and `usedHeightMm`, derive `minRowSpan = ceil(usedHeightMm / ROW_MM)`. Rank per §3.1. (opinion-02's `estimate_block_layout` snippet is a correct starting point — `lo.usedHeightMm` exists — but extend it to sweep all widths and rank by the §3.1 ordering, not area alone. Remember to add `GUTTER_MM, ROW_MM` to the `tools.js` import.)

### 5.2 `read_canvas` — UPGRADE

Add a per-page free-space map so the agent stops rasterizing rects in its head.

```
read_canvas() → {
  pageCount,
  placedBlocks: [...existing...],
  unplacedBlocks: [...existing, but defaultSpans deprecated in favor of measure_block_fit...],
  pages: [
    {
      page,
      usedRows, emptyRows,           // compactness at a glance
      fillRatio,                     // usedCells / totalCells
      freeRects: [ {col,row,colSpan,rowSpan} ],   // maximal empty rectangles
      packingHints: [ "Page 1 free: 4-wide block from row 12–52", ... ] // NL, computed
    }
  ]
}
```

**Implementation note (honesty):** maximal-free-rectangle decomposition of an occupancy grid is real work, not a "simple scanner." Paint a `4 × maxRow` occupancy grid per page from placed rects (via `canvasToRect` cells), then extract maximal empty rectangles. `packingHints` must be **computed** from `freeRects`, not hardcoded. Natural-language hints are intentionally included because they read better to a weak model than raw rect arrays.

### 5.3 `evaluate_layout` — NEW (Phase 3)

> Scores the current page state (or a candidate) against §3.2. Gives the agent the numeric feedback loop it currently lacks.

```
evaluate_layout(page?: int) → {
  valid, score,
  penalties: [ { type, severity, page, block?, rows?, message } ],
  suggestions: [ { block, from:"P1 C0 R10 2×8", to:"P1 C0 R10 4×4", reason } ]
}
```

Operates on already-applied placements by default (fits the live UX). The agent calls it at checkpoints instead of, or in addition to, the page screenshot.

### 5.4 `get_page_screenshot` — NEW (replaces block screenshot for layout critique)

```
get_page_screenshot(page: int) → { status, page, screenshot_base64 }
```

`get_block_screenshot` stays for fine overflow/render checks, but page-level critique uses this. **Requires endpoint work:** `/api/screenshot` (`vite.config.js`) currently captures a single block element by `blockId`; add a page-capture mode that screenshots the page container. `browserScreenshotProvider` (`providers/browser.js`) passes a `page` param instead of `blockId`.

### 5.5 `place_block` — UPGRADE feedback

On success, additionally return the §3.1 economy fields for the placement just made (area, aspectRatio, utilization, fitQuality) so even single placements carry an economy signal, not just overflow.

### 5.6 `set_block_font` — unchanged
Keep as-is (including the content-wipe safety guard).

---

## 6. Prompt Changes (`getLayoutDesignerPrompt`)

1. **Delete the narrow defaults.** Remove "paragraph → 2×1 (use 4×1 if text is long)" and the rigid `DEFAULT_SPANS` guidance. Replace with:
   > Defaults are fallbacks only. For every text block, call `measure_block_fit` and choose the most economical *readable* option. Prefer 3–4 columns for prose, summaries, and any text over ~250 characters. Use 2 columns only for short facts, dates, contact info, or skills. **Never** place a paragraph as a tall-thin column.
2. **Encode the objective.** State the §3.1 ranking explicitly: readability band first, then minimize area, then minimize aspect ratio.
3. **Mandate measure-before-place.** The per-block pipeline becomes: `read_canvas` → `measure_block_fit` (compare widths) → `set_block_font` if needed → `place_block`.
4. **Checkpoint = evaluate + page screenshot**, not block screenshot. Every ~5 placements: call `evaluate_layout` and `get_page_screenshot`, fix penalties before continuing.
5. Keep: one `place_block` per turn (live UX), locked-block rules, "don't stop until complete."

---

## 7. Model

- **Layout planning:** upgrade from `gemini-3.1-flash-lite` to a stronger reasoning/vision model (Claude Sonnet class). Spatial reasoning + reading page screenshots demands it.
- **Cleanup/formatting** (e.g. the "Clean text" normalizer): cheap model is fine.
- Note: with §5 tools in place, even a mid model improves sharply — the tools carry the geometry. Model upgrade is high-value-low-effort but **not** a substitute for the tools.

---

## 8. Phased Rollout

| Phase | Scope | Ships | Effort |
|---|---|---|---|
| **P1 — Measure & re-prompt** | `measure_block_fit` (§5.1), prompt rewrite (§6.1–6.3), economy fields on `place_block` (§5.5), model upgrade (§7) | Kills the narrow-and-tall symptom directly; keeps current loop | ~1 day |
| **P2 — Perception** | `read_canvas` free-space map (§5.2), `get_page_screenshot` + endpoint (§5.4), checkpoint prompt (§6.4) | Agent can see gaps and whole pages | ~2–3 days |
| **P3 — Objective loop** | `evaluate_layout` scorer (§5.3) + penalty tuning | Numeric feedback; agent optimizes, not satisfices | ~2–3 days |
| **P4 — Hybrid packer** | deterministic section packer; LLM emits semantics → code packs → scorer ranks → LLM picks (§4) | Consistent, near-optimal layouts | ~1 week |

P1 alone is expected to resolve ~70% of the complaint.

---

## 9. Acceptance Criteria & Metrics

A layout run is "good" when, on a representative resume:

- **AC1.** ≥ 90% of paragraphs over 250 chars are placed at `colSpan ≥ 3`.
- **AC2.** No block has `aspectRatio > 2` unless it is a divider/headshot/sidebar by design.
- **AC3.** Page `fillRatio` ≥ 0.75 before a new page is started.
- **AC4.** `evaluate_layout` score ≥ 85 with zero hard fails.
- **AC5.** `place_block` rejection retries per run drop ≥ 50% vs current (measures less blind trial-and-error).
- **AC6.** Page count is ≤ the count a human would choose for the same content.

Instrument these by logging per-run: placements, retries, final per-page `fillRatio`, aspect-ratio distribution, `evaluate_layout` score.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Free-rect decomposition is fiddly and can be wrong | Unit-test against hand-built occupancy grids; start with row-band rectangles before full maximal-rectangle extraction |
| Page screenshot latency in the loop | Cache; only screenshot at checkpoints, not every placement; 30s timeout already exists |
| Scorer thresholds feel arbitrary | Ship thresholds as a tunable config object; calibrate on 5–10 real resumes |
| LLM ignores `measure_block_fit` and guesses anyway | Make the per-block report format require quoting the measured option; prompt forbids placing without a prior measurement |
| Token cost of measuring every block | `measure_block_fit` is a single deterministic call returning compact JSON; far cheaper than the current overflow-retry churn |

---

## 11. Open Decisions (need your call)

1. **Font sweep scope** in `measure_block_fit`: sweep all allowed fonts (more tokens, better choices) or only the current/Default font (cheaper)? Recommend: current font by default, full sweep on request.
2. **Phase 4 commitment:** do we want the full deterministic packer now, or stop at P3 (LLM + measurement + scorer) and see if quality is already sufficient?
3. **Accept/Deny + fonts:** current snapshot rolls back `canvas` but not `set_block_font` changes (noted in initial review). Fold font rollback into the snapshot as part of P1?

---

## Appendix — Reconciliation of source inputs

- **Initial review (Claude):** identified R1 (objective), R5 (per-block screenshot), R6 (labor split), R7 (model). Under-ranked measurement.
- **opinion-01:** strongest on the **scorer** (`evaluate_layout`, §5.3) and the semantics-vs-packing split (§4) — its unique, highest-value contribution. Caveat applied: we reject LLM-authored full-plan JSON.
- **opinion-02:** strongest on **shippable measurement code** (`estimate_block_layout` → our §5.1, verified against `computeLayout`'s real return shape) and the precise mechanism of R3. Caveat applied: its `read_canvas` "simple scanner" understates the real free-rect work; "area" ranking corrected to area-then-aspect-ratio.
- **Consensus across all three:** measurement tool, free-space map, fix defaults/prompt, hybrid architecture.
