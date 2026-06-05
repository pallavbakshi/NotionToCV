# PRD — Agent Mode (AI Resume Editing)

**Status:** Draft for implementation
**Builds on:** AI Chat (v1, read-only advisor) — see ChatDrawer
**Scope of this document:** The live, interactive use case only — a user sitting at the screen, editing their resume with an AI agent. The automated pipeline (JD-tailoring at scale) is explicitly deferred and only referenced where it shapes an architectural decision we must not paint ourselves out of.

---

## 1. Summary

Agent Mode upgrades the AI from an **advisor** that talks about your resume into an **editor** that proposes concrete changes to your resume blocks. It lives inside the existing ChatDrawer behind a **Chat / Agent** mode toggle. In Chat mode nothing changes (pure v1 conversation). In Agent mode the AI is given a small set of tools, driven through the **Anthropic SDK** (tool-use), that let it read any block in full detail and propose new content for it.

Every change the agent proposes is **staged, never auto-applied**. Proposed changes surface as **GitHub-style inline diffs inside the Notion pane** — original in red on top, proposal in green below — where the user accepts or rejects each block (or accept-all / deny-all). The canvas is never touched directly; it simply reflects whatever the Notion blocks currently contain, exactly as it does today.

The product principle: **the AI optimizes content; the human owns the decision.** Acceptance is frictionless; denial is a deliberate human moment that always loops feedback back to the agent.

---

## 2. The core problem this feature must respect

A resume in NotionToCV is two coupled things:

1. **Content** — the rich text inside each block (what it says).
2. **Canvas placement** — the block's fixed position and size on the A4 grid (page, col, row, colSpan, rowSpan).

These are coupled by space. The canvas does **not** reflow like a webpage — it is a fixed grid. So the length of a block's content directly determines whether the layout breaks:

- Rewrite a block with more text than fits → overflow, formatting breaks.
- Rewrite it much shorter → dead whitespace, looks unfinished.

What makes this tractable is what is **locked**:

| Locked (AI must NOT change) | Variable (AI's domain) |
| --- | --- |
| Font family per block type | Text content within a block |
| Font size per block type | Wording, structure, emphasis |
| Block dimensions (colSpan, rowSpan, mm) | |
| Block type | |
| Canvas position | |

Because fonts and dimensions are locked, **the spatial budget of every block is deterministic and calculable.** We can tell the agent, up front and exactly, how many lines fit and roughly how many characters per line. The agent therefore reasons about fit from numbers, not guesswork — and we never have to resize or move blocks to make content fit. **The agent iterates on content, not on layout.** This is a deliberate constraint: in the overwhelming majority of cases the user wants to optimize the words, not change the look and feel.

---

## 3. Where it lives — Chat vs Agent mode

- The existing ChatDrawer (right-side drawer, shares its slot with the Style drawer, one at a time) gets a **mode toggle: Chat | Agent**.
- **Chat mode** = v1, unchanged. Pure prose conversation, read-only, no tools.
- **Agent mode** = tool-use via the Anthropic SDK. Same drawer, same history model, same context-attachment chips — but the backend switches from raw streaming to an agentic tool-use loop, and the assistant can now propose block edits.
- The user switches modes explicitly. Mode is a property of the conversation.

Everything the v1 ChatDrawer already does — per-resume history, new-conversation, context attachment chips, polished-view screenshots — remains available in Agent mode.

---

## 4. The context model

The agent arrives **already knowing the whole resume.** We do not make it discover the document through tool calls. The Agent-mode system prompt is loaded with:

1. **The full Notion view** — every block's content, ID, type, name, and canvas position.
2. **The full polished view** — the complete rendered HTML/CSS of the polished CV, so the agent understands how the resume actually looks and how blocks relate visually.

This means tool calls are for **precise, targeted action and verification**, not for exploration. The agent reads the room from the system prompt and uses tools to zoom into a specific block or to make a change.

On top of the always-present document context, the user can still **attach focused context** the same way as v1:

- User-selected block attachments (auto-attached when entering Agent mode from a block's "Ask AI", or added manually).
- Polished-view screenshot attachment.
- File attachments.

So focused block detail reaches the agent two ways: **agent self-exploration** (via `read_block`) or **user-supplied attachment**, depending on context.

---

## 5. The tools (Editor Agent)

Three tools. The write format is **HTML without CSS** — the agent emits semantic structure only (`<p>`, `<strong>`, `<em>`, `<ul>`, `<li>`, …), never inline styles, font sizes, or font families. Tiptap parses this HTML natively into the block's structured content. The "no CSS" rule is what structurally enforces the locked-font constraint — the agent simply has no channel through which to change typography.

### 5.1 `read_block(id)` — fat read, one call returns everything

The read is intentionally rich so the agent never has to chain multiple thin reads. A single `read_block` returns the full working context for that block:

- **Content**
  - structured rich-text nodes
  - plaintext rendering (for easy reasoning)
  - block type, block name (`@name` if set)
- **Canvas position**
  - page, col, row, colSpan, rowSpan
  - width and height in **mm** and **px**
- **Capacity (pre-calculated — not the agent's job to derive)**
  - max lines that fit
  - approximate characters per line (given column width + locked font)
  - current lines used
  - lines remaining
  - `is_overflowing` (is the current content already too long?)
- **Rendered HTML + applied styles**
  - the actual rendered `<div>` HTML of the block (read-only reference)
  - font family, font size (pt), line height, padding (mm)
  - this is the machine-readable truth the agent reasons about fit from
- **Neighbors (immediate adjacents on the canvas)**
  - above, below, left, right
  - each: `{ id, type, name, content_plaintext_snippet }`
  - gives section/grouping context without another tool call (e.g. an Experience header and the bullet blocks beneath it are visually coupled)

### 5.2 `update_block_content(id, html_without_css)` — the only write tool

- Agent submits semantic HTML; the tool converts it to Tiptap internally and **stages a diff** (it does not commit to the live block).
- **Auto-verify on write:** the tool automatically runs the equivalent of `read_block` immediately after staging and returns the post-change state — capacity numbers and `is_overflowing` — back to the agent in the tool result. So the agent learns whether its proposal fits **without spending an extra tool call**, and can revise before moving on.
- Behavior is **identical** in interactive and pipeline use. The only difference (later) is who accepts the staged diff: a human now, an auto-accept step in the pipeline later. The tool itself never needs to know which context it runs in — acceptance is external to the tool. (This also gives us a free dry-run/auditing mode for pipelines down the road.)

### 5.3 `get_block_screenshot(id)` — visual escape hatch

- Returns a rendered JPEG of the block as it actually looks.
- **Not for measurement** — capacity numbers already handle fit. This is for **judgment**: visual density, wrapping edge cases (a bullet list where items wrap to two lines looks very different from the same character count of prose), and other things the numbers can't fully convey.
- Expected to be rare in the live editor case given locked fonts and deterministic dimensions; reserved as an on-demand tool the agent reaches for only when a visual call is genuinely needed. (It will earn more of its keep with the future Judge agent.)

> **Out of scope by design:** no `resize_block`, no `move_block`, no `create_block`, no `delete_block`. The agent iterates on content within a fixed layout. Changing the look and feel is not the agent's job.

---

## 6. The change surface — diffs in the Notion pane

- When the agent stages a change via `update_block_content`, the affected block renders as an **inline diff inside the Notion pane** (left side), GitHub-style:
  - **Original content on top, in red.**
  - **Proposed content below, in green.**
- Controls:
  - **Per-block Accept / Deny.**
  - **Accept all / Deny all.**
- **The canvas is never shown a diff and is never edited directly.** It continues to render whatever the Notion blocks currently contain. When a change is accepted, the block updates and the canvas reflects it as it always has.
- Diffs are also reflected/summarized in the chat interface, but the **accept/reject interaction happens on the Notion blocks** (and via accept-all/deny-all). No proposed or live changes ever appear on the canvas.

---

## 7. The accept / deny feedback loop

Acceptance and denial are deliberately asymmetric, because they mean different things.

### 7.1 Acceptance → frictionless, agent continues

- The user accepts a block (or accept-all). The change commits to the block; the canvas updates.
- The agent is notified silently and **continues its auto-execution uninterrupted** — no pause, no required user action. Approval should be frictionless.

### 7.2 Denial → pauses for a human moment, always seeks feedback

Denial is intentional pushback, so it deserves a human moment and the agent must learn from it.

- When the user denies a block change, the system **auto-injects a context chip into the message composer** (e.g. "Block X — denied"), exactly the way attachments are injected today.
- The user can **optionally add their own feedback in the same message** ("make it shorter", "wrong tone", "keep the metric").
- **The user must press Send** for this to reach the agent. Because denial is a user action, we explicitly seek the user's framing before the agent responds — we do not auto-fire the denial back.
- On Send, the agent receives the denial (plus any feedback) and follows up — revising, asking a clarifying question, or moving on.

```
Agent proposes change(s)
        │
        ├─ User ACCEPTS block ─→ commits, canvas updates,
        │                         agent notified silently, auto-execution continues
        │
        └─ User DENIES block ──→ "Block X — denied" chip auto-injected into composer
                                  user optionally adds feedback in same message
                                  user presses Send
                                  agent receives denial (+ feedback) → follows up
```

The user drives recovery. The agent never has to guess why something was rejected; if the user sends a bare denial the agent can ask, and if they add feedback the agent can retry immediately.

---

## 8. Scope boundary

| In scope (this release) | Deferred |
| --- | --- |
| Chat / Agent mode toggle in ChatDrawer | Automated JD-tailoring pipeline |
| Anthropic SDK tool-use loop | Judge agent (auto accept/reject/feedback) |
| `read_block`, `update_block_content` (auto-verify), `get_block_screenshot` | Layout tools (resize / move / create / delete) |
| HTML-without-CSS write format → Tiptap | Settings-page API key management |
| Inline red/green diffs in the Notion pane | Canvas-side diff rendering (explicitly never) |
| Per-block + accept-all / deny-all | |
| Denial → composer chip + user feedback → agent follow-up | |
| Full Notion view + polished HTML/CSS in system prompt | |

---

## 9. Forward-compatibility — the Judge agent & pipelines (not built now)

We are building the live, human-in-the-loop case. But the architecture must not block the automated pipeline, where AI agents tailor a CV to different JDs without a human present. The key decisions that keep that door open:

- **`update_block_content` always stages a diff; acceptance is external.** In the live case the human accepts/denies. In the pipeline case, a **Judge agent** plays the role of the human — accepting, rejecting, or returning feedback to the Editor agent — using its own small tool set (anticipated: `get_pending_changes`, `accept_change(id)`, `reject_change(id, feedback)`). The Editor's tools do not change.
- **Auto-verify on write** means the Editor can run a full propose → verify-fit → revise loop autonomously, which is exactly what a no-human pipeline needs.
- **`get_block_screenshot`** becomes more valuable to the Judge (visual quality verification) than it is to the live Editor.
- Staged-diff-always also yields a natural **dry-run / audit mode**: run the pipeline, skip auto-accept, let a human review every proposed change before committing.

For the live interactive release, **the user IS the judge.** Same staging mechanism, human in the loop.

---

## 10. Open implementation questions

1. **Capacity calculation source of truth.** Where do `max_lines` / `chars_per_line` come from — measured from the live rendered DOM of the block, or computed from the template's locked font metrics + column geometry? (Live DOM is more accurate; computed is cheaper and works headless for the future pipeline.)
2. **Diff rendering in the Notion pane.** How do we render red/green inline diff state inside Tiptap-backed blocks without corrupting the editor's document model — overlay layer vs. a transient diff view of the block?
3. **Staged-change store.** Where do staged diffs live (a pending-changes store keyed by block ID), and how do accept/deny mutate it and notify the agent?
4. **Anthropic SDK tool-use streaming.** Wiring the tool-use loop (partial JSON accumulation, `tool_use` / `tool_result` round-trips) through the existing `/api/chat`-style proxy, and how tool calls render in the chat transcript.
5. **HTML → Tiptap fidelity.** Confirm the allowed HTML tag set maps cleanly onto existing block types, and define how disallowed/styled HTML is sanitized (strip CSS, drop unknown tags).
6. **`get_block_screenshot` transport.** Reuse the existing Puppeteer `/api/screenshot` path to render a single block in isolation at its true canvas dimensions.
7. **Denial chip semantics.** Exact payload of the auto-injected denial chip (block ID, original vs. rejected proposal) so the agent has enough to follow up well.
