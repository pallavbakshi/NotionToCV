# Product Requirements Document
## NotionToCV — Notion-Style Resume Builder

---

## 1. What We Are Building

NotionToCV is a two-pane web application that lets a user write their resume content freely in a Notion-style editor on the left, then visually place and arrange that content onto a polished CV layout on the right.

The central insight is the **separation of content from layout**. In most resume builders, you fill in forms with predefined fields — your job title goes here, your dates go there. That forces the user to think about layout while they are still trying to think about content. NotionToCV breaks that coupling entirely.

On the left, you write freely. You think in terms of ideas and words — not in terms of "work experience entry #2." On the right, you decide where things go on the page. Those are two different cognitive tasks, and this tool treats them as such.

---

## 2. The Two Panes

### Left Pane — The Notion Editor

A writing environment that is a direct clone of Notion's block editor. The user writes in blocks. Every paragraph, every heading, every line is its own independent block with a unique ID. The content in these blocks is what the user is authoring.

The Notion pane **owns content**. It does not know or care about layout.

### Right Pane — The Polished Canvas

A visual grid representing the CV page (A4). The user drags blocks from the Notion pane onto this canvas and positions them. They can arrange blocks into columns, reorder them, and assign them to different pages.

The Polished pane **owns layout**. It does not edit text.

### The Bridge

Every block carries a `canvas` field. When the field is `null`, the block exists only in the Notion pane — it has been written but not yet placed on the CV. When the field has a value, it stores the block's position on the canvas: which page, which column, what order.

This is the only data contract between the two panes. The Notion pane writes content into blocks. The polished pane reads those blocks and attaches canvas positions to them. Neither pane reaches into the other's domain.

---

## 3. Current Status

The project is starting fresh. There is a previous prototype at `/Users/pb/projects/twenty-four-seven-resume` which explored this idea but grew messy. The core problems with the prototype were:

- The editor used a single Tiptap instance for all blocks. This meant block boundaries were managed inside ProseMirror's document tree, which is the wrong abstraction for per-block isolation.
- CV layout concerns (font size in points, emoji prefixes, bullet style) leaked into the editor's data model as ProseMirror node attributes. Content and presentation were mixed again — the exact problem we set out to solve.
- The blocks array and the canvas drag-and-drop logic grew into a single 700-line App.svelte with no clean separation.

The new build starts clean with the right architecture from day one.

---

## 4. Tech Stack

- **Framework**: Svelte 5 with runes (`$state`, `$derived`, `$effect`, `$props`, `$bindable`)
- **Build tool**: Vite
- **Rich text**: Tiptap 3.x (`@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit` plus individual extensions)
- **Language**: JavaScript (no TypeScript)
- **Styling**: Scoped component CSS + `:global()` for Tiptap internals

---

## 5. Shared Data Model

This is the contract between the two panes. Define it once, never change the shape without updating both sides.

```js
// A single block
{
  id: String,         // stable unique ID, e.g. 'b_k3f9az'. Never changes after creation.
  type: String,       // 'paragraph' | 'h1' | 'h2' | 'h3'
  content: Array,     // ProseMirror inline content JSON — array of text nodes with marks
                      // e.g. [{ type: 'text', text: 'Hello', marks: [{ type: 'bold' }] }]
  canvas: Object|null // null = unplaced. When placed: { page: 1, column: 'main', order: 0 }
}
```

The `content` array is native ProseMirror JSON. It preserves inline formatting (bold, italic, underline, strikethrough, color, font family) without any custom encoding. When the right pane renders a block, it will use a lightweight renderer that walks this array.

### Content Array: Wrap/Unwrap Convention

`block.content` stores **only the inner inline array** — the children of the block node, not the block node itself. Tiptap operates on full ProseMirror documents, so there is a wrap/unwrap step at the boundary:

**Writing to Tiptap (on mount or type change):** Wrap `block.content` into a full document before passing to Tiptap:
```js
// 'h1' → heading level 1, 'h2' → level 2, 'h3' → level 3, 'paragraph' → paragraph
const nodeType = block.type === 'paragraph' ? 'paragraph' : 'heading';
const attrs    = block.type !== 'paragraph' ? { level: parseInt(block.type[1]) } : {};

editor.commands.setContent({
  type: 'doc',
  content: [{
    type: nodeType,
    attrs,
    content: block.content   // ← inject the stored inner array here
  }]
});
```

**Reading from Tiptap (on every `onUpdate`):** Extract only the inner content array back out:
```js
const docNode     = editor.state.doc;
const firstChild  = docNode.firstChild;            // the single top-level node
block.content     = firstChild.toJSON().content ?? [];
block.type        = firstChild.type.name === 'heading'
  ? `h${firstChild.attrs.level}`
  : 'paragraph';
```

This means `block.content` is always a plain serialisable array with no Tiptap or ProseMirror objects — safe to store in `localStorage` and easy to render in the right pane without importing Tiptap.

### localStorage Keys

```
notionToCV_blocks     — JSON.stringify(blocks[])
notionToCV_pageTitle  — plain string
notionToCV_paneWidth  — number (left pane width in px)
```

The `blocks` array lives in `App.svelte` as top-level reactive state:

```js
let blocks = $state([
  { id: 'b_initial', type: 'paragraph', content: [], canvas: null }
]);
```

It is passed into `NotionPane` as a bindable prop. The Notion pane mutates it directly on every keystroke, block creation, deletion, and reorder. It is persisted to `localStorage` on every change.

---

## 6. Application Structure

```
/src
  App.svelte                — root: two-pane layout shell, blocks[] state, localStorage sync
  app.css                   — global resets, fonts
  main.js                   — Svelte mount

  /lib
    NotionPane.svelte        — left pane shell: top bar, page title, block list
    BlockEditor.svelte       — single block: Tiptap instance, gutter, bubble menu, slash menu
    PolishedPane.svelte      — right pane (placeholder for now, canvas logic added later)
```

---

## 7. App.svelte Responsibilities

- Declares `blocks = $state([...])` with one empty paragraph as the default
- Renders the two-pane split layout (resizable divider between left and right)
- Persists `blocks` to `localStorage` on every change via `$effect`
- Restores `blocks` from `localStorage` on mount
- Passes `bind:blocks` into `NotionPane`
- Renders `PolishedPane` as a placeholder (grey background, centered text)

The split pane divider should be draggable. Left pane has a minimum width of 320px. Right pane has a minimum width of 400px.

The divider's position is persisted in `localStorage` under `notionToCV_paneWidth` and restored on mount. Default width: 480px. This means the user's workspace layout survives page reloads without any configuration UI needed.

---

## 8. NotionPane.svelte Responsibilities

- Receives `bind:blocks` from App
- Renders a top bar with: a small logo/label ("Notion View"), and Export JSON / Import JSON buttons
- Renders a large page title input (plain `<input>` or `<div contenteditable>`). Placeholder: "Untitled". This is cosmetic for now — stored in a separate `pageTitle` prop, not in `blocks`.
- Renders a `<BlockEditor>` for every entry in `blocks`, keyed by `block.id`
- Provides all block mutation callbacks down to each `BlockEditor`:
  - `addBlockAfter(index)` — inserts a new empty paragraph block at `index + 1`
  - `deleteBlock(index)` — removes block at `index`. **Invariant**: if deleting the last remaining block, do not leave the array empty — replace it with a fresh empty paragraph block instead and focus it.
  - `updateBlock(index, patch)` — merges a patch into the block at `index`
  - `moveBlock(fromIndex, toIndex)` — reorders the blocks array
  - `focusBlock(index)` — programmatically focuses the editor at a given index

### Empty State Invariant

The `blocks` array must **never be empty**. If a user deletes all content down to one block and then deletes that final block, `NotionPane` replaces it with a new empty paragraph block rather than allowing a zero-length array. This is enforced inside `deleteBlock`, not inside `BlockEditor`. The `BlockEditor` calls `deleteBlock` unconditionally — the safety check lives in one place.

---

## 9. BlockEditor.svelte — Full Specification

This is the most complex component. One instance per block. One Tiptap editor per instance.

### 9.1 Props

```js
let {
  block = $bindable(),   // the block object from blocks[]
  index,                 // this block's position in blocks[]
  isFirst,               // true if index === 0
  isLast,                // true if index === blocks.length - 1
  focusOnMount = false,  // if true, grab focus immediately on mount
  addBlockAfter,         // fn(index)
  deleteBlock,           // fn(index)
  updateBlock,           // fn(index, patch)
  moveBlock,             // fn(fromIndex, toIndex)
  focusBlock,            // fn(index)
} = $props();
```

### 9.2 Layout

```
┌─────────────────────────────────────────────────────┐
│ [gutter 48px] │ [block content, flex-1]              │
│               │                                      │
│   + handle    │  The Tiptap contenteditable lives    │
│   ⠿ handle    │  here. It has no border, no          │
│               │  background. Just text on white.     │
└─────────────────────────────────────────────────────┘
```

The gutter is always present in the DOM but its contents (+ button, drag handle) are invisible by default. They appear when the block row is hovered. They live in reserved space — they never push content to the right.

### 9.3 Tiptap Configuration

```js
StarterKit.configure({
  heading: { levels: [1, 2, 3] },
  bulletList: false,
  orderedList: false,
  listItem: false,
  blockquote: false,
  horizontalRule: false,
  codeBlock: false,
  code: false,
  hardBreak: false,
})
```

Plus: `Underline`, `TextStyle`, `Color`, `FontFamily`, `Placeholder`, `BubbleMenu`.

On mount, set the initial content from `block.content` and set the initial node type from `block.type`. If `block.content` is empty, the editor is empty.

On every `onUpdate`, write back to `block.content` (the ProseMirror content JSON of the first and only top-level node) and to `block.type` (derived from the current node type and heading level).

### 9.4 Keyboard Behavior

These are intercepted using Tiptap's `addKeyboardShortcuts` in a custom extension or via `editorProps.handleKeyDown`.

**Enter**
- If the selection is empty (just a cursor): split the current block at cursor position. Content before cursor stays in this block. Content after cursor becomes a new paragraph block inserted at `index + 1`. Call `addBlockAfter(index)` with the after-cursor content. Focus the new block.
- If text is selected: delete the selection, then behave as above.
- Never let ProseMirror insert a newline.

**Backspace**
- If the block is empty AND `index > 0`: call `deleteBlock(index)`. Focus the block at `index - 1`, placing cursor at the end.
- If the cursor is at position 0 of a non-empty block AND `index > 0`: merge this block's content onto the end of the block at `index - 1`. Call `deleteBlock(index)`. Focus the block at `index - 1` with cursor placed at the junction point.
- Otherwise: default ProseMirror behavior.

**Arrow Up**
- If the cursor is on the first line of the block AND at or near position 0: call `focusBlock(index - 1)` with cursor at end. Prevent default.
- Otherwise: default behavior.

**Arrow Down**
- If the cursor is on the last line of the block AND at or near the end: call `focusBlock(index + 1)` with cursor at start. Prevent default.
- Otherwise: default behavior.

**Tab**
- No-op for now. Prevent default to avoid focus jumping out of the editor.

### 9.5 Slash Command

**Trigger scope**: The slash command is only triggered when `/` is the **first character of the block** and the block has no other content before it. Mid-sentence slashes (e.g. `and/or`) do not trigger the menu. This is a deliberate simplification for MVP — it covers 95% of real usage and avoids the cursor-relative text replacement complexity of mid-block triggering.

**Trigger detection**: Use a custom Tiptap extension that watches `onUpdate`. When the full text content of the block matches `/^\/[a-z]*$/` exactly (a slash at position 0 followed by zero or more lowercase letters, nothing else), show the slash menu. When it no longer matches that pattern, hide it.

The filter text is everything after the `/`. For example, if the block contains `/head`, the filter is `head` and the menu shows only Heading 1, Heading 2, Heading 3.

**Menu appearance**: A small floating card anchored directly below the cursor position. Positioned absolutely in the DOM, not via Tippy — calculate position from `editor.view.coordsAtPos()`.

**Menu contents** (in this order):

| Icon | Label      | Description           | Keyword(s)       |
|------|------------|-----------------------|------------------|
| ¶    | Text       | Plain paragraph       | text, paragraph  |
| H1   | Heading 1  | Large section title   | h1, heading1     |
| H2   | Heading 2  | Medium heading        | h2, heading2     |
| H3   | Heading 3  | Small heading         | h3, heading3     |

**Filtering**: As the user types after `/`, the menu filters by keyword in real time. If nothing matches, close the menu and leave the text as-is.

**Keyboard navigation within the menu**:
- `ArrowDown` / `ArrowUp`: moves the highlighted item
- `Enter`: applies the highlighted item
- `Escape`: dismisses the menu, removes the `/` and any filter text, restores the cursor

**Applying a selection**: Clear the slash and filter text from the editor. Change the block type by calling `updateBlock(index, { type: selectedType })` and update the Tiptap node type to match. Close the menu.

### 9.6 Bubble Menu

Appears when the user has a non-empty text selection within the block. Implemented with Tiptap's `BubbleMenu` extension.

**Controls left to right:**

1. **Color swatch** — an `<input type="color">` with a styled overlay showing the letter "A" with an underline bar in the current color. Opens the native color picker. On change, applies `setColor()`.
2. **B** — bold toggle
3. **I** — italic toggle
4. **U** — underline toggle
5. **S** — strikethrough toggle
6. Visual separator
7. **Font family dropdown** — options: Default, Inter, Lora, Playfair Display, Space Grotesk, Fira Code, Outfit. On change, applies `setFontFamily()` or `unsetFontFamily()` for Default.
8. Visual separator
9. **Turn into ›** — a button that opens a small sub-panel (inline expansion below the bubble menu row) showing the same four block type options as the slash command. Selecting one changes `block.type` and updates the Tiptap node.

The bubble menu is a white card with a subtle border and shadow, 8px border-radius, no arrow/caret.

### 9.7 Drag Handle & Reordering

Uses **native HTML5 drag-and-drop** (`dragstart`, `dragover`, `dragleave`, `drop` events). No external drag library.

The drag handle (`⠿`, the six-dot braille character) in the gutter has `draggable="true"` set on it. The draggable element is the handle itself, not the whole block row.

**Drag start** (`dragstart` on handle): Store the dragged block's index in a `$state` variable in `NotionPane` (e.g. `dragFromIndex`). Set `event.dataTransfer.effectAllowed = 'move'`.

**Drag over** (`dragover` on block rows in `NotionPane`): Prevent default to allow drop. Calculate whether the cursor is in the top or bottom half of the target block to determine insert-before vs insert-after. Store the resulting drop target index in `dropTargetIndex` state in `NotionPane`.

**Insertion line**: `NotionPane` renders a single `<div class="drop-indicator">` element. Its `top` position is calculated from the DOM position of the gap at `dropTargetIndex`. It is `position: absolute`, 2px tall, full content width, blue (`#2383e2`). Hidden when no drag is in progress.

**Drop**: Call `moveBlock(dragFromIndex, dropTargetIndex)`. Reset `dragFromIndex` and `dropTargetIndex` to null.

**Drag end** (`dragend`): Always reset drag state, even if the drop was cancelled.

**Click (not drag)**: A click on the handle with no drag movement opens the block action menu (see 9.8). Distinguish from drag by checking whether `dragstart` fired before `mouseup`.

### 9.8 Block Action Menu

A small context menu that appears when the drag handle is clicked (not dragged). Positioned to the right of the handle.

**Options:**
- **Delete** — calls `deleteBlock(index)`
- **Duplicate** — inserts an identical copy of this block (new ID, same type + content) at `index + 1`
- **Turn into ›** — same type options as slash command

Close on: selecting an option, clicking outside, pressing Escape.

### 9.9 The `+` Button

Appears in the gutter above the drag handle on hover. Clicking it calls `addBlockAfter(index)` with an empty paragraph and focuses the new block.

---

## 10. Visual Design

### Philosophy
Invisible until needed. The interface should feel like a blank page. Controls appear only when the user is actively interacting with a specific block.

### Page Layout
- White background (`#ffffff`)
- Content centered horizontally, max-width 720px
- Left gutter: 48px (reserved for + button and drag handle)
- Top padding from the top bar to first block: 32px
- No bottom limit — document grows downward

### Typography

| Block Type | Font Size | Weight | Color    | Line Height |
|------------|-----------|--------|----------|-------------|
| Page title | 40px      | 700    | #37352f  | 1.2         |
| H1         | 30px      | 700    | #37352f  | 1.3         |
| H2         | 24px      | 700    | #37352f  | 1.35        |
| H3         | 20px      | 600    | #37352f  | 1.4         |
| Paragraph  | 16px      | 400    | #37352f  | 1.6         |

Font stack: `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`

### Font Loading

The optional bubble-menu fonts (Inter, Lora, Playfair Display, Space Grotesk, Fira Code, Outfit) are loaded via `<link>` tags in `index.html` — **not** via CSS `@import` in `app.css`. `@import` is render-blocking; `<link>` in the `<head>` allows parallel loading and supports `rel="preconnect"` for the Google Fonts domain.

```html
<!-- index.html <head> -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Inter:wght@400;500;600;700&family=Lora:ital,wght@0,400;0,700;1,400&family=Outfit:wght@400;600;700;800&family=Playfair+Display:ital,wght@0,700;1,400&family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
```

The editor's default body font (`ui-sans-serif` stack) requires no loading — it resolves to the system font.

### Block Spacing
No margin between blocks. Each block has `4px` top and bottom padding only. The visual spacing comes from the line-height and padding — not from margin. This matches how Notion compresses content.

### Placeholders
- Page title: *"Untitled"* in `rgba(55,53,47,0.25)`
- H1 block: *"Heading 1"*
- H2 block: *"Heading 2"*
- H3 block: *"Heading 3"*
- Empty paragraph (first block only): *"Type '/' for commands"*
- Empty paragraph (any other block): *"Type '/' for commands"* — same, shown on focus only

### Gutter Controls (visible on row hover)
- `+` button: 18px, grey, no border, rounded. Tooltip: "Add block below"
- Drag handle `⠿`: 16px, `rgba(55,53,47,0.35)`, `cursor: grab`
- Both positioned in the 48px gutter, vertically centered with the block's first line

### Bubble Menu
- Background: `#ffffff`
- Border: `1px solid rgba(55,53,47,0.12)`
- Border radius: `8px`
- Box shadow: `0 4px 16px rgba(0,0,0,0.12), 0 0 0 1px rgba(15,15,15,0.05)`
- Button size: `28px × 28px`, `border-radius: 4px`
- Active state (formatting on): `background: rgba(35,131,226,0.12)`, `color: #2383e2`
- Hover state: `background: rgba(55,53,47,0.07)`

### Slash Menu
- Same card style as bubble menu
- Min-width: 260px
- Each item: 36px tall, icon on left (24px square, light grey background), name in dark, description in muted grey
- Highlighted item: `background: rgba(55,53,47,0.06)`

### Top Bar (NotionPane)
- Height: 44px
- Border bottom: `1px solid rgba(55,53,47,0.09)`
- Left: small text label "Notion View" in muted uppercase, 11px, letter-spaced
- Right: "Export JSON" and "Import JSON" pill buttons

### Drag Insertion Line
- 2px, `#2383e2` (Notion blue)
- Full width of content area
- Appears between blocks, not inside them

---

## 11. What Is Explicitly Out of Scope (This Phase)

The following will be built in a future phase. Do not design for them now, but do not make architectural choices that would break them later.

- The right pane / polished canvas
- Block types beyond paragraph and H1/H2/H3 (no bullet lists, no toggles, no dividers, no images, no code blocks, no quotes)
- Nested blocks / indentation
- Keyboard shortcuts to change block type (e.g. `##` space for H2) — slash commands only
- Emoji prefixes on blocks
- Real-time collaboration
- User accounts or cloud save
- PDF export

---

## 12. What the Notion Pane Must Output (Contract for Phase 2)

When the polished pane is built, it will read the `blocks[]` array directly. The Notion pane must guarantee:

1. Every block has a stable `id` that never changes after creation, even after reordering.
2. `content` is always valid ProseMirror inline content JSON. Never null. Empty block = `[]`.
3. `type` is always one of the four valid values.
4. `canvas` is always `null` (the polished pane will write to it; the Notion pane must never touch it once set).
5. Block order in the array matches the visual order in the editor at all times.

---

## 13. Resolved Implementation Decisions

These questions were raised during review and are now answered here definitively so they do not need to be re-litigated during implementation.

---

**Q1: Does `block.content` store only the inner inline array or the full ProseMirror node?**

Only the inner array. `block.content` is `[{ type: 'text', text: '...' marks: [...] }]` — not the wrapping `{ type: 'paragraph', content: [...] }` node. When initialising a Tiptap editor, wrap it into a full doc node. When reading back on `onUpdate`, unwrap it. Full pattern documented in Section 5.

This keeps the stored data minimal, portable, and renderable without Tiptap.

---

**Q2: Should the slash command trigger regex support spaces (i.e. trigger after a space mid-line)?**

No. MVP scope: slash command only triggers when `/` is the first character of the block and nothing precedes it. The regex `/^\/[a-z]*$/` is correct and intentional. Mid-sentence slash triggering is deferred. Full rationale in Section 9.5.

---

**Q3: Should drag-and-drop use a library or native HTML5 events?**

Native HTML5 drag-and-drop only. `dragstart`, `dragover`, `dragleave`, `drop`, `dragend`. No external library. This is a simple vertical list reorder — a library would add more surface area than value. Full implementation spec in Section 9.7.

---

**Q4: Should Google Fonts load via CSS `@import` or via `<link>` in `index.html`?**

Via `<link>` in `index.html` with `rel="preconnect"`. CSS `@import` is render-blocking. The exact `<link>` tag is specified in Section 10 (Font Loading).

---

**Q5: Should the split pane divider position be persisted?**

Yes. Persisted to `localStorage` under `notionToCV_paneWidth`. Restored on mount. Default: 480px. Specified in Section 7.

---

**Q6: Should the block list ever be allowed to reach zero blocks?**

Never. The `deleteBlock` function in `NotionPane` enforces this invariant: if the last block is deleted, a new empty paragraph block is created in its place rather than leaving the array empty. This is enforced in one place (`NotionPane.svelte`) and `BlockEditor` does not need to know about it. Full spec in Section 8.

---

## 15. Open Questions (Deferred)

These do not block Phase 1 but should be answered before Phase 2 starts:

- When a block is dragged from the Notion pane onto the polished canvas, does it visually disappear from the Notion pane, fade, or stay visible with a placement indicator?
- Can a placed block be edited from the polished pane directly, or only from the Notion pane?
- When a block is deleted from the Notion pane after it has been placed on the canvas, what happens to its canvas placement?
- Does the polished pane render inline formatting (bold, color, font) from the block's `content`, or does it apply its own template-level styling on top of plain text?
