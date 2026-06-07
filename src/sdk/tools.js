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
import { GUTTER_MM, ROW_MM } from '../lib/layout/units.js';
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

  if (name === 'get_page_screenshot') {
    const { blocks: allBlocks, pageTitle: title, templateName: tmpl, themeColors: colors, screenshotProvider } = ctx;
    const page = args.page || 1;
    try {
      const result = await screenshotProvider({
        blocks: allBlocks,
        pageTitle: title,
        paddingMm,
        templateName: tmpl,
        themeColors: colors,
        page
      });

      return {
        result: {
          status: "success",
          page,
          screenshot_base64: result.screenshot
        }
      };
    } catch (err) {
      console.error('Page screenshot tool failed:', err);
      return { result: { error: `Page screenshot failed: ${err.message}` } };
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
      name: "measure_block_fit",
      description: "Measure a block's footprint at every column width (1–4 cols) WITHOUT placing it. Returns ranked options by readability and economy. Use this BEFORE place_block to choose the best colSpan/rowSpan. For text blocks, also computes per-font options if a font is specified.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "The block's unique ID." },
          font: { type: "string", description: "Optional: evaluate fit with this font. If omitted, uses the block's current font or template default." }
        },
        required: ["id"]
      }
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
  },
  {
    type: "function",
    function: {
      name: "get_page_screenshot",
      description: "Capture a visual screenshot of an entire page. Use this at checkpoints to evaluate overall page balance, whitespace distribution, and section layout. Much more useful than per-block screenshots for layout critique.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, description: "Page number to screenshot (1-indexed)." }
        },
        required: ["page"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "evaluate_layout",
      description: "Score the current layout 0–100 with a penalty list and fix suggestions. Checks for hard fails (overlap, overflow, out-of-bounds), structural issues (orphan headings, sections split across pages), and quality issues (tall-thin blocks, excess gaps, column imbalance, cramped text). Call at checkpoints (~every 5 placements) and before finishing.",
      parameters: {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, description: "Optional: evaluate a single page. Omit to evaluate all pages." }
        },
        required: []
      }
    }
  },
  {
    type: "function",
    function: {
      name: "pack_section",
      description: "Pack a group of blocks into the best available space. You provide the block IDs and a preferred column width strategy ('auto' lets the code decide). The tool measures each block, finds the best fit, and places them sequentially. Use for placing a whole section at once instead of block-by-block.",
      parameters: {
        type: "object",
        properties: {
          blockIds: { type: "array", items: { type: "string" }, description: "Ordered list of block IDs to pack (in desired top-to-bottom order)." },
          page: { type: "integer", minimum: 1, description: "Page to pack onto (1-indexed)." },
          strategy: { type: "string", enum: ["auto", "full-width", "two-column", "sidebar"], description: "Column strategy: 'auto' picks best fit per block, 'full-width' uses 4 cols for all, 'two-column' uses 2 cols, 'sidebar' uses 1+3 col split." },
          startRow: { type: "integer", minimum: 0, description: "Optional: row to start packing from. Auto-detected if omitted." }
        },
        required: ["blockIds", "page"]
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

  if (name === 'measure_block_fit') {
    const block = blocks.find(b => b.id === args.id);
    if (!block) {
      return { result: { error: `Block ${args.id} not found` } };
    }

    const isText = ['paragraph', 'h1', 'h2', 'h3'].includes(block.type);
    if (!isText || !block.content?.length) {
      return {
        result: {
          id: block.id, type: block.type,
          message: 'Not a text block or block has no content. Use default spans.',
          recommended: { colSpan: DEFAULT_SPANS[block.type]?.colSpan || 2, rowSpan: DEFAULT_SPANS[block.type]?.rowSpan || 1, font: 'Default', reason: 'Default span for this block type' }
        }
      };
    }

    const cw = colWidthMm(paddingMm);
    const font = args.font || null;
    const options = [];

    for (let colSpan = 1; colSpan <= 4; colSpan++) {
      const widthMm = colSpan * cw + (colSpan - 1) * GUTTER_MM;
      const virtualRect = { leftMm: paddingMm, topMm: paddingMm, widthMm, heightMm: 2000 };
      const layoutCtx = { templateName: ctx.templateName, paddingMm, themeColors: ctx.themeColors };

      // Apply requested font temporarily for measurement
      let measureBlock = block;
      if (font && font !== 'Default') {
        measureBlock = {
          ...block,
          content: block.content.map(n => {
            if (n.type !== 'text') return n;
            const marks = (n.marks || []).filter(m => !(m.type === 'textStyle' && m.attrs?.fontFamily));
            marks.push({ type: 'textStyle', attrs: { fontFamily: font } });
            return { ...n, marks };
          })
        };
      }

      const lo = computeLayout(measureBlock, virtualRect, layoutCtx);
      const linesUsed = lo.lines.length;
      const usedHeightMm = lo.usedHeightMm || 0;
      const minRowSpan = Math.max(1, Math.ceil(usedHeightMm / ROW_MM));
      const rowSpan = minRowSpan; // tightest fit
      const area = colSpan * rowSpan;
      const aspectRatio = rowSpan / colSpan;
      const plaintext = block.content.filter(n => n.type === 'text').map(n => n.text).join('');
      const avgCharsPerLine = linesUsed > 0 ? plaintext.length / linesUsed : 0;

      // Utilization: how densely the minimum rowSpan is filled (1.0 = perfectly tight).
      // Uses the actual allocated height at minRowSpan, not the unbounded virtual rect.
      const allocatedHeightMm = rowSpan * ROW_MM;
      const utilization = allocatedHeightMm > 0 ? Math.min(1, usedHeightMm / allocatedHeightMm) : 0;

      // Fit quality: readability band (45–90 chars/line)
      const readabilityInBand = avgCharsPerLine >= 45 && avgCharsPerLine <= 90;
      const fitQuality = readabilityInBand ? 'good' : (avgCharsPerLine < 45 ? 'wide' : 'narrow');

      options.push({ colSpan, linesUsed, minRowSpan: rowSpan, area, aspectRatio: Math.round(aspectRatio * 100) / 100, avgCharsPerLine: Math.round(avgCharsPerLine), utilization: Math.round(utilization * 100) / 100, fitQuality });
    }

    // Rank per §3.1: 1) readability in band, 2) lowest area, 3) lowest aspectRatio, 4) utilization
    options.sort((a, b) => {
      const aReadable = a.fitQuality === 'good' ? 0 : 1;
      const bReadable = b.fitQuality === 'good' ? 0 : 1;
      if (aReadable !== bReadable) return aReadable - bReadable;
      if (a.area !== b.area) return a.area - b.area;
      if (a.aspectRatio !== b.aspectRatio) return a.aspectRatio - b.aspectRatio;
      return b.utilization - a.utilization;
    });

    const best = options[0];
    return {
      result: {
        id: block.id, type: block.type, plaintextLength: block.content.filter(n => n.type === 'text').map(n => n.text).join('').length,
        options,
        recommended: {
          colSpan: best.colSpan, rowSpan: best.minRowSpan, font: font || 'Default',
          reason: `Best fit: ${best.fitQuality} readability (${best.avgCharsPerLine} chars/line), area ${best.area} cells, aspect ratio ${best.aspectRatio}`
        }
      }
    };
  }

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

    // Build per-page free-space map
    const pages = [];
    for (let pg = 1; pg <= pageCount; pg++) {
      const pageBlocks = placedBlocks.filter(b => b.canvas.page === pg);
      const maxRow = pageBlocks.reduce((m, b) => Math.max(m, b.canvas.row + b.canvas.rowSpan), 0);
      const gridRows = Math.max(maxRow, 1);

      // Build occupancy grid (4 cols × gridRows rows)
      const grid = Array.from({ length: gridRows }, () => [false, false, false, false]);
      for (const b of pageBlocks) {
        const c = b.canvas;
        for (let r = c.row; r < c.row + c.rowSpan && r < gridRows; r++) {
          for (let col = c.col; col < c.col + c.colSpan && col < 4; col++) {
            if (grid[r]) grid[r][col] = true;
          }
        }
      }

      const totalCells = gridRows * 4;
      const occupiedCells = grid.flat().filter(Boolean).length;
      const fillRatio = totalCells > 0 ? Math.round(occupiedCells / totalCells * 100) : 0;

      // Find continuous empty row ranges for each colSpan — builds both freeRects (JSON) and packingHints (NL)
      const freeRects = [];
      const packingHints = [];
      for (let colSpan = 4; colSpan >= 1; colSpan--) {
        for (let col = 0; col + colSpan <= 4; col++) {
          let row = 0;
          while (row < gridRows) {
            // Find start of empty region at this col/colSpan
            let empty = true;
            for (let c = col; c < col + colSpan; c++) {
              if (grid[row][c]) { empty = false; break; }
            }
            if (!empty) { row++; continue; }

            // Find how many consecutive rows are empty
            let endRow = row;
            while (endRow < gridRows) {
              let allEmpty = true;
              for (let c = col; c < col + colSpan; c++) {
                if (grid[endRow]?.[c]) { allEmpty = false; break; }
              }
              if (!allEmpty) break;
              endRow++;
            }
            if (endRow - row >= 1) {
              freeRects.push({ col, row, colSpan, rowSpan: endRow - row });
              packingHints.push(`${colSpan}-wide block fits at col ${col}, rows ${row}–${endRow - 1} (${endRow - row} rows)`);
              row = endRow;
            } else {
              row++;
            }
          }
        }
      }

      const MAX_PAGE_ROWS = 53;
      pages.push({
        page: pg,
        usedRows: gridRows,
        emptyRows: Math.max(0, MAX_PAGE_ROWS - gridRows),
        fillRatio,
        freeRects: freeRects.slice(0, 20),
        packingHints: packingHints.slice(0, 12)
      });
    }

    return {
      result: {
        pageCount,
        placedBlocks,
        unplacedBlocks,
        pages
      }
    };
  }

  if (name === 'evaluate_layout') {
    const evalPage = args.page || null;
    const cw = colWidthMm(paddingMm);
    let score = 100;
    const penalties = [];
    const suggestions = [];

    const placed = blocks.filter(b => b.canvas && (!evalPage || b.canvas.page === evalPage));
    const pageNums = [...new Set(placed.map(b => b.canvas.page))].sort((a, b) => a - b);

    // Check each block for overlap
    for (const b of placed) {
      if (anyOverlap(blocks, b.id, b.canvas.page, b.canvas, cw, paddingMm)) {
        penalties.push({ type: 'overlap', severity: 'hard_fail', page: b.canvas.page, block: b.name || b.id, message: `Overlaps with another block` });
        score = 0;
      }
    }

    // Check each text block for overflow, tall-thin aspect ratio, and narrow long paragraphs
    for (const b of placed) {
      if (!['paragraph', 'h1', 'h2', 'h3'].includes(b.type)) continue;
      const rect = blockRectMm(b.canvas, paddingMm);
      const layoutCtx = { templateName: ctx.templateName, paddingMm, themeColors: ctx.themeColors };
      const capacity = computeBlockCapacity(b, rect, layoutCtx);
      if (capacity.is_overflowing) {
        penalties.push({ type: 'overflow', severity: 'hard_fail', page: b.canvas.page, block: b.name || b.id, message: `Content overflows by ${capacity.current_lines_used - capacity.max_lines} line(s)` });
        score = Math.max(0, score - 20);
        suggestions.push({ block: b.name || b.id, action: 'increase rowSpan', from: `rowSpan ${b.canvas.rowSpan}`, reason: `Needs ${capacity.current_lines_used} lines but only has ${capacity.max_lines}` });
      }
      const aspectRatio = b.canvas.rowSpan / b.canvas.colSpan;
      // Threshold: 1.5 for substantial paragraphs (>100 chars), 2.0 for short ones and headings.
      // Catches 3×6 (ratio 2.0) and 2×7 (ratio 3.5) summaries, not just extreme cases.
      const plaintext = (b.content || []).filter(n => n.type === 'text').map(n => n.text).join('');
      const tallThinThreshold = (b.type === 'paragraph' && plaintext.length > 100) ? 1.5 : 2.0;
      if (aspectRatio > tallThinThreshold) {
        penalties.push({ type: 'tall_thin', severity: 'medium', page: b.canvas.page, block: b.name || b.id, message: `Aspect ratio ${Math.round(aspectRatio * 10) / 10} (rowSpan ${b.canvas.rowSpan} / colSpan ${b.canvas.colSpan}) — too tall and narrow for this amount of text.` });
        score = Math.max(0, score - 5);
        suggestions.push({ block: b.name || b.id, action: 'widen to colSpan 3-4', reason: `Aspect ratio ${Math.round(aspectRatio * 10) / 10} exceeds threshold ${tallThinThreshold} — widen the block instead of stacking rows` });
      }
      // Narrow long paragraph: >200 chars squeezed into ≤2 cols is almost always wrong on a 4-col resume.
      if (b.type === 'paragraph' && plaintext.length > 200 && b.canvas.colSpan <= 2) {
        penalties.push({ type: 'narrow_long_paragraph', severity: 'medium', page: b.canvas.page, block: b.name || b.id, message: `${plaintext.length}-char paragraph placed at colSpan ${b.canvas.colSpan}. Long prose needs at least 3 columns.` });
        score = Math.max(0, score - 6);
        suggestions.push({ block: b.name || b.id, action: 'widen to colSpan 3 or 4', reason: 'Long text in narrow column wastes vertical space and hurts readability' });
      }
      if (capacity.current_lines_used / Math.max(1, capacity.max_lines) < 0.5) {
        penalties.push({ type: 'low_utilization', severity: 'small', page: b.canvas.page, block: b.name || b.id, message: `Only ${capacity.current_lines_used}/${capacity.max_lines} lines used` });
        score = Math.max(0, score - 2);
      }
    }

    // Per-page fill ratio and spatial checks — build a cell-level occupancy grid per page
    const MAX_PAGE_ROWS = 53;
    for (const pg of pageNums) {
      const pgBlocks = placed.filter(b => b.canvas.page === pg);
      const maxRow = pgBlocks.reduce((m, b) => Math.max(m, b.canvas.row + b.canvas.rowSpan), 0);

      // Build a 4-col × maxRow occupancy grid
      const grid = Array.from({ length: Math.max(maxRow, 1) }, () => [false, false, false, false]);
      let occupiedCells = 0;
      for (const b of pgBlocks) {
        if (b.canvas.colSpan === 0) continue;
        for (let r = b.canvas.row; r < b.canvas.row + b.canvas.rowSpan && r < grid.length; r++) {
          for (let c = b.canvas.col; c < b.canvas.col + b.canvas.colSpan && c < 4; c++) {
            if (!grid[r][c]) { grid[r][c] = true; occupiedCells++; }
          }
        }
      }

      // Fill ratio based on actual occupied cells, not block bounding boxes
      const totalCells = maxRow * 4;
      const fillRatio = totalCells > 0 ? occupiedCells / totalCells : 0;
      if (fillRatio < 0.5 && pgBlocks.length > 2) {
        penalties.push({ type: 'low_fill', severity: 'medium', page: pg, message: `Fill ratio ${Math.round(fillRatio * 100)}% — page is sparse` });
        score = Math.max(0, score - 5);
      }

      // Excess vertical gap: scan for > 2 consecutive ALL-EMPTY rows (no column occupied)
      let gapStart = -1;
      for (let r = 0; r < grid.length; r++) {
        const rowEmpty = grid[r].every(cell => !cell);
        if (rowEmpty) {
          if (gapStart === -1) gapStart = r;
        } else {
          if (gapStart !== -1) {
            const gapSize = r - gapStart;
            if (gapSize > 2) {
              penalties.push({ type: 'excess_vertical_gap', severity: 'medium', page: pg, rows: gapSize, message: `${gapSize}-row empty gap at rows ${gapStart}–${r - 1}. Tighten spacing or move blocks up.` });
              score = Math.max(0, score - Math.min(10, gapSize * 2));
              suggestions.push({ action: 'reduce gap', page: pg, message: `Close the ${gapSize}-row gap at rows ${gapStart}–${r - 1}` });
            }
            gapStart = -1;
          }
        }
      }

      // Column vacancy: if any single column is empty for > 5 consecutive rows while
      // at least one adjacent column is occupied in those same rows — horizontal waste.
      for (let col = 0; col < 4; col++) {
        let vacStart = -1;
        for (let r = 0; r < grid.length; r++) {
          const colEmpty = !grid[r][col];
          const neighborOccupied = (col > 0 && grid[r][col - 1]) || (col < 3 && grid[r][col + 1]);
          if (colEmpty && neighborOccupied) {
            if (vacStart === -1) vacStart = r;
          } else {
            if (vacStart !== -1) {
              const vacSize = r - vacStart;
              if (vacSize > 5) {
                penalties.push({ type: 'column_vacancy', severity: 'medium', page: pg, message: `Column ${col} is empty for ${vacSize} rows (${vacStart}–${r - 1}) while adjacent columns have content. Widen neighboring blocks.` });
                score = Math.max(0, score - 4);
                suggestions.push({ action: `widen blocks in adjacent columns to cover col ${col}`, page: pg, message: `Col ${col} has ${vacSize} wasted rows alongside content` });
              }
              vacStart = -1;
            }
          }
        }
      }
    }

    // Orphan heading: a heading (h1/h2/h3) whose bottom row is within 2 rows of the
    // page bottom (row 52) while its section content is on the next page.
    const allPlaced = blocks.filter(b => b.canvas);
    for (const b of allPlaced) {
      if (!['h1', 'h2', 'h3'].includes(b.type)) continue;
      const headingBottom = b.canvas.row + b.canvas.rowSpan;
      const isNearPageBottom = headingBottom >= 50; // within 2 rows of row 52
      if (!isNearPageBottom) continue;
      // Check if any block that logically follows (by position in blocks array) is on the next page
      const idx = blocks.indexOf(b);
      const nextContent = blocks.slice(idx + 1).find(nb => nb.canvas && ['paragraph', 'h3'].includes(nb.type));
      if (nextContent && nextContent.canvas.page === b.canvas.page + 1) {
        penalties.push({ type: 'orphan_heading', severity: 'medium', page: b.canvas.page, block: b.name || b.id, message: `Heading "${(b.content||[]).map(n=>n.text||'').join('').slice(0,30)}" is at page bottom but its content is on page ${nextContent.canvas.page}.` });
        score = Math.max(0, score - 8);
        suggestions.push({ block: b.name || b.id, action: 'move heading to next page', reason: 'Orphan heading — section body is on a different page' });
      }
    }

    // Section split: a heading and the first paragraph of its section are on different pages,
    // where the heading is NOT at the bottom (already caught by orphan_heading above).
    for (const b of allPlaced) {
      if (!['h1', 'h2', 'h3'].includes(b.type)) continue;
      const headingBottom = b.canvas.row + b.canvas.rowSpan;
      if (headingBottom >= 50) continue; // already flagged as orphan
      const idx = blocks.indexOf(b);
      const nextContent = blocks.slice(idx + 1).find(nb => nb.canvas && nb.type === 'paragraph');
      if (nextContent && nextContent.canvas.page !== b.canvas.page) {
        penalties.push({ type: 'section_split', severity: 'medium', page: b.canvas.page, block: b.name || b.id, message: `Section "${(b.content||[]).map(n=>n.text||'').join('').slice(0,30)}" starts on page ${b.canvas.page} but its body is on page ${nextContent.canvas.page}.` });
        score = Math.max(0, score - 6);
        suggestions.push({ block: b.name || b.id, action: 'move entire section to one page', reason: 'Section heading and body are on different pages' });
      }
    }

    return {
      result: {
        valid: score > 0,
        score: Math.max(0, Math.round(score)),
        pagesEvaluated: evalPage ? [evalPage] : pageNums,
        penalties: penalties.slice(0, 15),
        suggestions: suggestions.slice(0, 10)
      }
    };
  }

  if (name === 'pack_section') {
    const page = args.page || 1;
    const strategy = args.strategy || 'auto';
    const blockIds = args.blockIds || [];
    const cw = colWidthMm(paddingMm);
    const results = [];

    for (const id of blockIds) {
      const block = blocks.find(b => b.id === id);
      if (!block || block.locked) continue;

      // Measure
      const lo = computeLayout(block, { leftMm: paddingMm, topMm: paddingMm, widthMm: 4 * cw + 3 * GUTTER_MM, heightMm: 2000 }, { templateName: ctx.templateName, paddingMm, themeColors: ctx.themeColors });
      const plaintext = (block.content || []).filter(n => n.type === 'text').map(n => n.text).join('');
      const linesUsed = lo.lines.length;
      const avgChars = linesUsed > 0 ? plaintext.length / linesUsed : 0;

      let colSpan, rowSpan;
      if (strategy === 'full-width') {
        colSpan = 4;
      } else if (strategy === 'two-column') {
        colSpan = 2;
      } else if (strategy === 'sidebar') {
        colSpan = block.type === 'h1' || block.type === 'h2' ? 4 : 2;
      } else {
        // Auto: pick based on readability
        if (avgChars >= 45 && avgChars <= 90) {
          colSpan = 4;
        } else if (avgChars < 45) {
          colSpan = block.type === 'h1' || block.type === 'h2' ? 4 : 3;
        } else {
          colSpan = 2;
        }
      }
      rowSpan = Math.max(1, Math.ceil(lo.usedHeightMm / ROW_MM));
      if (strategy === 'full-width' && colSpan === 4) rowSpan = Math.max(rowSpan, block.type === 'h1' ? 4 : block.type === 'h2' ? 3 : 1);

      // Find free slot
      let col = 0;
      let row = args.startRow || 0;
      const placed = blocks.filter(b => b.canvas && b.canvas.page === page);

      // Find first row where this block fits without overlap
      let found = false;
      const maxSearchRows = 100;
      for (let attempt = 0; attempt < maxSearchRows && !found; attempt++) {
        for (let c = 0; c + colSpan <= 4; c++) {
          if (!anyOverlap(blocks, id, page, { col: c, row, colSpan, rowSpan }, cw, paddingMm)) {
            col = c;
            found = true;
            break;
          }
        }
        if (!found) row++;
      }

      if (!found) {
        results.push({ id, status: 'skipped', reason: 'No free space found on page' });
        continue;
      }

      // Place
      block.canvas = { page, col, row, colSpan, rowSpan };
      results.push({
        id, status: 'placed',
        canvas: { page, col, row, colSpan, rowSpan },
        canvasChange: { blockId: id, canvas: { page, col, row, colSpan, rowSpan } }
      });
    }

    return {
      result: {
        placed: results.filter(r => r.status === 'placed').length,
        skipped: results.filter(r => r.status === 'skipped').length,
        results
      },
      canvasChanges: results.filter(r => r.canvasChange).map(r => r.canvasChange)
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
        area: colSpan * rowSpan,
        aspectRatio: colSpan > 0 ? Math.round((rowSpan / colSpan) * 100) / 100 : null,
        utilization: capacity ? Math.round(capacity.current_lines_used / Math.max(1, capacity.max_lines) * 100) / 100 : null,
        fitQuality: capacity && !capacity.is_overflowing
          ? (capacity.current_lines_used / Math.max(1, capacity.max_lines) >= 0.7 ? 'good' : 'underutilized')
          : null,
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
