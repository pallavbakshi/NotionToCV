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
import { getAgentSystemPrompt, getSystemPromptOutline } from './prompts.js';
import { sanitizeHtmlWithoutCss, initDomParser } from '../lib/ai-chat/messageParser.js';

export { getAgentSystemPrompt, getSystemPromptOutline };

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
