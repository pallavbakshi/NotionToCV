// clipboardParser.js — turns a paste event's clipboard payload into our block model.
//
// Pure, host-agnostic: no Svelte, no event objects. It reads three clipboard
// flavours in descending fidelity and returns an array of fresh blocks
// (each with a new id, canvas: null) ready to splice into the document.
//
//   1. application/json  → our own internal copy format (highest fidelity)
//   2. text/html         → Notion, Google Docs, web pages
//   3. text/plain        → newline-split + markdown heading prefixes (fallback)
//
// Our block model only supports paragraph / h1 / h2 / h3 with inline marks
// (bold, italic, strike, underline) and hardBreaks. Anything richer that the
// clipboard carries — lists, tables, quotes, code, callouts — is flattened to
// paragraphs (list items keep a "• " / "1. " prefix). DOMParser is read from
// the global scope so the browser uses its native one; the Node test harness
// injects linkedom's.

const genId = () => 'b_' + Math.random().toString(36).substring(2, 9);

function makeBlock(type, content) {
  return { id: genId(), type, content, canvas: null, name: null, locked: false };
}

/**
 * @param {DataTransfer|{getData:(t:string)=>string}} clipboardData
 * @returns {Array<object>|null} fresh blocks, or null if nothing usable
 */
export function parseClipboard(clipboardData) {
  if (!clipboardData) return null;
  const get = (type) => {
    try { return clipboardData.getData(type) || ''; } catch { return ''; }
  };

  // 1. Internal format — preserved byte-for-byte from the legacy paste path.
  const fromJson = parseInternalJson(get('application/json'));
  if (fromJson) return fromJson;

  // 2. Rich HTML from external apps.
  const fromHtml = parseHtml(get('text/html'));
  if (fromHtml && fromHtml.length) return fromHtml;

  // 3. Plain-text fallback (legacy behavior).
  const fromText = parsePlainText(get('text/plain'));
  return fromText && fromText.length ? fromText : null;
}

// ---------------------------------------------------------------------------
// 1. Internal JSON
// ---------------------------------------------------------------------------

function parseInternalJson(json) {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(b => b.type && b.id)) {
      // New ids prevent collisions; canvas is reset so pasted blocks aren't
      // treated as already-placed on the canvas. Everything else is preserved.
      return parsed.map(b => ({ ...b, id: genId(), canvas: null }));
    }
  } catch { /* not our format — fall through */ }
  return null;
}

// ---------------------------------------------------------------------------
// 2. HTML
// ---------------------------------------------------------------------------

const HEADING_TAGS = { H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3' };

// Tags that, when found inside a container, mean "recurse — this isn't a leaf".
const BLOCK_TAGS = new Set([
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'PRE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'DIV',
  'SECTION', 'ARTICLE', 'FIGURE', 'HR'
]);

function parseHtml(html) {
  if (!html || !html.trim()) return null;
  const DP = globalThis.DOMParser;
  if (!DP) return null;
  let doc;
  try {
    doc = new DP().parseFromString(html, 'text/html');
  } catch { return null; }
  const body = doc && doc.body;
  if (!body) return null;

  const out = [];
  walkBlocks(body, out);
  return out.length ? out : null;
}

function hasBlockChildren(el) {
  for (const child of el.children) {
    if (BLOCK_TAGS.has(child.tagName)) return true;
  }
  return false;
}

function walkBlocks(parent, out) {
  for (const node of parent.childNodes) {
    if (node.nodeType === 3) { // text node
      if (node.textContent && node.textContent.trim()) {
        out.push(makeBlock('paragraph', inlineFromText(node.textContent)));
      }
      continue;
    }
    if (node.nodeType !== 1) continue; // skip comments etc.

    const tag = node.tagName;

    if (HEADING_TAGS[tag]) {
      const inline = inlineFromElement(node);
      if (inline.length) out.push(makeBlock(HEADING_TAGS[tag], inline));
    } else if (tag === 'UL' || tag === 'OL') {
      walkList(node, out, tag === 'OL');
    } else if (tag === 'TABLE') {
      walkTable(node, out);
    } else if (tag === 'PRE') {
      walkPre(node, out);
    } else if (tag === 'HR' || tag === 'BR') {
      // No representation in our model — drop.
      continue;
    } else if (tag === 'P' || tag === 'BLOCKQUOTE') {
      if (hasBlockChildren(node)) {
        walkBlocks(node, out); // Notion sometimes nests blocks inside <p>/<blockquote>
      } else {
        const inline = inlineFromElement(node);
        if (inline.length) out.push(makeBlock('paragraph', inline));
      }
    } else {
      // DIV / SPAN / SECTION / B-wrapper (Google Docs) / unknown.
      if (hasBlockChildren(node)) {
        walkBlocks(node, out);
      } else {
        const inline = inlineFromElement(node);
        if (inline.length) out.push(makeBlock('paragraph', inline));
      }
    }
  }
}

// Sub-bullets by depth. Our model is flat, so nesting is approximated with
// leading non-breaking spaces (regular spaces collapse in rendered HTML) plus
// a depth-appropriate marker — preserving the *visual* hierarchy Notion had.
const LIST_BULLETS = ['•', '◦', '▪'];
const LIST_INDENT = '   '; // non-breaking spaces (regular spaces collapse)

function walkList(listEl, out, ordered, depth = 0) {
  let n = 1;
  const indent = LIST_INDENT.repeat(depth);
  for (const li of listEl.children) {
    if (li.tagName !== 'LI') continue;
    const marker = ordered ? `${n}.` : LIST_BULLETS[Math.min(depth, LIST_BULLETS.length - 1)];
    // Inline content of the item, excluding any nested lists (handled after).
    const inline = inlineFromElement(li, new Set(['UL', 'OL']));
    out.push(makeBlock('paragraph', [{ type: 'text', text: `${indent}${marker} ` }, ...inline]));
    n++;
    // Nested lists become deeper-indented paragraphs.
    for (const child of li.children) {
      if (child.tagName === 'UL') walkList(child, out, false, depth + 1);
      else if (child.tagName === 'OL') walkList(child, out, true, depth + 1);
    }
  }
}

function walkTable(tableEl, out) {
  const rows = tableEl.querySelectorAll('tr');
  for (const tr of rows) {
    const cells = [...tr.children].filter(c => c.tagName === 'TD' || c.tagName === 'TH');
    const text = cells
      .map(c => (c.textContent || '').replace(/\s+/g, ' ').trim())
      .join(' | ');
    if (text) out.push(makeBlock('paragraph', [{ type: 'text', text }]));
  }
}

function walkPre(preEl, out) {
  const text = (preEl.textContent || '').replace(/\n+$/, '');
  if (!text) return;
  for (const line of text.split('\n')) {
    out.push(makeBlock('paragraph', line ? [{ type: 'text', text: line }] : []));
  }
}

// ---------------------------------------------------------------------------
// Inline extraction (text + marks)
// ---------------------------------------------------------------------------

function inlineFromText(raw) {
  const text = raw.replace(/\s+/g, ' ').trim();
  return text ? [{ type: 'text', text }] : [];
}

function inlineFromElement(el, excludeTags = null) {
  const collected = [];
  collectInline(el, [], collected, excludeTags);
  return trimInline(mergeAdjacent(collected));
}

function collectInline(node, marks, out, excludeTags) {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      pushText(out, child.textContent, marks);
    } else if (child.nodeType === 1) {
      const tag = child.tagName;
      if (excludeTags && excludeTags.has(tag)) continue;
      if (tag === 'BR') { out.push({ type: 'hardBreak' }); continue; }
      collectInline(child, addMarks(marks, tag, child), out, excludeTags);
    }
  }
}

function pushText(out, raw, marks) {
  // HTML collapses runs of whitespace; mirror that so paste doesn't carry
  // source indentation/newlines as literal spaces.
  const text = (raw || '').replace(/\s+/g, ' ');
  if (!text) return;
  out.push(marks.length
    ? { type: 'text', text, marks: marks.map(m => ({ type: m })) }
    : { type: 'text', text });
}

function addMarks(marks, tag, el) {
  const add = [];
  if (tag === 'STRONG' || tag === 'B') add.push('bold');
  else if (tag === 'EM' || tag === 'I') add.push('italic');
  else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') add.push('strike');
  else if (tag === 'U' || tag === 'INS') add.push('underline');

  // Google Docs and rich web content express formatting via inline styles.
  const style = el.getAttribute && el.getAttribute('style');
  if (style) {
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) add.push('bold');
    if (/font-style\s*:\s*italic/i.test(style)) add.push('italic');
    if (/text-decoration[^;]*line-through/i.test(style)) add.push('strike');
    if (/text-decoration[^;]*underline/i.test(style)) add.push('underline');
  }

  if (!add.length) return marks;
  const seen = new Set(marks);
  const next = marks.slice();
  for (const m of add) if (!seen.has(m)) next.push(m);
  return next;
}

function sameMarks(a, b) {
  const am = a || [];
  const bm = b || [];
  if (am.length !== bm.length) return false;
  const sa = am.map(m => m.type).sort();
  const sb = bm.map(m => m.type).sort();
  return sa.every((t, i) => t === sb[i]);
}

function mergeAdjacent(nodes) {
  const out = [];
  for (const n of nodes) {
    const prev = out[out.length - 1];
    if (n.type === 'text' && prev && prev.type === 'text' && sameMarks(prev.marks, n.marks)) {
      prev.text += n.text;
    } else {
      out.push(n.type === 'text' ? { ...n } : n);
    }
  }
  return out;
}

function trimInline(nodes) {
  if (nodes.length && nodes[0].type === 'text') {
    nodes[0] = { ...nodes[0], text: nodes[0].text.replace(/^\s+/, '') };
  }
  const lastIdx = nodes.length - 1;
  if (lastIdx >= 0 && nodes[lastIdx].type === 'text') {
    nodes[lastIdx] = { ...nodes[lastIdx], text: nodes[lastIdx].text.replace(/\s+$/, '') };
  }
  // ProseMirror rejects empty text nodes.
  return nodes.filter(n => !(n.type === 'text' && n.text === ''));
}

// ---------------------------------------------------------------------------
// 3. Plain text (legacy behavior, preserved)
// ---------------------------------------------------------------------------

function parsePlainText(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  return lines.map(line => {
    let type = 'paragraph';
    let contentText = line;
    if (line.startsWith('# ')) { type = 'h1'; contentText = line.substring(2); }
    else if (line.startsWith('## ')) { type = 'h2'; contentText = line.substring(3); }
    else if (line.startsWith('### ')) { type = 'h3'; contentText = line.substring(4); }
    return makeBlock(type, contentText ? [{ type: 'text', text: contentText }] : []);
  });
}
