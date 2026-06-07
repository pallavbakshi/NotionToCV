## Short answer

You’re mostly missing **layout measurement + scoring tools**, not just a better prompt.

Right now the Layout Designer agent is being asked to do spatial optimization with only:

- `read_canvas`: “what exists?”
- `place_block`: “try this placement and tell me if it overflows/overlaps”
- `set_block_font`
- `get_block_screenshot` of one block

That makes the agent behave like a **greedy trial-and-error placer**. It does not have enough structured information to choose economical widths/heights, compare alternatives, or optimize whitespace globally.

The prompt can improve behavior, but the core issue is: **the agent has no layout oracle or objective function.**

---

## What’s missing

### 1. A fit/measurement tool for candidate spans

Your `place_block` tool only reports fit **after** placement:

```js
Content: 3/4 lines used
```

But before choosing a placement, the agent does not know:

- How many lines this block would take at `2` columns vs `3` columns vs `4` columns.
- Whether `2×4`, `3×3`, or `4×2` is more economical.
- How different fonts affect wrapping.
- What rowSpan is minimally required.

So it guesses.

You need a tool like:

```txt
measure_block_fit(id, font?)
```

Return something like:

```json
{
  "id": "summary",
  "type": "paragraph",
  "plaintextLength": 420,
  "options": [
    {
      "colSpan": 2,
      "font": "Inter",
      "linesUsed": 9,
      "minRowSpan": 9,
      "area": 18,
      "fitQuality": "too_tall"
    },
    {
      "colSpan": 3,
      "font": "Inter",
      "linesUsed": 6,
      "minRowSpan": 6,
      "area": 18,
      "fitQuality": "good"
    },
    {
      "colSpan": 4,
      "font": "Inter",
      "linesUsed": 4,
      "minRowSpan": 4,
      "area": 16,
      "fitQuality": "best"
    }
  ],
  "recommended": {
    "colSpan": 4,
    "rowSpan": 4,
    "font": "Inter",
    "reason": "Lowest area with readable line length"
  }
}
```

You already have everything needed to implement this with:

- `computeLayout`
- `blockRectMm`
- `colWidthMm`
- `ROW_MM`
- `effectiveBaseStyle`

The LLM should not be estimating line wrapping from character count. Your deterministic layout engine should do it.

---

### 2. A free-space / available-rectangles tool

`read_canvas` currently returns placed and unplaced blocks, but not an actual free-space map.

The prompt claims:

> Returns occupied cells

But the implementation returns only:

```js
placedBlocks.push({
  id,
  type,
  name,
  locked,
  canvas,
  plaintext
});
```

The model has to mentally infer gaps.

Add this to `read_canvas`:

```json
{
  "pages": [
    {
      "page": 1,
      "occupied": [...],
      "freeRects": [
        { "col": 0, "row": 12, "colSpan": 4, "rowSpan": 6 },
        { "col": 2, "row": 25, "colSpan": 2, "rowSpan": 8 }
      ],
      "largestFreeRects": [...],
      "usedRows": 34,
      "emptyRows": 19
    }
  ]
}
```

The agent needs to know:

- Where the largest holes are.
- Which rectangles can fit a block.
- Whether a page is already fragmented.
- Whether placing a long paragraph in `2` columns would create a tall skinny block that ruins the page.

Without this, it will waste space.

---

### 3. A layout scoring/evaluation tool

“Economical” is not currently defined anywhere as a computable objective.

The agent sees rules like:

> Leave 1–2 row gaps  
> Fill page 1 first  
> Do not waste space

But those are fuzzy.

You need a scoring tool:

```txt
evaluate_layout(plan)
```

Given a proposed list of placements, return:

```json
{
  "valid": true,
  "score": 82,
  "penalties": [
    {
      "type": "excess_vertical_gap",
      "page": 1,
      "rows": 6,
      "message": "Large unused gap between @summary and @experience"
    },
    {
      "type": "poor_aspect_ratio",
      "block": "@summary",
      "message": "Long paragraph placed as 2-col x 8-row. 4-col x 4-row uses less area."
    }
  ],
  "suggestions": [
    {
      "block": "@summary",
      "from": "P1 C0 R10 2×8",
      "to": "P1 C0 R10 4×4"
    }
  ]
}
```

A simple score could include penalties for:

| Penalty | Why |
|---|---|
| Overflow | Hard fail |
| Overlap | Hard fail |
| Extra pages | Large penalty |
| Large vertical gaps | Waste |
| Tall skinny paragraphs | Poor economy/readability |
| Orphan headings | Bad structure |
| Section split across pages | Bad continuity |
| Misaligned paired columns | Visual imbalance |
| Very low line utilization | Block too wide/tall |
| Very high line utilization | Too cramped |

Right now the LLM has no numeric feedback loop other than “overlap/overflow”.

---

### 4. A plan-first workflow

Your prompt says:

> ONE `place_block` per turn. Never batch.

This causes greedy placement.

Greedy placement is exactly why you get bad global layouts. Once early blocks are placed poorly, later blocks have to work around them.

Better flow:

1. `read_canvas`
2. `measure_block_fit` for all unplaced blocks
3. Build a full proposed plan
4. `evaluate_layout(plan)`
5. Revise plan
6. Apply placements one by one, or call `apply_layout(plan)`

You can still animate placements live, but the agent should **plan globally before mutating**.

Suggested tools:

```txt
draft_layout_plan(scope)
evaluate_layout_plan(plan)
apply_layout_plan(plan)
```

If you want to preserve your current live-building UX, the agent can do:

```txt
read_canvas
measure all
evaluate plan
place_block first
place_block second
...
```

But the important part is: **do not let the first `place_block` happen before the agent has compared alternatives.**

---

### 5. Page-level screenshot, not just block screenshot

`get_block_screenshot(id)` helps with overflow and rendering, but it does not show page balance.

Your prompt says:

> Check for overflow, alignment, spacing, and overall visual balance.

But the tool only screenshots one block. The agent cannot visually inspect:

- Page-level whitespace
- Column balance
- Alignment between blocks
- Whether page 1 looks cramped and page 2 sparse
- Whether sections visually group well

Add:

```txt
get_page_screenshot(page)
```

or:

```txt
get_canvas_screenshot(page)
```

Return a full page image. This matters much more for layout quality than individual block screenshots.

---

## The biggest architectural recommendation

Use the LLM for **semantic planning**, not rectangle packing.

The LLM is good at:

- “These blocks belong to the Experience section.”
- “This is a contact block.”
- “This paragraph is a summary and should be prominent.”
- “These two education items can sit side-by-side.”
- “This heading should start a section.”

The deterministic code should handle:

- Measuring text
- Choosing minimal rowSpan
- Finding free rectangles
- Packing blocks
- Scoring gaps
- Preventing bad aspect ratios

A strong architecture would be:

```txt
LLM:
  classify blocks into sections
  assign importance
  suggest layout intent

Code:
  measure each block at candidate widths/fonts
  pack sections into pages
  score candidate layouts
  return best options

LLM:
  choose between best options / explain result

Code:
  apply placements
```

Right now the LLM is doing both semantic reasoning and low-level packing. That is why quality is inconsistent.

---

## Prompt issues too, but secondary

Your prompt can be improved. It currently says:

> paragraph → 2×1 default  
> use 4×1 if text is long

That encourages too many two-column placements.

You need more explicit heuristics:

```txt
Width selection rules:
- Never place a paragraph as 2 columns if it needs more than 4 rows.
- Prefer 3 or 4 columns for paragraphs over 250 characters.
- Prefer 4 columns for summaries, profile sections, and long descriptions.
- Use 2 columns only for short facts, dates, contact info, skills chunks, or compact bullets.
- RowSpan must be the minimum rowSpan that fits, plus at most 1 row of breathing room.
- If 2-col and 4-col have the same area, prefer the one with better section balance.
- Do not leave gaps larger than 2 rows unless preserving section separation.
```

Also:

```txt
Before placing any paragraph:
1. Measure it at colSpan 2, 3, and 4.
2. Choose the option with the best area/readability score.
3. Only then place it.
```

But again, this only works if the measurement tool exists.

---

## Model choice

You are using:

```js
google/gemini-3.1-flash-lite
```

for the Layout Designer.

That may be too weak for reliable spatial planning. But switching models is not the main fix.

A better model can follow instructions better, but it still lacks the information it needs.

Recommended split:

- Use a stronger model like Claude Sonnet for **planning**.
- Use deterministic tools for layout math.
- Use cheaper models only for small cleanup/formatting tasks.

If you add measurement and scoring tools, even a cheaper model will perform much better.

---

## Concrete next steps

### Step 1: Add `measure_block_fit`

This is the highest-impact change.

For each block, compute line usage for:

- `colSpan: 1, 2, 3, 4`
- allowed fonts
- possible rowSpans

Return recommended `colSpan` and `rowSpan`.

---

### Step 2: Upgrade `read_canvas`

Add:

- `notionIndex`
- `sectionGuess` if available
- occupied cells
- free rectangles
- largest free rects
- used rows per page
- page density

---

### Step 3: Add `evaluate_layout_plan`

Let the agent propose a full plan before applying it.

Return hard errors and soft quality penalties.

---

### Step 4: Add `get_page_screenshot`

Use it every several placements or after a full plan.

Block screenshots are too local for layout critique.

---

### Step 5: Adjust prompt to require measurement before placement

Replace the current “default spans” behavior with:

```txt
Do not use default spans blindly. Defaults are only fallbacks.
For every text block, call measure_block_fit and choose the most economical readable option.
```

---

## My diagnosis

Your current agent is working at the **execution** level but lacks a **layout intelligence layer**.

So the answer is:

- **Not mainly the prompt.**
- **Partly the model.**
- **Mostly the tools and architecture.**

You need to give the agent deterministic geometry tools: measure, compare, score, and inspect whole-page balance. Then let the LLM make semantic choices on top of those measurements.

<chatName="Improving layout designer agent quality"/>
