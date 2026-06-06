# SVG whitespace rendering in the layout engine

## The problem

The layout engine (`src/lib/layout/`) computes per-glyph absolute x-positions for every glyph, including spaces. The SVG renderer emits a `<text>` element with an `x` attribute listing one position per glyph:

```svg
<text x="0 3 5 7 10 13 15 ...">Hello   World</text>
```

Browsers **collapse consecutive whitespace** in SVG `<text>` elements by default. Three spaces between "Hello" and "World" collapse to one, so the browser renders 13 characters against 15 x-values — every subsequent glyph shifts leftward by 2 positions.

The engine's contract is: **one glyph = one x-value = one rendered character**. Any whitespace collapsing breaks that invariant.

## Approach A: Preserve whitespace (current)

Tell the browser to preserve all whitespace exactly.

```svg
<svg ... xml:space="preserve">
  <text x="..." style="white-space:pre;...">Hello   World</text>
</svg>
```

**Changes to `render-svg.js`:**
1. `xml:space="preserve"` on root `<svg>` elements (both text and passthrough paths)
2. `white-space:pre` in the `<text>` element's CSS `style` attribute
3. Single-line emit — no newlines between `<text>` tag and text content (formatting whitespace would become real characters under `xml:space="preserve"`)

**Pros:**
- Faithful 1:1 rendering of the engine's glyph stream
- Space characters exist in the DOM, match the glyph count exactly
- Underline/strikethrough decorations use per-glyph coordinates (unaffected)

**Cons:**
- Depends on browser whitespace behavior (xml:space + white-space:pre)
- Fragile to formatting changes (adding a newline inside `<text>` breaks it)
- Three separate changes to coordinate (SVG root, text style, emit format)

## Approach B: Skip whitespace glyphs (proposed alternative)

Do not emit space characters into SVG `<text>` at all. Spaces are invisible — their only job is horizontal offset, and the layout engine already baked that offset into the **next visible glyph's** x-position.

```
Input:  "Hello   World"
Glyphs: H(0) e(3) l(5) l(7) o(10) ␣(13) ␣(15) ␣(17) W(20) o(22) r(24) l(26) d(28)
SVG:    <text x="0 3 5 7 10 20 22 24 26 28">HelloWorld</text>
```

The space glyphs are omitted from both the x-list AND the character content. "W" is still at x=20mm — its position already accounts for the three preceding spaces.

**Changes to `render-svg.js`:**
1. In the glyph loop, skip glyphs where `g.char` is whitespace (don't push to x-list or glyphs array)
2. Remove `xml:space="preserve"` and `white-space:pre` (no longer needed)
3. Single-line emit can stay or revert — no whitespace sensitivity

**Pros:**
- Zero dependency on browser whitespace rendering behavior
- No `xml:space` / `white-space:pre` attributes needed
- Can't break from formatting changes (newlines inside `<text>` don't matter)
- Smaller SVG output (fewer characters)

**Cons:**
- Changes the SVG content (spaces are absent from the DOM)
- If a future consumer reads the SVG text content character-by-character, the space gap won't be visible — but the x-list explicitly encodes it
- Underline/strikethrough decorations are unaffected (they use per-glyph `<line>` elements, not `<text>` content)
- Faux-bold overprint is unaffected (it maps over the padded x-list, which no longer includes spaces — spaces are invisible, overprinting them adds nothing)

## Comparison

| | Approach A (current) | Approach B (skip) |
|---|---|---|
| Browser whitespace dependency | Depends on `xml:space` + `white-space:pre` | None |
| Number of attributes changed | 2 (xml:space, white-space:pre) | 0 |
| Formatting fragility | Single-line emit required | No restriction |
| SVG text content | Exact glyph stream | Visible glyphs only |
| Underline/strike | Unaffected | Unaffected |
| PDF output | Unaffected | Unaffected |
| Faux-bold overprint | Unaffected | Unaffected |

## Current state

Approach A is implemented and working. All phase tests pass. The text that originally exposed the bug (multiple consecutive spaces) renders correctly.

Approach B has not been applied. It would replace Approach A's three changes with a single change in the glyph loop.
