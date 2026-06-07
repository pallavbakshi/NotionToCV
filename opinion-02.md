The main reason your Layout Designer agent is producing suboptimal, "stuffed", or space-wasting layouts is that **it is operating as a blind puzzle-solver.** 

Currently, the agent is forced to use hardcoded defaults (like `paragraph→2×1`) and a slow, painful trial-and-error loop: it places a block, gets a visual/textual overflow warning, is rejected, and tries another coordinate. This blind-spot forces the model to choose extremely conservative, rigid, and safe boundaries (like forcing body paragraphs into tight 2-column segments) to avoid collision and overflow penalties.

Here is exactly what you are missing and how you can upgrade your tools and prompts to fix this.

---

### 1. The Crucial Missing Cognitive Tool: `estimate_block_layout`

Currently, the agent cannot answer the question: *"How many lines and rows will this specific paragraph occupy if I span it across 3 columns vs 2 columns vs 4 columns?"* unless it actually mutates the live canvas. Because it is penalized for playing around on the live canvas, it defaults to the rigid rules outlined in the prompt.

**The Fix:** Implement an **offline estimation tool** that allows the agent to pre-calculate wrapping behavior for different column configurations before committing a placement.

#### Step A: Add to `LAYOUT_DESIGNER_TOOLS` inside `src/sdk/tools.js`
```js
  {
    type: "function",
    function: {
      name: "estimate_block_layout",
      description: "Estimate exactly how many lines and grid rows a block will take up at different column spans (1 to 4) under a specific font family, without modifying the canvas. Use this to find the layout sweet spot before placing.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The block's unique ID." },
          colSpan: { type: "integer", minimum: 1, maximum: 4, description: "Proposed column span width." },
          font: { type: "string", enum: ["Default", "Inter", "Lora", "Playfair Display", "Space Grotesk", "Outfit"], description: "Proposed font family." }
        },
        required: ["id", "colSpan", "font"]
      }
    }
  }
```

#### Step B: Implement inside `runLayoutDesignerTool` in `src/sdk/tools.js`
```js
  if (name === 'estimate_block_layout') {
    const block = blocks.find(b => b.id === args.id);
    if (!block) return { result: { error: `Block ${args.id} not found` } };

    const { colSpan, font } = args;
    const cw = colWidthMm(paddingMm);
    
    // Simulate a virtual width boundary
    const virtualWidthMm = colSpan * cw + (colSpan - 1) * GUTTER_MM;
    const layoutCtx = { templateName: ctx.templateName, paddingMm, themeColors: ctx.themeColors };

    // Set virtual font metrics if requested
    const originalContent = block.content;
    let virtualContent = originalContent || [];
    if (font !== 'Default') {
      virtualContent = virtualContent.map(node => {
        if (node.type !== 'text') return node;
        const marks = (node.marks || []).filter(m => !(m.type === 'textStyle' && m.attrs?.fontFamily));
        marks.push({ type: 'textStyle', attrs: { fontFamily: font } });
        return { ...node, marks };
      });
    }

    const proposedBlock = { ...block, content: virtualContent };
    
    // Run an unconstrained vertical layout with fixed width to count actual lines
    const virtualRect = { leftMm: 0, topMm: 0, widthMm: virtualWidthMm, heightMm: 10000 };
    const lo = computeLayout(proposedBlock, virtualRect, layoutCtx);

    const linesUsed = lo.lines.length;
    // Row height standard is 5mm per row (ROW_MM)
    const exactHeightMm = lo.usedHeightMm;
    const optimalRowSpan = Math.ceil(exactHeightMm / ROW_MM);

    return {
      result: {
        blockId: args.id,
        colSpan,
        font,
        lines_used: linesUsed,
        required_rowSpan: optimalRowSpan,
        message: `At a column span of ${colSpan} using ${font}, this content wraps into ${linesUsed} line(s) and requires exactly rowSpan: ${optimalRowSpan} to prevent overflow.`
      }
    };
  }
```

---

### 2. Prompt Anti-pattern: Eliminate Rigid Fallback Assumptions
In `src/sdk/prompts.js`, rule 5 explicitly states:
> *"- Default spans: h1→4×4, h2→4×3, h3→2×2, paragraph→2×1 (use 4×1 if text is long)..."*

This directive actively trains the model to put regular text into `2×1` shapes. A 2-column segment (approx 93mm) wrapping text into a 1-row height budget (5mm) can only fit **one single line of text**. If a paragraph has 3 sentences, it immediately overflows. The agent then panics, stretches the `rowSpan`, but keeps it crammed in `colSpan: 2`, making a long, ugly vertical column of text.

#### The Fix: Update `getLayoutDesignerPrompt` to encourage spatial dynamic sizing
Modify the rules inside `getLayoutDesignerPrompt` in `src/sdk/prompts.js` to reward professional typographical hierarchy:

```md
## Spatial Strategy Guidelines (Aesthetic & Economical Grid Layouts):
- **Avoid rigid columns.** You are not forced to use 2-columns for paragraphs. If a section of text is descriptive (e.g., a summary, bulleted facts, long sentences), prioritize spanning it across 3 columns (`colSpan: 3`) or 4 columns (`colSpan: 4`).
- **Leverage pre-visual pre-calculations.** ALWAYS use the `estimate_block_layout` tool on a block before placing it. Test different column spans (2, 3, and 4) to find the most typographical ratio of width-to-height. Avoid wrapping paragraphs into tall, thin vertical columns!
- **Symmetric layout grouping.** If placing two content items side-by-side (e.g. h3 fact columns), ensure they have symmetric `colSpan` (e.g. both `colSpan: 2`). Use `estimate_block_layout` to ensure their `rowSpan` values are identical or visually aligned.
```

---

### 3. Let the Agent See Available Packing Gaps
Currently, `read_canvas` returns:
```js
placedBlocks: [{ id, canvas }]
```
While this lists coordinates, the AI is notoriously bad at parsing coordinate sets into actual "empty spaces" (gaps). It has to do raw math to find which `col` and `row` slots are empty.

#### The Fix: Feed "Available Packing Windows" inside the `read_canvas` response
Modify the `read_canvas` block in `runLayoutDesignerTool` to calculate and explicitly print empty rectangles or rows for the agent:

```js
  if (name === 'read_canvas') {
    // ... [existing data processing] ...
    
    // Perform simple unoccupied grid calculation (simple row/column scanner)
    // and yield helpful recommendations:
    const occupiedGrid = {}; // map representation of visual grid
    // For each canvas block, paint cells of (page, col, row)
    
    // Return explicit visual instructions to help pack the space:
    return {
      result: {
        pageCount,
        placedBlocks,
        unplacedBlocks,
        packing_hints: [
          "Page 1 has free rows from Row 12 to 52 across all 4 columns.",
          "Coordinate (col: 0, row: 8) has a side-by-side gap next to @headshot.",
          "Use wider colSpans (3 or 4) to let content breathe horizontally rather than stacking vertically."
        ]
      }
    };
  }
```

By providing **Layout Estimation** and **Dynamic Spatial Advice**, the agent transitions from a blind trial-and-error placement bot into a professional layout engineer that calculates margins and column ratios before laying down ink.

<chatName="Improving layout designer agent spacing and sizing metrics"/>
