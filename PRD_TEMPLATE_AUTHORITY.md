# PRD — Layout Engine as Sole Rendering Authority (Remove Custom CSS)

**Status:** Draft v2 (direction confirmed)
**Owner:** _tbd_
**Created:** 2026-06-06
**Related:** `PRD_AGENT.md`, `specs/layout-engine/*`

---

## 1. Summary

Custom (imported) templates currently inject a **raw CSS string** into the DOM (`<style id="custom-template-styles">`) that styles the block wrapper `<div>`s. The PDF renderer never sees this CSS, so anything it paints (borders, backgrounds, alignment) appears on screen but not in print, and renders differently across browsers. The "orange section underline" bug was an instance of this leak.

**Decision:** stop treating templates as stylesheets. The layout engine becomes the **single rendering authority** for screen (SVG) and print (PDF). The work is mostly **deletion**:

- **Geometry** is always **ours** — the user picks a built-in template (`clean` / `compact` / `elegant` / `modern`). There is no imported geometry.
- **Color, font, and page background** come from **`themeColors`**, edited via the existing per-block-type pickers (`PolishedPane.svelte`, `svelte-awesome-color-picker`).
- **Import** carries **text → blocks** and **seeds a suggested color palette** into `themeColors` (fully user-overridable). _(Confirmed: "Text + seeded palette".)_
- **Custom CSS is removed entirely** — no injection, no `parseCustomTemplate`, no `customTemplates` raw-CSS storage.

The single **additive** change: the engine/PDF must render the **page background color** (today it is DOM-only, so a colored page would export white).

**Outcome:** screen and print are pixel-identical, deterministic across browsers, and an entire class of "wrapper CSS leak" bugs becomes impossible.

---

## 2. Background / Current Architecture

### 2.1 Rendering paths (as built)

```
                    ┌── computeLayout ──▶ renderBlockSVG ──▶ {@html svg}   (screen, primary)
block + template ──▶│
                    ├── computeLayout ──▶ renderResumePDF  ──▶ PDF          (print)
                    └── (fonts not ready yet) ─▶ BlockRenderer DOM           (screen, fallback)
```

- `CanvasBlock.svelte:59-73` — `blockLayout = computeLayout(...)` → `svgContent = renderBlockSVG(...)`; renders `{@html svgContent}`, else `<BlockRenderer>` fallback.
- The SVG lives inside `<div class="block-content-container tmpl-{template} block-type-{type}">`.

### 2.2 The two `<style>` injections (`App.svelte`)

| `<style>` id | Source | Role today | Fate |
|---|---|---|---|
| `custom-template-styles` (`316-332`) | raw custom CSS, verbatim | styles wrapper div (the **leak**) | **DELETE** |
| `theme-color-overrides` (`334-395`) | `themeColors` → CSS vars + `!important` color/font/bg | colors the DOM fallback + page bg | **SLIM** (keep vars + `.cv-page` bg; drop dead rules like `border-color`) |

### 2.3 What already supports this direction

- `themeColors` (`App.svelte:44-54`) already has per-type **color** (`h1/h2/h3/text`), **`backgroundColor`**, and per-type **font**.
- Editing UI already exists (`PolishedPane.svelte` ColorPicker + preset palettes `104-142`).
- The engine already resolves color + font from `themeColors` (`fonts.js:effectiveBaseStyle`); built-in geometry lives in `template-metrics.js BUILT_IN`.

### 2.4 What goes away

- `parseCustomTemplate` (`template-metrics.js:277-375`) and its callers in `getTypeStyle` (`387-394`).
- `customTemplates` as a live style source (storage may persist for migration only — see §6).
- All border/background/alignment from raw CSS (none of it was ever in the PDF).

---

## 3. Goals & Non-Goals

### 3.1 Goals

- **G1.** Layout engine (SVG + PDF) is the **only** visual renderer. No template CSS injected into the DOM.
- **G2.** Geometry is selected from **built-in templates** only.
- **G3.** Color, font, **and page background** come from `themeColors`; changing them re-renders screen **and** PDF identically.
- **G4.** Import = text → blocks + **seeded palette** into `themeColors` (overridable).
- **G5.** Screen and PDF are visually identical for any document; output is cross-browser deterministic.
- **G6.** Existing saved resumes (built-in **and** custom-template) keep rendering with no user action (see migration §6).
- **G7.** No-auto-underline preserved; user `underline` mark still works.

### 3.2 Non-Goals

- Rebuilding the import/conversion pipeline (only its *output contract* changes: text + palette, no CSS).
- A general CSS engine. We model a fixed, documented property set only.
- Changing the canvas grid / block placement model.
- Agent tool contract changes (`PRD_AGENT.md`).
- Per-block arbitrary alignment from import (alignment is **not** imported; geometry is ours).

---

## 4. Proposed Architecture

> A template is a **geometry preset** (ours). A document's look = chosen geometry preset + `themeColors` (palette/fonts/page-bg). Import produces **text + a seeded palette**, never CSS.

```
import ─▶ { blocks(text), palette }
                 │            │
                 ▼            ▼
              blocks      themeColors (user-editable)
                 │            │
   built-in geometry preset ──┴──▶ computeLayout ──▶ SVG (screen) + PDF (print)   ← identical
```

### 4.1 Changes

**C1 — Delete raw custom-CSS injection.** Remove the `custom-template-styles` effect (`App.svelte:316-332`).

**C2 — Make the wrapper inert.** `.block-content-container` contributes zero visual styling (transparent, no border, no layout-affecting padding). Add a guard so a stray border/background can never paint.

**C3 — Remove the engine's custom-template parse path.** Drop `parseCustomTemplate`; `getTypeStyle` returns built-in metrics for the active template. (Keep the `BUILT_IN` presets.)

**C4 — Import outputs text + palette.** `handleNewImport` / `handleEditImport` (`App.svelte:628-660`) stop accepting/applying `css`; instead they receive/derive a **palette** and merge it into `themeColors`. The import's color extractor lives at the import boundary, not in the renderer.

**C5 — Render page background in the engine.** Add `backgroundColor` (from `themeColors`) to the engine inputs; `render-pdf.js` fills each page rect with it before drawing; `render-svg.js` / `.cv-page` continues to show it on screen. This is the only additive feature.

**C6 — Slim `theme-color-overrides`.** Keep CSS-variable defs + `.cv-page` background/color (for the brief DOM fallback + page chrome). Remove now-dead rules (e.g. `border-color: var(--cv-h2-color)` at `App.svelte:376`).

**C7 — DOM fallback (fonts-loading window).** Drive `BlockRenderer` from CSS variables (color + font) only — no template CSS, no borders/backgrounds. Fonts are local/vendored (load in ms), so the pre-SVG flash is neutral and brief.

---

## 5. Requirements

### 5.1 Functional

- **F1.** Screen SVG and exported PDF are visually identical for any document (glyphs, colors, fonts, spacing, **page background**).
- **F2.** No `<style id="custom-template-styles">` exists in the DOM; no `parseCustomTemplate` in the build.
- **F3.** Editing any `themeColors` slot (incl. `backgroundColor`) re-renders screen and PDF consistently.
- **F4.** Import populates blocks (text) and seeds `themeColors`; user can override every slot afterward.
- **F5.** No wrapper renders a border/background/shadow absent from the PDF.
- **F6.** No template auto-underline; user `underline` mark renders on screen + PDF.
- **F7.** Loading a pre-change resume (built-in or custom) renders correctly (see §6).

### 5.2 Non-functional

- **NF1.** No keystroke→render latency regression (we remove a style recompute).
- **NF2.** Deterministic across Chromium / Firefox / WebKit.
- **NF3.** No new dependencies.

---

## 6. Migration / Backward Compatibility

Existing resumes persist `customTemplates` as raw CSS and a `templateName` referencing the custom id. After C3 there is no custom-geometry renderer, so:

- **M1 — Geometry remap.** On load, if `templateName` is a custom id, remap it to a built-in preset. Default: `clean`. (Optional: pick the built-in whose metrics are closest to the parsed custom geometry, computed once at migration.)
- **M2 — Palette backfill.** If `themeColors` is missing slots (older imports that relied on CSS color), derive the palette **once** from the stored custom CSS at migration and write it into `themeColors`. After that, the raw CSS is never read again.
- **M3 — Drop raw CSS.** After M1+M2, the persisted `customTemplates` CSS string is obsolete; may be removed from storage on next save (non-blocking).
- **M4 — One-time, idempotent.** Migration runs on load, is safe to re-run, and never blocks rendering.

> Acceptable trade-off: a migrated custom resume adopts a built-in geometry. Per product direction, geometry is ours; this is intentional. Colors/fonts/page-bg are preserved via the palette backfill.

---

## 7. Risks & Mitigations

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R1 | Migrated custom resume shifts geometry (spacing/sizes) vs. its old look. | Medium | M1 closest-match remap; communicate that geometry is now preset-based. Visual spot-check on real saved resumes. |
| R2 | Older import didn't capture full palette → colors change after migration. | Medium | M2 one-time palette backfill from the stored CSS. |
| R3 | Page background in PDF mismatches screen (color space / full-bleed). | Low | C5: fill exact page rect with the same hex→rgb path used for text; golden-image diff. |
| R4 | DOM fallback flash differs from SVG. | Low | C7: variables-only fallback; fonts load in ms. Optionally gate on fonts-ready. |
| R5 | Something still references `custom-template-styles` / `parseCustomTemplate`. | Low | Grep + remove all consumers; build must be clean. Template gallery previews use built-in stylesheet imports, not the custom injection — verify. |

---

## 8. Acceptance Criteria / Validation

- **A1.** DOM: no `#custom-template-styles`; wrapper computed style shows `border:0`, `background:transparent`.
- **A2.** Golden-image diff: same document → screen SVG snapshot vs PDF→raster, pixel parity within tolerance, **including a non-white page background**.
- **A3.** Underline repro: template renders no rule on screen/PDF; `underline` mark shows on both.
- **A4.** Cross-browser: A2 passes on Chromium, Firefox, WebKit.
- **A5.** Migration: load N pre-change resumes (≥1 built-in, ≥2 custom); render succeeds, palette preserved, geometry = a built-in preset, no console errors.
- **A6.** Import: a sample import yields text blocks + a seeded `themeColors`; every slot is user-overridable and reflected in SVG + PDF.
- **A7.** `npm run build` clean; no layout-engine warnings.

---

## 9. Phasing

1. **Phase 1 — Kill the leak (low risk, immediate).** C1 + C2 + C6. Verify A1, A3, A7. Removes the bug class on its own.
2. **Phase 2 — Page background in engine.** C5. Verify A2 (with colored bg), R3.
3. **Phase 3 — Remove custom-template machinery.** C3 + C4 (import → text + palette). Verify F2, F4, A6.
4. **Phase 4 — Migration.** M1–M4. Verify A5.
5. **Phase 5 — Fallback fidelity.** C7. Verify A2/R4.

---

## 10. Out of Scope

- The import/conversion engine that authors text + palette (only its output contract is fixed here).
- New template-authoring UI.
- Structured-template storage redesign beyond M3.
- Agent tool contract changes.
