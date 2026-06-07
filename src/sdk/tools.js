// Agent tool definitions, prompt builders, and the tool dispatcher for the SDK.
// Zero Svelte, zero fetch — all host capabilities (screenshot, model) are injected.
// Content conversion uses headless Tiptap schema + ProseMirror DOMParser
// (no full Editor instantiation) — produces identical inline nodes as the web host.

import { getSchema } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';
import { DOMParser as PMParser } from 'prosemirror-model';

import { computeLayout, blockRectMm, initFonts, effectiveBaseStyle, colWidthMm } from '../lib/layout/index.js';
import { findNeighbors } from './spatial.js';
import { getAgentSystemPrompt, getSystemPromptOutline, getLayoutDesignerPrompt } from './prompts.js';
import { sanitizeHtmlWithoutCss, initDomParser } from '../lib/ai-chat/messageParser.js';
import { anyOverlap, canvasToRect, rectsOverlap } from '../lib/polished/canvasUtils.js';

export { getAgentSystemPrompt, getSystemPromptOutline, getLayoutDesignerPrompt };

// ---------------------------------------------------------------------------
// Extension set — identical to parseHtmlToTiptapJson in messageParser.js.
// Underline is NOT listed separately; StarterKit already includes it.
// Schema built once at module load (pure, zero DOM required).
// ---------------------------------------------------------------------------

const extensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    bulletList: false,
    orderedList: false,
    listItem: false,
    blockquote: false,
    horizontalRule: false,
    codeBlock: false,
    code: false,
    trailingNode: false,
    history: false,
  }),
  TextStyle,
  Color,
  FontFamily
];

const schema = getSchema(extensions);

// ---------------------------------------------------------------------------
// Internal DOM adapter — browser uses native DOMParser, Node uses linkedom
// (call initSdkDomParser() before any tool execution in Node)
// ---------------------------------------------------------------------------

let _parseDocument;

if (typeof DOMParser !== 'undefined') {
  _parseDocument = (html) => new DOMParser().parseFromString(
    '<html><body>' + (html || '') + '</body></html>',
    'text/html'
  );
}

/**
 * Shared capacity computation — single source of truth used by both
 * update_block_content (in-loop check) and engine.validateBlockLayout
 * (FR2.9: no duplicate logic).
 *
 * @param {Object} block - block with content already set to the proposed content
 * @param {Object} rect  - { leftMm, topMm, widthMm, heightMm }
 * @param {Object} layoutCtx - { templateName, paddingMm, themeColors }
 * @returns {{ max_lines, current_lines_used, lines_remaining, is_overflowing }}
 */
export function computeBlockCapacity(block, rect, layoutCtx) {
  const lo = computeLayout(block, rect, layoutCtx);
  return {
    max_lines: lo.maxLines,
    current_lines_used: lo.lines.length,
    lines_remaining: lo.linesRemaining,
    is_overflowing: lo.overflow
  };
}

/** Initialise the SDK's DOM parser AND the isomorphic message parser for Node. No-op in browser. */
export async function initSdkDomParser() {
  if (!_parseDocument) {
    const { parseHTML } = await import('linkedom');
    _parseDocument = (html) => {
      const { document } = parseHTML('<html><body>' + (html || '') + '</body></html>');
      return document;
    };
  }
  // messageParser.js has its own _parseDocument — initialise it too, since
  // sanitizeHtmlWithoutCss() (called by update_block_content) uses it in Node.
  await initDomParser();
}

/** Return the body element of a parsed HTML string (for ProseMirror's DOMParser). */
function domAdapter(html) {
  return _parseDocument(html || '').body;
}

// ---------------------------------------------------------------------------
// htmlToInlineNodes — headless Tiptap schema + ProseMirror DOMParser
// → flat inline node array [{type, text, marks}] the layout engine expects.
// Produces identical output to parseHtmlToTiptapJson, with zero schema drift.
// ---------------------------------------------------------------------------

/**
 * Convert agent-proposed HTML to the flat inline node array the layout engine
 * reads via contentToRuns. Uses getSchema (headless Tiptap, zero DOM) and
 * ProseMirror's DOMParser.fromSchema (headless parse, linkedom-safe).
 *
 * Mirrors parseHtmlToTiptapJson's flattening: multi-<p> → hardBreak separators.
 *
 * @param {string} html - already-sanitised HTML (no style/class/id attrs)
 * @returns {Array<{type:string,text?:string,marks?:Array}>}
 */
export function htmlToInlineNodes(html) {
  const body = domAdapter(html);
  const pmDoc = PMParser.fromSchema(schema).parse(body);
  const blockNodes = pmDoc.toJSON().content ?? [];
  const inline = [];
  for (let i = 0; i < blockNodes.length; i++) {
    const children = blockNodes[i].content ?? [];
    if (i > 0 && children.length > 0) inline.push({ type: 'hardBreak' });
    inline.push(...children);
  }
  return inline;
}

// ---------------------------------------------------------------------------
// Tool definitions (unchanged from the original agent)
// ---------------------------------------------------------------------------

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_block",
      description: "Read the content, layout, dimensions, styling, capacity, and neighbors of a specific resume block.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The unique ID of the block to read." }
        },
        required: ["id"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "update_block_content",
      description: "Stage a change to a block's content using HTML (without CSS/inline styles). This automatically runs verification to check if the new content fits within the block's physical budget and capacity.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The unique ID of the block to update." },
          html_without_css: {
            type: "string",
            description: "The proposed text content as plain inline HTML: text with <strong>, <em>, <u>, <s>, and <br>. Multiple <p> paragraphs are allowed (each becomes a line break). Do NOT use <ul>, <ol>, <li>, tables, headings, styles, classes, inline CSS, or font declarations — lists are unsupported and will be flattened to plain text."
          }
        },
        required: ["id", "html_without_css"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_block_screenshot",
      description: "Capture and return a visual screenshot of the block as it currently renders on the CV canvas. Useful to verify density, layout, or line-wrapping details.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The unique ID of the block to screenshot." }
        },
        required: ["id"]
      }
    }
  }
];

// ---------------------------------------------------------------------------
// runAgentTool — environment-agnostic tool dispatcher
// ---------------------------------------------------------------------------

/**
 * Run an agent tool call. Returns { result } or { result, stagedChangesUpdate }.
 *
 * @param {string} name - Tool name ("read_block", "update_block_content", "get_block_screenshot")
 * @param {object} args - Tool arguments
 * @param {object} ctx - Application context
 * @param {Array} ctx.blocks - Current block array
 * @param {number} ctx.paddingMm - Page padding in mm
 * @param {string} ctx.templateName - Active template name
 * @param {object} ctx.themeColors - Theme color map
 * @param {object} ctx.stagedChanges - Current staged changes object
 * @param {string} ctx.pageTitle - Resume page title
 * @param {Function} ctx.screenshotProvider - Injected screenshot capability
 * @returns {Promise<object>} - { result } or { result, stagedChangesUpdate }
 */
export async function runAgentTool(name, args, ctx) {
  const { blocks, paddingMm, templateName, themeColors, stagedChanges, pageTitle, screenshotProvider } = ctx;

  await initFonts();

  const cw = colWidthMm(paddingMm);

  if (name === 'read_block') {
    const block = blocks.find(b => b.id === args.id);
    if (!block) {
      return { result: { error: `Block ${args.id} not found` } };
    }

    const plaintext = block.content?.map(node => node.text || '').join('') || '';

    const isTextBlock = ['paragraph', 'h1', 'h2', 'h3'].includes(block.type);
    let appliedStyles = null;
    if (isTextBlock) {
      const bs = effectiveBaseStyle(templateName, block.type, themeColors);
      appliedStyles = {
        fontFamily: bs.fontFamily,
        fontSizeMm: bs.fontSizeMm,
        lineHeightMm: bs.lineHeightMm,
        color: bs.color,
        textTransform: bs.textTransform,
        fontWeight: bs.fontWeight
      };
    }

    const isPlaced = !!block.canvas;
    let capacity = null;
    let widthMm = 0;
    let heightMm = 0;

    if (isPlaced) {
      const rect = blockRectMm(block.canvas, paddingMm);
      widthMm = rect.widthMm;
      heightMm = rect.heightMm;
      const layoutCtx = { templateName, paddingMm, themeColors };
      const lo = computeLayout(block, rect, layoutCtx);

      capacity = {
        max_lines: lo.maxLines,
        approx_characters_per_line: null,
        current_lines_used: lo.lines.length,
        lines_remaining: lo.linesRemaining,
        is_overflowing: lo.overflow
      };
    }

    const neighbors = findNeighbors(block.id, blocks, cw, paddingMm);

    return {
      result: {
        id: block.id,
        type: block.type,
        name: block.name,
        placement_status: isPlaced
          ? 'placed — block is on the A4 canvas and has a fixed spatial budget'
          : 'unplaced — block exists in the Notion editor but has not been added to the canvas yet; spatial budget is unknown and content length is unconstrained',
        canvas: block.canvas,
        widthMm: isPlaced ? widthMm : null,
        heightMm: isPlaced ? heightMm : null,
        plaintext,
        capacity: isPlaced ? capacity : 'N/A — block is unplaced; no spatial budget to check against. You may still propose content edits but cannot verify fit until the block is placed on the canvas.',
        applied_styles: appliedStyles,
        neighbors: isPlaced ? neighbors : 'N/A — unplaced blocks have no canvas neighbors',
        locked: !!block.locked
      }
    };

  } else if (name === 'update_block_content') {
    const block = blocks.find(b => b.id === args.id);
    if (!block) {
      return { result: { error: `Block ${args.id} not found` } };
    }

    if (block.locked) {
      return {
        result: {
          error: `Block "${block.name || block.id}" is locked. You cannot modify locked blocks. The user must unlock this block first before you can propose changes to it.`
        }
      };
    }

    const proposedHtml = sanitizeHtmlWithoutCss(args.html_without_css);
    const proposedContent = htmlToInlineNodes(proposedHtml);

    const stagedChangesUpdate = {
      ...stagedChanges,
      [block.id]: {
        originalContent: block.content,
        proposedContent,
        proposedHtml
      }
    };

    let capacity = {
      max_lines: null,
      current_lines_used: null,
      lines_remaining: null,
      is_overflowing: false,
      message: "Block is not currently placed on canvas"
    };

    if (block.canvas) {
      const rect = blockRectMm(block.canvas, paddingMm);
      const layoutCtx = { templateName, paddingMm, themeColors };
      const proposedBlock = { ...block, content: proposedContent };
      capacity = computeBlockCapacity(proposedBlock, rect, layoutCtx);

      // FR6.7: strictCapacity — reject changes that overflow the block budget.
      // The agent sees the capacity numbers and is expected to self-correct.
      if (ctx.strictCapacity && capacity.is_overflowing) {
        return {
          result: {
            status: "rejected",
            staged: false,
            reason: "overflow",
            capacity,
            message: `Content overflows block budget (${capacity.current_lines_used}/${capacity.max_lines} lines used). Shorten the text or split across more blocks.`
          }
        };
      }
    }

    return {
      result: {
        status: "success",
        staged: true,
        capacity
      },
      stagedChangesUpdate
    };

  } else if (name === 'get_block_screenshot') {
    const block = blocks.find(b => b.id === args.id);
    if (!block) {
      return { result: { error: `Block ${args.id} not found` } };
    }

    try {
      const result = await screenshotProvider({
        blocks,
        pageTitle,
        paddingMm,
        templateName,
        themeColors,
        blockId: block.id
      });

      return {
        result: {
          status: "success",
          blockId: block.id,
          screenshot_base64: result.screenshot
        }
      };
    } catch (err) {
      console.error('Screenshot tool failed:', err);
      return { result: { error: `Screenshot failed: ${err.message}` } };
    }
  }

  return { result: { error: `Unknown tool: ${name}` } };
}

// ---------------------------------------------------------------------------
// Layout Designer tools
// ---------------------------------------------------------------------------

const DEFAULT_SPANS = {
  paragraph:           { colSpan: 2, rowSpan: 1 },
  h3:                  { colSpan: 2, rowSpan: 2 },
  h2:                  { colSpan: 4, rowSpan: 3 },
  h1:                  { colSpan: 4, rowSpan: 4 },
  horizontal_divider:  { colSpan: 4, rowSpan: 1 },
  vertical_divider:    { colSpan: 0, rowSpan: 6 },
  headshot:            { colSpan: 1, rowSpan: 6 }
};

export const LAYOUT_DESIGNER_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_canvas",
      description: "Get a complete map of the canvas: all placed blocks with grid coordinates, all unplaced blocks with their content and default spans. Call this first before placing anything.",
      parameters: { type: "object", properties: {}, required: [] }
    }
  },
  {
    type: "function",
    function: {
      name: "place_block",
      description: "Place or reposition a block on the 4-column grid canvas. Validates no overlap, within bounds, and locked status. Returns success or detailed collision info.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The block's unique ID." },
          page: { type: "integer", minimum: 1, description: "Page number (1-indexed)." },
          col: { type: "integer", minimum: 0, maximum: 3, description: "Start column (0–3)." },
          row: { type: "integer", minimum: 0, maximum: 52, description: "Start row (0–52)." },
          colSpan: { type: "integer", minimum: 0, maximum: 4, description: "Column span. Use 0 for vertical divider / gutter elements." },
          rowSpan: { type: "integer", minimum: 1, maximum: 53, description: "Row span height." }
        },
        required: ["id", "page", "col", "row", "colSpan", "rowSpan"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "set_block_font",
      description: "Apply a font family to all text in a block. Affects layout because different fonts have different metrics (line height, character width). Use 'Default' to reset to the template's default font.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The block's unique ID." },
          font: { type: "string", enum: ["Default", "Inter", "Lora", "Playfair Display", "Space Grotesk", "Fira Code", "Outfit"], description: "Font family to apply. 'Default' removes any custom font override." }
        },
        required: ["id", "font"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "get_block_screenshot",
      description: "Capture a visual screenshot of the block as it renders on the canvas. Useful to verify layout, density, font rendering, or line-wrapping before and after placement.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The block's unique ID to screenshot." }
        },
        required: ["id"]
      }
    }
  }
];

/**
 * Run a Layout Designer tool call. Returns { result } or { result, canvasChange }.
 *
 * @param {string} name - Tool name ("read_canvas", "place_block")
 * @param {object} args - Tool arguments
 * @param {object} ctx - Application context (same shape as runAgentTool ctx)
 * @returns {Promise<object>}
 */
export async function runLayoutDesignerTool(name, args, ctx) {
  const { blocks, paddingMm } = ctx;

  await initFonts();

  if (name === 'read_canvas') {
    const placedBlocks = [];
    const unplacedBlocks = [];
    let pageCount = 1;

    for (const b of blocks) {
      if (b.canvas) {
        if (b.canvas.page > pageCount) pageCount = b.canvas.page;
        placedBlocks.push({
          id: b.id,
          type: b.type,
          name: b.name || null,
          locked: !!b.locked,
          canvas: { ...b.canvas },
          plaintext: (b.content || []).map(n => n.text || '').join('')
        });
      } else {
        unplacedBlocks.push({
          id: b.id,
          type: b.type,
          name: b.name || null,
          locked: !!b.locked,
          plaintext: (b.content || []).map(n => n.text || '').join(''),
          defaultSpans: DEFAULT_SPANS[b.type] || { colSpan: 2, rowSpan: 1 }
        });
      }
    }

    return {
      result: {
        pageCount,
        placedBlocks,
        unplacedBlocks
      }
    };
  }

  if (name === 'place_block') {
    const block = blocks.find(b => b.id === args.id);
    if (!block) {
      return { result: { error: `Block ${args.id} not found` } };
    }

    if (block.locked) {
      return {
        result: {
          status: "rejected",
          reason: "block_is_locked",
          message: `Block "${block.name || block.id}" is locked. You cannot move it.`
        }
      };
    }

    const { page, col, row, colSpan, rowSpan } = args;
    const MAX_COLS = 4;
    const MAX_ROW = 52;

    // Grid bounds check
    if (colSpan > 0 && col + colSpan > MAX_COLS) {
      return {
        result: {
          status: "rejected",
          reason: "out_of_bounds",
          message: `col + colSpan (${col} + ${colSpan} = ${col + colSpan}) exceeds max columns (${MAX_COLS}).`
        }
      };
    }
    if (row + rowSpan > MAX_ROW + 1) {
      return {
        result: {
          status: "rejected",
          reason: "out_of_bounds",
          message: `row + rowSpan (${row} + ${rowSpan} = ${row + rowSpan}) exceeds max row (${MAX_ROW}).`
        }
      };
    }

    // Overlap check — use the same physical collision math as the UI
    const proposal = { page, col, row, colSpan, rowSpan };
    const cw = colWidthMm(paddingMm);
    const overlaps = anyOverlap(blocks, args.id, page, proposal, cw, paddingMm);

    if (overlaps) {
      // Find which block overlaps for contextual feedback
      const candidateRect = canvasToRect(proposal, cw, paddingMm);
      const collider = blocks.find(b => {
        if (!b.canvas || b.id === args.id || b.canvas.page !== page) return false;
        return rectsOverlap(candidateRect, canvasToRect(b.canvas, cw, paddingMm));
      });
      const colliderLabel = collider ? (collider.name ? `@${collider.name}` : collider.id) : 'another block';
      return {
        result: {
          status: "rejected",
          reason: "overlap",
          message: `Placement overlaps with ${colliderLabel} at col ${collider?.canvas?.col}, row ${collider?.canvas?.row}. Choose different coordinates.`
        }
      };
    }

    // Apply placement directly
    block.canvas = { page, col, row, colSpan, rowSpan };

    // Content overflow check — for text blocks, verify content fits within the
    // allocated dimensions so the AI knows if it needs a larger rowSpan
    let capacity = null;
    if (['paragraph', 'h1', 'h2', 'h3'].includes(block.type) && block.content?.length) {
      const rect = blockRectMm(block.canvas, paddingMm);
      const layoutCtx = { templateName: ctx.templateName, paddingMm, themeColors: ctx.themeColors };
      capacity = computeBlockCapacity(block, rect, layoutCtx);
    }

    return {
      result: {
        status: "success",
        message: `Block "${block.name || block.id}" placed at page ${page}, col ${col}, row ${row} (span ${colSpan}x${rowSpan}).` +
          (capacity ? ` Content: ${capacity.current_lines_used}/${capacity.max_lines} lines used.` +
            (capacity.is_overflowing ? ` ⚠️ OVERFLOW — content exceeds the block budget by ${capacity.current_lines_used - capacity.max_lines} line(s). Increase rowSpan or split content across blocks.` : '') : '')
      },
      canvasChange: { blockId: args.id, canvas: { page, col, row, colSpan, rowSpan } }
    };
  }

  if (name === 'set_block_font') {
    const block = blocks.find(b => b.id === args.id);
    if (!block) {
      return { result: { error: `Block ${args.id} not found` } };
    }

    if (block.locked) {
      return {
        result: {
          status: "rejected",
          reason: "block_is_locked",
          message: `Block "${block.name || block.id}" is locked. Cannot change font.`
        }
      };
    }

    const font = args.font;
    const content = block.content || [];
    console.log('[set_block_font] block:', args.id, 'type:', block.type, 'font:', font);
    console.log('[set_block_font] content before:', JSON.stringify(content).slice(0, 200));
    const contentLen = content.filter(n => n.type === 'text').map(n => n.text).join('').length;
    const updatedContent = content.map(node => {
      if (node.type !== 'text') return node;
      const marks = (node.marks || []).filter(m => !(m.type === 'textStyle' && m.attrs?.fontFamily));
      if (font !== 'Default') {
        marks.push({ type: 'textStyle', attrs: { fontFamily: font } });
      }
      return { ...node, marks };
    });

    // Safety: don't wipe content
    if (contentLen > 0 && updatedContent.filter(n => n.type === 'text').map(n => n.text).join('').length === 0) {
      console.error('[set_block_font] WOULD WIPE CONTENT — aborting');
      return {
        result: {
          status: "rejected",
          reason: "would_clear_content",
          message: `Block "${block.name || block.id}" — font change would clear all text content. Aborted. No changes made.`
        }
      };
    }

    console.log('[set_block_font] content after:', JSON.stringify(updatedContent).slice(0, 200));
    block.content = updatedContent;

    return {
      result: {
        status: "success",
        message: `Font for block "${block.name || block.id}" set to ${font}.`
      },
      contentChange: { blockId: args.id, content: updatedContent }
    };
  }

  if (name === 'get_block_screenshot') {
    const { blocks: allBlocks, pageTitle: title, templateName: tmpl, themeColors: colors, screenshotProvider } = ctx;
    const block = blocks.find(b => b.id === args.id);
    if (!block) {
      return { result: { error: `Block ${args.id} not found` } };
    }

    try {
      const result = await screenshotProvider({
        blocks: allBlocks,
        pageTitle: title,
        paddingMm,
        templateName: tmpl,
        themeColors: colors,
        blockId: block.id
      });

      return {
        result: {
          status: "success",
          blockId: block.id,
          screenshot_base64: result.screenshot
        }
      };
    } catch (err) {
      console.error('Screenshot tool failed:', err);
      return { result: { error: `Screenshot failed: ${err.message}` } };
    }
  }

  return { result: { error: `Unknown tool: ${name}` } };
}
