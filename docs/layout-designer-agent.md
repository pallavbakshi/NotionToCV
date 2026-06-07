# Layout Designer — Product Vision & UX

## What It Is

A specialized AI sub-agent that places blocks onto the canvas grid one at a time, ensuring every placement is valid (no overlaps, no overflow, within bounds). The user opens the chat drawer, selects "Layout Designer" from the sub-agent selector, and describes what they want — or just asks it to lay out everything.

## Why It Exists

Currently, placing blocks on the canvas is entirely manual: drag from the Notion pane, resize handles, watch for red overlap warnings. It's tedious with more than a handful of blocks. The Layout Designer automates this with spatial reasoning — it understands column widths, row heights, spans, and adjacency.

## User Experience

### Entry Point

Inside the chat drawer, a sub-agent selector replaces the current `chat | agent` toggle:

```
💬 Chat with:  [Layout Designer ▾]
```

Dropdown options (expandable over time):
- **Career Coach** (read-only, today's "chat" mode)
- **Content Editor** (staged diffs, today's "agent" mode)
- **Layout Designer** (this one)

Selecting "Layout Designer" swaps the system prompt, tools, and guidelines. The conversation resets (new agent, new context).

### Typical Flow

1. User opens chat drawer, selects Layout Designer.
2. System prompt loads with the full canvas grid HTML and block content.
3. User types: *"Lay out all unplaced blocks on the canvas."*
4. The agent calls `read_canvas` → sees all placed blocks (occupied cells) and unplaced blocks (content, default spans).
5. For each unplaced block, one at a time:
   - Decides column, row, and spans based on block type, content length, and template defaults.
   - Calls `place_block` with proposed coordinates.
   - Tool validates: no overlap? span within 4 columns? fits on page?
   - If rejected (overlap/overflow), tool returns which block it collided with. Agent adjusts and retries.
   - If accepted, block appears on canvas instantly. User sees the layout build up live.
6. Agent reports a summary: *"Placed 8 blocks across 2 pages. Page 1 has a header, contact info, and summary. Page 2 has experience and education."*

### Progressive & Strategic

The agent works strategically, not randomly:
1. **Structural blocks first** (full-width headings, dividers)
2. **Content blocks grouped by section** (contact info blocks side-by-side, experience stacked)
3. **Leave intentional gaps** rather than cramming — whitespace is deliberate
4. **Respect template defaults** (h1 → 4 cols, h3 → 2 cols, paragraph → 2 cols)

The user can also give targeted commands:
- *"Place only the education section on page 2."*
- *"Move the contact block next to the headshot."*
- *"Make the summary span all 4 columns."*
- *"Remove everything from page 3 and re-lay it out."*

### Error Handling & Feedback

When placement fails, the agent explains why and adapts:
- **Overlap**: *"That position overlaps with @contact-section at (col 2, row 3). Moving you to (col 2, row 6) instead."*
- **Out of bounds**: *"Cannot span 4 columns from column 2 — that would go to column 6. Reducing to 3 cols or starting at column 1."*
- **Content overflow**: *"This paragraph has 8 lines of text but only fits 4 at rowSpan 1. Increasing rowSpan to 2."*

The agent never silently fails or asks the user to fix — it self-corrects transparently.

## Technical Design

### Tools

| Tool | Purpose |
|---|---|
| `read_canvas` | Returns all placed blocks (id, type, grid coords, spans, occupied cells) and all unplaced blocks (id, type, content, default spans, locked status). Full snapshot for decision-making. |
| `place_block` | Places a single block at `(page, col, row, colSpan, rowSpan)`. Validates no overlap, within 4-column bounds, fits on page vertically. Returns success + updated canvas state, or failure + collision details. |

### Isolation

- Own system prompt in `src/sdk/prompts.js` (`getLayoutDesignerPrompt`)
- Own tool set — does not share `update_block_content` or `read_block` with the Content Editor
- Own entry in the sub-agent selector
- Zero impact on existing Career Coach or Content Editor agents

### Validation Rules (enforced by `place_block`)

1. `col + colSpan ≤ 4` (can't exceed column count)
2. Target cells must not overlap any existing placed block's cells
3. Block must fit on its page vertically (no minimum — rows auto-extend)
4. Locked blocks: agent can *read* them but cannot *move* them
5. Unplaced blocks with `source: 'canvas'` (decorative elements) can be placed anywhere with any span

## Future Ideas

- **Batch placement**: *"Lay out all of section @experience"* — agent places an entire group in one turn, reasoning about intra-group ordering
- **Re-layout**: *"Reorganize page 1 to be more compact"* — removes all blocks from a page and re-places them
- **Template-aware spacing**: knows that Elegant template has more generous line spacing and adjusts rowSpan accordingly
- **Multi-page awareness**: when page 1 fills up, automatically starts page 2

## What We're NOT Doing (Yet)

- No content editing — the Layout Designer only positions blocks. Content edits remain the Content Editor's job.
- No template switching — layout is designed for the currently selected template.
- No font/color changes — that stays in Style Settings and the Content Editor.
