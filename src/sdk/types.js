// Canonical type definitions for the Agentic Resume SDK.
// JSDoc-only — no runtime code. Every host (browser, CLI, worker) shares these shapes.

/**
 * A single block on the resume canvas or in the Notion editor.
 *
 * @typedef {Object} Block
 * @property {string} id - Unique block identifier.
 * @property {string} type - Block type (e.g. "paragraph", "h1", "h2", "h3", "image").
 * @property {string} [name] - User-assigned block name (e.g. "contact-section").
 * @property {Array<Object>} content - Tiptap JSON inline node array.
 * @property {Object|null} canvas - Canvas placement: { page, col, row, colSpan, rowSpan } | null if unplaced.
 * @property {boolean} [locked] - Block is locked against modification.
 * @property {string} [source] - Origin: "canvas" or "notion".
 * @property {string} [imageData] - Base64 data URI for headshot/image blocks (set via canvas.toDataURL / readAsDataURL). Present only on image blocks.
 */

/**
 * The full serialized resume state — the canonical contract between hosts.
 *
 * @typedef {Object} ResumeState
 * @property {string} title - Resume page title.
 * @property {number} paddingMm - Page padding in millimetres.
 * @property {string} templateName - Active template identifier (e.g. "clean").
 * @property {Object} themeColors - Theme colour map (e.g. { h1Color, textColor, backgroundColor }).
 * @property {number} pageCount - Number of A4 pages.
 * @property {Block[]} blocks - All blocks in the resume.
 */

/**
 * An event emitted by the agent engine during an optimizeResume run.
 *
 * @typedef {Object} AgentTextEvent
 * @property {'text'} type
 * @property {string} delta - Streaming text chunk from the LLM.
 *
 * @typedef {Object} AgentToolCallEvent
 * @property {'tool_call'} type
 * @property {string} id - Tool-call identifier.
 * @property {string} name - Tool name (e.g. "read_block").
 * @property {Object} args - Tool arguments.
 *
 * @typedef {Object} AgentToolResultEvent
 * @property {'tool_result'} type
 * @property {string} id - Tool-call identifier the result belongs to.
 * @property {string} name - Tool name.
 * @property {Object} result - Tool return value.
 *
 * @typedef {Object} AgentStagedChangeEvent
 * @property {'staged_change'} type
 * @property {string} blockId - Block whose content was proposed for update.
 * @property {Object} change - The staged-change payload.
 *
 * @typedef {Object} AgentErrorEvent
 * @property {'error'} type
 * @property {string} error - Error message.
 *
 * @typedef {Object} AgentDoneEvent
 * @property {'done'} type
 * @property {'model_complete'|'max_turns'|'aborted'} reason - How the loop ended.
 * @property {Object} [transaction] - Accumulated staged changes (set when reason is not "aborted").
 *
 * @typedef {AgentTextEvent|AgentToolCallEvent|AgentToolResultEvent|AgentStagedChangeEvent|AgentErrorEvent|AgentDoneEvent} AgentEvent
 */

/**
 * A normalized streaming delta from the model provider, regardless of underlying API.
 *
 * @typedef {Object} Delta
 * @property {string} [content] - Text chunk.
 * @property {Array<{index: number, id?: string, function?: {name?: string, arguments?: string}}>} [tool_calls] - Tool-call fragments.
 */

/**
 * A model provider: streams normalized Deltas from an LLM API.
 *
 * @callback ModelProvider
 * @param {Object} params
 * @param {Array<Object>} params.messages - Normalized message array.
 * @param {string} params.systemPrompt - System prompt string.
 * @param {string} params.model - Model identifier (e.g. "anthropic/claude-sonnet-4-5").
 * @param {Array<Object>} [params.tools] - Tool definitions.
 * @param {AbortSignal} [params.signal] - Abort signal.
 * @returns {AsyncIterable<Delta>}
 */

/**
 * A screenshot provider: captures a block as a base64-encoded image.
 *
 * @callback ScreenshotProvider
 * @param {Object} payload
 * @param {Block[]} payload.blocks - All blocks (for context).
 * @param {string} payload.pageTitle - Resume title.
 * @param {number} payload.paddingMm - Page padding in mm.
 * @param {string} payload.templateName - Active template.
 * @param {Object} payload.themeColors - Theme colour map.
 * @param {string} payload.blockId - Target block ID to screenshot.
 * @returns {Promise<{screenshot: string}>} - { screenshot: base64_string }
 */

/**
 * Layout capacity returned by validateBlockLayout and the update_block_content tool.
 *
 * @typedef {Object} LayoutCapacity
 * @property {number|null} max_lines - Total lines the block can hold.
 * @property {number|null} current_lines_used - Lines consumed by current content.
 * @property {number|null} lines_remaining - Available line budget.
 * @property {boolean} is_overflowing - Content exceeds the block budget.
 */

/**
 * The transaction returned at the end of an agent run, ready to be applied to state.
 *
 * @typedef {Object} Transaction
 * @property {Object<string, {originalContent: Array<Object>, proposedContent: Array<Object>, proposedHtml: string}>} stagedChanges
 */
