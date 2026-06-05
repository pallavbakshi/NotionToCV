# PRD: AI Chat (Phase 3)
## NotionToCV — Conversational Feedback Layer

---

## 1. What This Phase Builds

A chat drawer that lets the user talk to an AI about their CV. The user opens the chat, optionally attaches context — nothing, a single block, several selected blocks, or the polished CV view — and converses to get feedback.

This phase is **pure conversational feedback**. The AI reads what the user attaches and replies in prose. It does not edit the document, does not call tools, and does not apply changes. Those are deliberately deferred to Phase 4 (Agent Mode).

The core guarantee of this phase: **the user can get focused AI feedback on exactly the part of their CV they care about — down to a single block — without leaving the editor.**

---

## 2. How It Connects to Existing Phases

Phase 1 produced the `blocks[]` array (Notion pane). Phase 2 added the `canvas` field and the polished A4 view. Phase 3 reads from both and writes to neither.

```js
// Chat reads block content for context
{ id: 'b_abc', type: 'h2', content: [...], canvas: {...} }
```

The chat layer is **strictly read-only** with respect to document state in v1. It never mutates `content`, `type`, `canvas`, or `name`. The only state the chat owns is its own conversation history.

This read-only boundary is the same discipline that kept the Notion and polished panes decoupled (PRD_POLISHED §2). It is what makes Phase 4 a clean upgrade: when the agent gains tools, the *only* new capability is the ability to write back — the context-attachment and conversation surface stay identical.

---

## 3. Conversation Model

### 3.1 One Conversation Per Resume

There is exactly **one active conversation per resume at a time**, regardless of what context is attached. Chatting about a single block, three blocks, or the polished view are all turns within the same running conversation — not separate threads.

This mirrors Cursor's side panel: one ongoing chat, context changes per message, history accumulates linearly.

### 3.2 Conversation History

- The conversation persists for the resume (survives drawer close/reopen and pane switches).
- The user can browse **previous conversations** for this resume via a history view.
- The user can **start a new conversation** at any time (the Cursor `+` pattern), which archives the current one into history and opens a fresh thread.

### 3.3 What This Phase Does NOT Do

- No multiple simultaneous threads.
- No per-block persisted chat ("what did AI say about my summary last week" is satisfied by conversation history, not per-block memory).
- No Apply / accept-rewrite. (Phase 4.)
- No tool calls or agent status rows. (Phase 4.)

---

## 4. Context Attachment

Context is the heart of this feature. A message carries zero or more **context attachments** describing what the AI should look at.

### 4.1 The Three Entry Points

| Entry point | Where | Context attached on open |
|---|---|---|
| **Top-bar chat icon** | Top menu bar, beside the hamburger menu | **None** — empty context, user attaches manually if desired |
| **Block selection bubble** | Floating bubble that appears when one or more blocks are selected | The selected block(s) |
| **"Chat with polished view"** | Button at the top of the page area | The polished CV view |

The defining rule: **the top-bar icon is context-free; the other two auto-attach context corresponding to what the user acted on.**

### 4.2 Block Selection

The user selects blocks by **drag-select** (click-drag across blocks) or by clicking a single block. When one or more blocks are selected, a **floating chat bubble** appears near the selection. Clicking it opens the drawer with those blocks pre-attached as context.

- Single block selected → context = that block.
- Multiple blocks selected → context = all selected blocks, in document order.

Multi-select is manual and explicit. There is no automatic "section" grouping in v1.

### 4.3 Polished View Context

The polished view is an HTML canvas (A4 pages). It is shared with the AI **directly as the rendered view** — the actual layout the user sees, including block positions. This means feedback like "your header feels crowded" or "there's too much whitespace in the right column" is possible, because the AI receives the spatial layout, not just text.

> **Open implementation question (not a product question):** the exact transport — rendered image of the A4 page(s) vs. structured layout description vs. both — is an architecture decision. Product requirement: the AI must be able to reason about *visual layout and positioning*, not just text content.

### 4.4 Context Chips

Whatever is attached to the current message is shown as **chips** at the top of the chat input — e.g. `Block 3`, `4 blocks`, `Polished CV`. The user can:
- Remove a chip (detach that context).
- Add context manually from inside the drawer (e.g. attach the polished view to a conversation that started empty).

### 4.5 Context Locking Per Message

Context is bound to the message at send time. Selecting different blocks in the editor mid-conversation does **not** retroactively change earlier messages. Each turn records exactly what context it was sent with. The "current" attachment shown in chips is simply the staging area for the *next* message.

### 4.6 File Attachments

The user can attach external files (images, PDFs, etc.) to a message, like any normal chat interface. These ride alongside the block/polished-view context as additional attachments on that message.

---

## 5. System Context — What the AI Always Knows

Independent of explicit attachments, every conversation carries baseline context in the system prompt:

1. **Role framing** — the AI knows it is reviewing a CV / resume and giving career-document feedback.
2. **Document skeleton** — a lightweight outline of the full document: block types, headings, and order. This is *structure, not full text*.
3. **Document metadata** — the resume title and, if available, the target role.

The distinction that matters:

- **Always present (light):** the full document's *shape* — so single-block feedback is never context-blind ("is this bullet strong?" can account for the section it lives in).
- **Only when attached (full):** the full *text* of specific blocks, or the *visual* of the polished view.

This keeps single-block chat focused without making the AI hallucinate about surrounding content it can't see.

---

## 6. The Chat Drawer

### 6.1 Placement and Coexistence

The chat lives in a **right-side drawer** that slides in over the polished CV pane. It shares the existing drawer slot with the Style drawer.

**Invariant: at most one drawer open at a time.** Opening the chat closes the style drawer and vice versa. This reuses the existing single-drawer system rather than introducing a competing surface.

### 6.2 Anatomy

```
┌─────────────────────────────────┐
│ AI Chat            [history] [+] │  ← header: history view, new conversation
├─────────────────────────────────┤
│                                 │
│   ┌─ user ──────────────────┐   │
│   │ Is this summary strong? │   │
│   │ [Block 2]               │   │  ← context chips shown on the turn
│   └─────────────────────────┘   │
│                                 │
│   ┌─ assistant ─────────────┐   │
│   │ It's solid, but the     │   │
│   │ opening verb is weak...  │   │  ← prose feedback
│   └─────────────────────────┘   │
│                                 │
│        (message list scrolls)   │
│                                 │
├─────────────────────────────────┤
│ [Block 3] [×]  [+ attach]       │  ← staged context chips
│ ┌─────────────────────────────┐ │
│ │ Type a message…             │ │  ← input
│ └─────────────────────────────┘ │
│                          [Send] │
└─────────────────────────────────┘
```

### 6.3 Message Types

v1 has two visible message types: **user** and **assistant**.

> **Forward-compatibility note (design constraint, not v1 scope):** the message component must be built to accommodate a third type — `tool_call` / status rows ("searching the web…", "reading block 3…") — without restructuring. In v1 this type is never emitted. In Phase 4 it becomes the agent's visible activity, exactly like Cursor Composer / Windsurf Cascade. Leaving room for it now is the one piece of v1 architecture that protects the agent upgrade path.

### 6.4 Streaming

Assistant responses stream token-by-token (standard chat UX). The input is disabled / shows a stop affordance while a response is generating.

---

## 7. Backend & Model

### 7.1 OpenRouter

All model calls go through **OpenRouter** as the endpoint provider. This keeps the model choice swappable and is the same endpoint layer Phase 4's agent will use (whether driven by the OpenAI Agents SDK, Anthropic SDK, or Vercel AI SDK).

### 7.2 API Keys (v1)

v1 uses **the developer's own API key**, supplied via environment configuration. There is no per-user key entry and no settings UI for keys in this phase. A future settings page (separate effort) will decide between bring-your-own-key and a proxied/billed model.

### 7.3 Multimodal

Because the polished view is shared visually, the chosen model path must support **image/multimodal input**. Model selection must account for this.

---

## 8. Scope Boundary — v1 vs v2 (Agent Mode)

| Capability | v1 (this PRD) | v2 (Agent Mode) |
|---|---|---|
| Prose feedback chat | ✅ | ✅ |
| Attach single / multi / polished context | ✅ | ✅ |
| File attachments | ✅ | ✅ |
| Conversation history + new conversation | ✅ | ✅ |
| Streaming responses | ✅ | ✅ |
| Apply / accept rewrite | ❌ | ✅ |
| Tools (update/create/delete block, web search, image analysis) | ❌ | ✅ |
| Visible tool/status rows | ❌ (room left in UI) | ✅ |

**Explicitly out of scope for v1, by user decision:**
- Apply-back of suggestions ("v2 feature anyway").
- Any agent tooling.

The line is firm: v1 is a clean, focused **conversational feedback layer**. It is not watered down — context attachment down to a single block, multi-block, and full visual polished-view review are all in v1. What's deferred is *writing back* and *acting*, not *understanding*.

---

## 9. Anticipated Phase 4 Tools (for architectural awareness only)

Not built in this phase. Listed so v1's context-attachment plumbing is verified compatible:

- `update_block(id, content)` — the core rewrite-apply.
- `create_block(after_id, type, content)` — add a bullet/section.
- `delete_block(id)` — remove noise.
- `search_web(query)` — research company / role.
- `analyze_cv_image()` — reason over the polished view screenshot.

v1's attachments (block content + polished-view visual + files) are already the inputs these tools would consume. The agent upgrade therefore adds *output* capability without changing the *input* surface.

---

## 10. Open Questions Deferred to Architecture

These are implementation decisions, not product decisions:

1. **Polished-view transport** — rendered image of A4 page(s), structured layout description, or both (§4.3).
2. **Drawer integration** — how the chat drawer plugs into the existing single-drawer system shared with the Style drawer (§6.1).
3. **Selection → bubble mechanics** — how drag-select across blocks is detected and where the floating bubble anchors (§4.2).
4. **Conversation persistence** — where history is stored (in-memory session vs. localStorage vs. backend) given there's no per-user backend yet.
5. **Model routing** — which OpenRouter model(s), and the multimodal-capable path for polished-view review (§7.3).
