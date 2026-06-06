// Agent tool definitions and implementations for the AI chat subsystem.
// runAgentTool is a pure async function — it takes all state as parameters and
// returns results (including a stagedChanges update when content is proposed).

import { computeLayout, blockRectMm, initFonts, effectiveBaseStyle, colWidthMm } from '../layout/index.js';
import { findNeighbors } from './spatialUtils.js';
import { sanitizeHtmlWithoutCss, parseHtmlToTiptapJson } from './messageParser.js';

export const AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_block",
      description: "Read the content, layout, dimensions, styling, capacity, and neighbors of a specific resume block.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The unique ID of the block to read."
          }
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
          id: {
            type: "string",
            description: "The unique ID of the block to update."
          },
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
          id: {
            type: "string",
            description: "The unique ID of the block to screenshot."
          }
        },
        required: ["id"]
      }
    }
  }
];

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
 * @returns {Promise<object>} - { result } or { result, stagedChangesUpdate }
 */
export async function runAgentTool(name, args, ctx) {
  const { blocks, paddingMm, templateName, themeColors, stagedChanges, pageTitle } = ctx;

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
    const sanitizedHtml = sanitizeHtmlWithoutCss(args.html_without_css);
    const proposedContent = parseHtmlToTiptapJson(sanitizedHtml, block.type);

    const stagedChangesUpdate = {
      ...stagedChanges,
      [block.id]: {
        originalContent: block.content,
        proposedContent,
        proposedHtml: sanitizedHtml
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
      const lo = computeLayout(proposedBlock, rect, layoutCtx);

      capacity = {
        max_lines: lo.maxLines,
        current_lines_used: lo.lines.length,
        lines_remaining: lo.linesRemaining,
        is_overflowing: lo.overflow
      };
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
      const response = await fetch('/api/screenshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          blocks,
          pageTitle,
          paddingMm,
          templateName,
          themeColors,
          blockId: block.id
        })
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const result = await response.json();
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

export function getAgentSystemPrompt(blocks, pageTitle) {
  const outline = blocks.map((b, i) => {
    const isPlaced = b.canvas !== null;
    const posText = isPlaced
      ? `Page ${b.canvas.page}, Col ${b.canvas.col}, Row ${b.canvas.row} (Span ${b.canvas.colSpan}x${b.canvas.rowSpan})`
      : 'Unplaced';
    const textContent = b.content?.map(node => node.text || '').join('') || '';
    const lockText = b.locked ? 'LOCKED' : 'UNLOCKED';
    return `${i + 1}. [ID: ${b.id}] Type: ${b.type}${b.name ? ` (Name: @${b.name})` : ''} - [${posText}] - [${lockText}] - Content: "${textContent}"`;
  }).join('\n');

  return `You are Antigravity CV Editor Agent, an expert AI resume editor.
You are helping the user edit their resume using tools to read and propose changes to blocks.

Here is the full Notion view of the resume (every block's ID, type, name, canvas position, and content):
Title: ${pageTitle || 'Untitled Resume'}
Outline & Content:
${outline}

Use 'read_block' for a block's authoritative styling (engine-resolved font/size/color)
and spatial capacity — the on-screen text is rendered by the layout engine, not CSS.

Guidelines:
1. You are in Agent Mode. You have tools to read, update block content, and take screenshots.
2. Use 'read_block' to get full details of a block including styling, spatial capacity, neighbors, and lock state.
3. Use 'update_block_content' to propose modifications to block text. Use plain inline HTML only: text with <strong>, <em>, <u>, <s>, and <br> for line breaks. Multiple <p> paragraphs are allowed (each becomes a line break). Do NOT use <ul>, <ol>, <li>, tables, headings, or any styles/CSS — lists are not supported and will be flattened to plain text.
4. You CANNOT modify locked blocks. Check the outline (LOCKED/UNLOCKED per block) or use read_block (locked field) before proposing changes. If a block is locked, inform the user they must unlock it first.
5. Your proposed changes will be STAGED as red/green inline diffs in the Notion pane. The user will accept or deny them.
6. Respect the block spatial budget! Always check capacity numbers returned by update_block_content or read_block to ensure your revisions fit. Avoid overflowing blocks.
7. When referencing blocks, use their ID or name (e.g. @contact-section).
8. Respond to the user with a summary of the edits you proposed or explanation of why you made them.`;
}

export function getSystemPromptOutline(blocks, pageTitle) {
  const outline = blocks.map((b, i) => {
    const isPlaced = b.canvas !== null;
    const posText = isPlaced
      ? `Page ${b.canvas.page}, Col ${b.canvas.col}, Row ${b.canvas.row} (Span ${b.canvas.colSpan}x${b.canvas.rowSpan})`
      : 'Unplaced';
    return `${i + 1}. [ID: ${b.id}] Type: ${b.type}${b.name ? ` (Name: @${b.name})` : ''} - [${posText}]${b.locked ? ' - [LOCKED]' : ''}`;
  }).join('\n');

  return `You are Antigravity CV Assistant, an expert career document reviewer and career coach.
You are helping the user review and polish their resume.
Here is the baseline structure of their resume (only block types, IDs, names, and visual layout coordinates, NOT the full text content):
Title: ${pageTitle || 'Untitled Resume'}
Resume Outline:
${outline}

Guidelines:
1. You are strictly in a READ-ONLY conversational feedback layer. You cannot mutate the document.
2. If the user asks about specific content, you can only see the content of blocks, files, or screenshots that are explicitly ATTACHED to their messages as context chips.
3. If you need to see more blocks to give accurate feedback, ask the user to select them or attach the "Polished CV" or the blocks.
4. When referring to a specific block, you may use its type, name, or position.
5. Provide detailed, actionable career-focused feedback in clear prose. Use Markdown for formatting (bold, lists, headers, etc.) to make your responses readable.`;
}
