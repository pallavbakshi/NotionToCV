# AI Layout Agent — Problem Statement

*A description of the problem, what we've tried, and the open challenges.
Written to be answer-agnostic — we're looking for fresh perspectives on how to approach this.*

---

## What we're building

A CV/resume builder that lets users import their work history from Notion. The document is rendered on an **A4 canvas divided into a 4-column, 53-row grid** (each row = 5mm). Content is broken into typed blocks — headings, paragraphs, dividers, a headshot, contact info — and each block is placed at a specific grid position with a column span and a row span.

Placing blocks manually is tedious. We want an AI agent to do it automatically: given a set of unplaced content blocks, lay them out on the canvas to produce a readable, professional-looking resume.

---

## The constraints

The grid is hard. Every placement must satisfy:

- **No overlap** — two blocks cannot occupy the same cell.
- **No out-of-bounds** — a block cannot exceed 4 columns or extend past the bottom of a page.
- **Content must fit** — a text block has a fixed pixel budget determined by its grid dimensions and font. If the content doesn't fit, it visually overflows (text gets cut off).
- **Multi-page** — when a page fills up, content continues on page 2, 3, etc.

These constraints are mechanically verifiable. The hard part is not validity — it's *quality*.

---

## What "quality" means

A valid layout (no overlaps, no overflow) is not the same as a good layout. Quality roughly means:

- **Economical** — content fills space efficiently. No tall, skinny paragraphs that waste the right half of the page. No large empty gaps between sections.
- **Readable** — line lengths stay in a comfortable range (~45–90 characters per line). Headings are wide. Short facts sit side by side. Long prose gets enough column width to breathe.
- **Structured** — related blocks stay together. Section headings don't get stranded at the bottom of a page while their content starts on the next one.
- **Balanced** — side-by-side columns have similar heights. Pages are used proportionally, not one overflowing page followed by a nearly empty one.

None of these are binary. They're gradients, and they trade off against each other.

---

## The approach we took

We built an agentic loop: an LLM calls tools in a loop to read the canvas state, measure blocks, and place them one at a time. The tools are:

- **`read_canvas`** — returns placed and unplaced blocks, a free-space map, and packing hints.
- **`measure_block_fit`** — given a block ID, returns how many lines it needs at each column width (1–4), with a recommended colSpan/rowSpan based on readability and area.
- **`place_block`** — attempts to place a block at specified coordinates; validates overlap, bounds, and returns content-fit metrics.
- **`evaluate_layout`** — scores the current page 0–100 with a penalty list (overflow, tall-thin blocks, gaps, column imbalance, orphan headings, etc.) and fix suggestions.
- **`get_page_screenshot`** — returns a visual of the full page so the model can see what it has built.
- **`pack_section`** — a deterministic helper that takes a list of block IDs and automatically places them sequentially on a page using measured dimensions.

The system prompt instructs the model to measure before placing, call evaluate at checkpoints, fix penalties, and spread content across pages sensibly.

---

## The hiccups

### 1. Valid ≠ good

The biggest recurring problem: the agent produces layouts that are technically valid but visually poor. A paragraph crammed into 2 columns and stretched over 8 rows. Huge empty gaps where an adjacent column sits empty beside occupied content. Everything on one page because the instructions said "fill page 1 first."

The core issue: the agent optimizes for what the tools measure, and for a long time the tools only measured *validity* (overlap, overflow, bounds). Measures of *quality* — aspect ratio, horizontal waste, column vacancy, page fill density — were added later but the agent often ignores them or doesn't weight them correctly.

### 2. The scorer says 100 when the layout looks broken

We built a numeric scorer (`evaluate_layout`) precisely to give the model feedback beyond "valid/invalid." But in practice the agent reports 100/100 with no penalties while the rendered page looks clearly wrong.

Several causes identified:
- Penalties had thresholds that were too loose (tall-thin check fired only at `aspectRatio > 2`; a 3-column × 6-row summary is exactly 2.0 and slips through).
- Some checks looked at the wrong unit. The vertical gap detector marked a row "occupied" if *any* block touched it — so a 2-column block in the left half marked the full row occupied, hiding the empty right half.
- The scorer ran on partial state (mid-session checkpoint) when the most problematic blocks hadn't been placed yet.
- Hard fails (overflow, out-of-bounds) deducted points but didn't force `valid: false`. The model saw score 80 and considered the layout acceptable.

### 3. The model ignores tool results

Even when `evaluate_layout` returns real penalties, the model sometimes acknowledges them in text and then continues placing blocks without fixing anything. This seems to happen more with smaller/cheaper models and in longer sessions where the context fills up.

Related: the prompt mandates `measure_block_fit` before every `place_block`, but the model sometimes skips measurement and guesses spans, especially after many turns.

### 4. Spatial reasoning is fundamentally hard for LLMs

Even with a free-space map and packing hints, the model struggles to reason about 2D occupancy. It places a block, sees the remaining space, and has to mentally compute "where does a 3×4 block fit without overlapping what's already there?" — a task that humans do visually in milliseconds but LLMs do poorly through token prediction.

The `read_canvas` tool returns both structured free rectangles *and* natural-language packing hints to help. But the model still regularly proposes coordinates that overlap, gets rejected, and retries — burning turns on arithmetic rather than reasoning.

### 5. Page management — cramming vs. spreading

Early versions crammed everything onto page 1 because the prompt said "fill page 1 first, overflow to page 2 only when full." This produced visually dense, illegible single-page layouts.

The fix was to give the model a numeric budget ("target ≤ 35 rows per page, ≤ ~20 blocks per page"), but the tension remains: the model doesn't have a strong intuition for when a page is "full enough" to start the next one, and it tends toward either too dense or too sparse depending on how the prompt is worded.

### 6. The cost of measurement

`measure_block_fit` does genuine layout computation — it runs the actual text-rendering engine for each candidate column width and returns exact line counts. This is accurate and deterministic. But calling it for every block before every placement adds latency and tokens. In a session with 60 blocks, that's 60 measurement calls before 60 placement calls.

We added `pack_section` as a shortcut — deterministic code that measures and places a whole section automatically. But the model sometimes misuses it (calling it on the wrong page, or with the wrong strategy), which then requires individual corrections.

### 7. Model capability vs. harness quality

There's a real question of how much of the problem is "the model is too weak for this task" vs. "the harness is giving the model the wrong information." We've debugged both:

- Several harness bugs were causing Gemini to receive malformed history (`content: null` in assistant messages, no `max_tokens` causing truncated tool responses, consecutive same-role messages triggering API errors).
- But even after fixing those, the quality gap remains large. A capable model (Claude Sonnet) produces better layouts with the same tools and prompt than a smaller model (Gemini Flash Lite).

The tradeoff is real: a stronger model costs more and is slower. The economics of running a layout agent on a cheap model are appealing, but the current results suggest the task may require more reasoning capacity than the cheapest tier provides.

---

## The open question

How do you build an AI agent that produces *good* layouts, not just *valid* ones, on a constrained 2D grid — reliably, economically, and fast enough to feel interactive?

Specifically:

- How much should the LLM do vs. deterministic code? (The LLM is good at semantic decisions: which blocks belong together, which section is more important, what the visual hierarchy should be. It's bad at coordinate arithmetic and 2D packing.)
- How do you design a feedback loop that the model actually follows? Numeric scores, visual screenshots, penalty lists — none of these have reliably changed the model's behavior mid-session.
- Is iterative single-block placement the right unit of work, or should the model plan the full layout before executing? Planning first risks bad coordinate arithmetic; greedy placement risks locally valid but globally poor results.
- How do you handle the mismatch between what the model can reason about (relative concepts like "wider", "above", "grouped") and what the tool accepts (absolute coordinates)?
