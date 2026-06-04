# PRD: Polished Canvas View (Phase 2)
## NotionToCV — Grid-Based CV Layout Engine

---

## 1. What This Phase Builds

The right pane transforms from a placeholder into a live CV canvas. The user drags blocks from the Notion pane onto an A4 grid, positions them freely within a 4-column snap grid, resizes them, and downloads the result as a pixel-perfect PDF.

The core guarantee of this phase: **what you see on screen is byte-for-byte identical to what you download**. There is no separate "print view" or PDF template. The same HTML and CSS that renders on screen goes through Puppeteer unchanged.

---

## 2. How It Connects to Phase 1

Phase 1 (Notion pane) outputs a `blocks[]` array. Every block has a `canvas` field that is currently always `null`. Phase 2 writes to that field.

```js
// Before placement
{ id: 'b_abc', type: 'h2', content: [...], canvas: null }

// After user drops block onto the canvas
{ id: 'b_abc', type: 'h2', content: [...], canvas: { page: 1, col: 0, row: 4, colSpan: 4, rowSpan: 3 } }
```

The Notion pane never reads or modifies `canvas`. The polished pane never modifies `content` or `type`. The `id` is the only shared key.

---

## 3. The A4 Page and Grid System

### 3.1 Page Dimensions

Each CV page is a DOM element with fixed physical dimensions:

```css
.cv-page {
  width: 210mm;
  height: 297mm;
  position: relative;
  overflow: hidden;
  background: #ffffff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
```

No CSS transforms. No zoom. The page renders at its natural mm size in the browser. At 96 DPI, this is approximately 794px × 1123px — wide enough to be readable at any standard laptop screen width.

### 3.2 Page Padding

Adjustable via a slider in the polished pane toolbar. Default: **15mm**. Range: **10mm – 25mm**. When padding changes, all block positions update automatically because positions are stored as grid coordinates (relative to the content area), not absolute mm values.

### 3.3 The Grid

The content area inside the padding is divided into a fixed 4-column × N-row grid.

**Column math** (at default 15mm padding):
- Content width: 210mm − (2 × 15mm) = **180mm**
- Gutters: 3 gutters × 4mm = **12mm**
- Per-column width: (180mm − 12mm) / 4 = **42mm**

**Row math**:
- Row height: **5mm** (fixed, never changes regardless of padding)
- Content height: 297mm − (2 × 15mm) = **267mm**
- Number of rows: 267mm / 5mm = **53 rows**

**Grid cell positions** (CSS, calculated at render time):
```
left  = paddingMm + col * (42 + 4)mm          [col 0..3]
top   = paddingMm + row * 5mm                  [row 0..52]
width = colSpan * 42mm + (colSpan − 1) * 4mm
height= rowSpan * 5mm
```

When padding is not 15mm, the column width recalculates:
```
colWidth = (210mm − 2 × paddingMm − 3 × 4mm) / 4
```
Row height stays 5mm always.

### 3.4 Coordinate Storage

Block canvas positions are stored as integer grid coordinates:

```js
canvas: {
  page: Number,     // 1-indexed page number
  col: Number,      // 0-indexed column of top-left corner (0..3)
  row: Number,      // 0-indexed row of top-left corner (0..52)
  colSpan: Number,  // number of columns occupied (1..4)
  rowSpan: Number,  // number of rows occupied (1..N)
}
```

These are resolved to CSS mm values at render time. This means the position is padding-independent and survives padding changes correctly.

**Default span when a block is first dropped**: `colSpan: 2, rowSpan: 4` (84mm wide, 20mm tall — enough for a heading or two lines of text).

### 3.5 Coordinate Conversion During Drag

Since the page has no zoom transform, the browser's natural DPI mapping applies: 1mm ≈ 3.7795px at 96 DPI. When converting mouse pixel coordinates (relative to the A4 page div) to grid coordinates:

```js
const PX_PER_MM = 96 / 25.4;  // ≈ 3.7795

function pxToGrid(pxX, pxY, paddingMm) {
  const mmX = pxX / PX_PER_MM;
  const mmY = pxY / PX_PER_MM;
  const contentX = mmX - paddingMm;
  const contentY = mmY - paddingMm;
  const colWidth = (210 - 2 * paddingMm - 12) / 4;  // 42mm at default

  // Snap: find which column the x coordinate is in
  const col = Math.max(0, Math.min(3, Math.round(contentX / (colWidth + 4))));
  const row = Math.max(0, Math.min(52, Math.floor(contentY / 5)));
  return { col, row };
}
```

---

## 4. Multi-Page Logic

### Visibility Rule
- **Page 1**: always visible.
- **Page N+1**: visible only when page N has at least one placed block.

This means the canvas always shows exactly as many pages as needed. If the user removes all blocks from page 2, page 2 disappears.

### How the User Places Blocks on Page 2
The user simply drags a block from the Notion pane and drops it onto the Page 2 canvas area. Page 2 is always rendered below Page 1 in the scroll container, separated by a gap. Page 2 appears the moment the user hovers a dragged block over its area (show a ghost of the empty page during drag).

### Page Breaks in PDF
```css
.cv-page:not(:last-child) {
  page-break-after: always;
  break-after: page;
}
```

---

## 5. Block Placement — Full Lifecycle

### 5.1 Dragging from Notion Pane to Canvas

The `⠿` drag handle in the Notion pane already fires native HTML5 `dragstart`. On `dragstart`, the block's ID is written to `dataTransfer`:

```js
event.dataTransfer.setData('text/plain', block.id);
event.dataTransfer.effectAllowed = 'move';
```

The A4 page listens for `dragenter`, `dragover`, and `drop`.

**During `dragover`**:
1. Calculate grid coordinates from mouse position (Section 3.5).
2. Check if the default 2×4 span at those coordinates is unoccupied (no other placed block claims any of those cells).
3. Show a **snap ghost**: a semi-transparent blue rectangle the size of the default span, snapped to the grid. If the target cells are occupied, the ghost turns red.
4. Prevent default to allow drop.

**On `drop`**:
1. Read the block ID from `dataTransfer`.
2. Confirm no conflict (race condition guard).
3. Set `block.canvas = { page, col, row, colSpan: 2, rowSpan: 4 }`.
4. The block renders on the canvas immediately.

**If the block is already placed** (has a non-null canvas): dropping it again moves it to the new position (same as canvas-to-canvas drag, Section 5.2).

### 5.2 Moving a Placed Block on the Canvas

Each placed block has its own drag handle (`⠿`) in the top-left corner, visible on hover. Dragging it initiates a canvas-internal move:

1. `dragstart` on the block's handle: store block ID, store original canvas position, apply 0.4 opacity to the block.
2. `dragover` on the A4 page: show snap ghost at cursor-relative grid position.
3. Conflict detection: a move is only valid if no OTHER block occupies the target cells. The block's own current cells do not count as conflicts.
4. `drop`: update `block.canvas` with new `col` and `row`. Keep `colSpan` and `rowSpan` unchanged.
5. `dragend`: remove opacity.

### 5.3 Resizing a Placed Block

Each placed block has 8 resize handles: four edge midpoints and four corners. All are invisible until the block is hovered or selected.

Resizing snaps to the grid. Minimum size: `colSpan: 1, rowSpan: 1`. Maximum: fills remaining available cells.

**Resize drag behavior**:
- Dragging a right edge handle: changes `colSpan` only.
- Dragging a bottom edge handle: changes `rowSpan` only.
- Dragging a corner handle: changes both.
- Left and top edge handles also move the block's origin (`col`/`row`) while maintaining the opposite edge.

Conflict detection applies: a resize is not allowed if it would overlap another placed block. The ghost turns red to indicate this, and the resize snaps back on drop.

### 5.4 Overflow Warning

When a block's rendered text content is taller than its allocated height (`rowSpan × 5mm`), a **red border** appears on all four sides of the block. No text clips — the CSS is `overflow: visible` so text visually overflows (and will in the PDF). The red border is a warning only; the user must expand the block to contain the content.

Implementation: a `ResizeObserver` on the block's text container watches `scrollHeight`. When `scrollHeight > rowSpan × 5 × PX_PER_MM`, set `overflowing = true` on the block's local state.

The red border is hidden during PDF export (`@media print { .overflow-warning { border-color: transparent; } }`).

### 5.5 Selecting and Deleting a Block

Clicking a placed block (not dragging) selects it. A selected block shows:
- A solid blue border
- A small floating toolbar above it: `[⠿ move] [delete]`

Pressing `Delete` or `Backspace` while a block is selected removes it from the canvas (sets `block.canvas = null`). The block returns to the "unplaced" state in the Notion pane — it is not deleted from the blocks array.

Clicking anywhere outside a placed block deselects it.

---

## 6. Block Rendering on the Canvas

### 6.1 What Renders

Each placed block renders its `content` array (ProseMirror inline JSON) using a lightweight renderer — a Svelte component that walks the content array and outputs HTML with appropriate inline styles for marks (bold, italic, underline, strikethrough, color, font-family). This is not Tiptap — it is a read-only renderer.

```
block.content = [
  { type: 'text', text: 'Senior Product Manager', marks: [{ type: 'bold' }] }
]
→ <strong>Senior Product Manager</strong>
```

### 6.2 Template Styling

When a block renders on the canvas, it gets CSS classes from the active template based on its `type`. The template defines one style per block type. The inline marks from Notion sit on top of the template base style.

**The "Clean" Template** (the only template in Phase 2):

| Block Type | Font | Size | Weight | Color | Additional |
|---|---|---|---|---|---|
| `h1` | Inter | 20pt | 800 | #111111 | letter-spacing: -0.5pt, line-height: 1.15 |
| `h2` | Inter | 9.5pt | 700 | #111111 | uppercase, letter-spacing: 1.5pt, border-bottom: 0.75pt solid #111111, padding-bottom: 1.5mm |
| `h3` | Inter | 10pt | 600 | #111111 | line-height: 1.3 |
| `paragraph` | Inter | 9pt | 400 | #4b4b4b | line-height: 1.5 |

No accent color. No decorative elements. Pure typographic hierarchy.

The template styles are applied as a CSS class on the block wrapper: `.tmpl-clean.block-type-h1`, `.tmpl-clean.block-type-h2`, etc. Inline Notion marks (bold, color, font-family) override base template values where they conflict — they are more specific.

### 6.3 Block Wrapper CSS on Canvas

```css
.canvas-block {
  position: absolute;
  box-sizing: border-box;
  overflow: visible;
  /* left, top, width, height: set inline from grid coords */
}
.canvas-block.overflowing {
  outline: 1.5px solid #ef4444;
}
.canvas-block.selected {
  outline: 1.5px solid #2383e2;
}
@media print {
  .canvas-block { outline: none !important; }
}
```

---

## 7. The Polished Pane Shell

### 7.1 Layout

The polished pane is the right side of the split layout. It is a scrollable column with a grey (`#f1f5f9`) background. A4 pages are centered within it, stacked vertically with a 15mm gap between pages.

```
┌─────────────────────────────────────────────────┐
│  POLISHED VIEW           [padding: 15mm ──────]  │  ← toolbar
│  ─────────────────────────────────────────────   │
│                                                   │
│           ┌──────────────────────┐               │  ← Page 1 (210mm × 297mm)
│           │  ·  ·  ·  ·  ·  ·   │               │     grid overlay (faint)
│           │  [  block A      ]   │               │
│           │  [  block B  ]       │               │
│           └──────────────────────┘               │
│                                                   │
│           ┌──────────────────────┐               │  ← Page 2 (appears when needed)
│           │                      │               │
│           └──────────────────────┘               │
│                                                   │
└─────────────────────────────────────────────────┘
```

### 7.2 Grid Overlay

The grid is rendered as a visual overlay on the A4 page — faint dotted lines at every column boundary and every row boundary. Always visible in the browser so the user can plan block placement. Hidden in PDF via `@media print { .grid-overlay { display: none; } }`.

### 7.3 Toolbar

Fixed to the top of the polished pane. Contains:
- Label: "Polished View" (muted uppercase, same style as Notion pane)
- **Padding slider**: label "Page Padding", range 10–25mm, default 15mm, live update
- **Download PDF** button (right-aligned)

---

## 8. Unplaced Blocks Indicator

Blocks with `canvas: null` are "unplaced." In the Notion pane, unplaced blocks render normally with no special indicator.

In the polished pane, a small banner at the top of the scroll area shows: **"N blocks not yet placed"** (only visible when N > 0). This is informational only — not interactive. It tells the user how many Notion blocks haven't made it onto the CV yet.

No tray. No separate list. Just the count.

---

## 9. PDF Export — Puppeteer Pipeline

### 9.1 Why It Works

The A4 page uses real CSS `mm` units throughout. Block positions are stored as grid coordinates and rendered as `left: Xmm; top: Ymm` in CSS. Puppeteer renders the same HTML at the same DPI. There is no coordinate conversion between screen and print — they are identical by construction.

### 9.2 Export Mode

When the user clicks "Download PDF":
1. App navigates to `?export=true` (in dev: via Vite plugin endpoint; in production: via `print.cjs`).
2. `export=true` triggers a CSS class `.export-mode` on `<body>`.
3. Under `.export-mode`:
   - All UI chrome hidden: toolbar, divider, Notion pane, grid overlay, resize handles, drag handles, selected outlines, overflow red borders
   - Only `.cv-page` elements remain visible
   - `@page { size: A4; margin: 0; }` ensures Puppeteer uses the CSS page size
4. Puppeteer loads the URL, waits for `networkidle0`, emulates print media, calls `page.pdf({ preferCSSPageSize: true, printBackground: true })`.

### 9.3 Vite Plugin (Dev Mode)

Same pattern as the 247 resume — a Vite server middleware at `/api/print`:
1. Receives `?padding=15` (and any other params needed to restore state)
2. Puppeteer navigates to `http://localhost:{port}/?export=true&padding=15`
3. Returns PDF as `application/pdf` with `Content-Disposition: attachment`

**Critical**: The PDF endpoint must wait for fonts to load. Use `waitUntil: 'networkidle0'` to guarantee Google Fonts are applied before capture.

### 9.4 Production Build

`print.cjs` builds the dist, starts a local static server, navigates Puppeteer to each page variation, outputs PDFs. Same structure as 247 resume — no changes needed to the pattern.

---

## 10. Component Structure

```
/src/lib/polished/
  PolishedPane.svelte       — scroll wrapper, toolbar, page list, unplaced counter
  CvPage.svelte             — single A4 page: grid, placed blocks, drop zone
  CanvasBlock.svelte        — single placed block: renderer, drag handle, resize handles, selection
  BlockRenderer.svelte      — read-only inline content renderer (walks ProseMirror JSON)
  GridOverlay.svelte        — faint column/row lines, visible only during drag
  /templates/
    clean.css               — CSS variables and classes for the Clean template
```

---

## 11. Data Flow

```
App.svelte
  blocks = $state([...])          ← shared source of truth
  paddingMm = $state(15)          ← persisted to localStorage

NotionPane (reads/writes block.content, block.type)
  └── BlockEditor × N

PolishedPane (reads/writes block.canvas)
  └── CvPage × N (one per active page)
        └── CanvasBlock × M       (one per block where canvas.page === this page)
              └── BlockRenderer   (reads block.content, block.type — read only)
```

`CanvasBlock` is the only component that writes to `block.canvas`. It calls a single prop function `updateBlockCanvas(id, canvasPatch)` which lives in `App.svelte` and does:

```js
function updateBlockCanvas(id, patch) {
  const idx = blocks.findIndex(b => b.id === id);
  if (idx !== -1) blocks[idx] = { ...blocks[idx], canvas: patch };
}
```

---

## 12. Conflict Detection

Two blocks conflict if their grid cells overlap. A cell is identified by `(page, col, row)`. 

Before any placement or resize, check all target cells:

```js
function cellsOccupied(blocks, candidateId, page, col, row, colSpan, rowSpan) {
  for (const block of blocks) {
    if (!block.canvas || block.id === candidateId) continue;
    if (block.canvas.page !== page) continue;
    const c = block.canvas;
    const colOverlap = col < c.col + c.colSpan && col + colSpan > c.col;
    const rowOverlap = row < c.row + c.rowSpan && row + rowSpan > c.row;
    if (colOverlap && rowOverlap) return true;
  }
  return false;
}
```

If `cellsOccupied` returns true, the snap ghost is red and the drop is rejected.

---

## 13. localStorage

Two new keys added to the existing persistence:

```
notionToCV_paddingMm     — number (page padding in mm, default 15)
```

`block.canvas` is already persisted as part of `notionToCV_blocks` — no separate key needed.

---

## 14. What Is Out of Scope (Phase 2)

- Multiple template choices (only "Clean" ships)
- Template-specific column layouts or pre-set zones (pure free-form canvas only)
- Undo/redo for canvas operations
- Copying blocks on the canvas
- Block z-index / stacking order (no overlap → z-index is irrelevant)
- Guides, rulers, or alignment snapping beyond the grid
- Mobile layout

---

## 15. Open Questions (Deferred to Phase 3)

- When the user changes padding and a block overflows the page boundary, should it auto-move, be flagged, or be silently clipped?
- Should the grid overlay show column numbers and row numbers for precise placement?
- Should the Clean template expose per-block padding/spacing controls (e.g. space-before on an H2)?
- Multi-template support — same canvas format works, just swap the CSS file in `templates/`.
