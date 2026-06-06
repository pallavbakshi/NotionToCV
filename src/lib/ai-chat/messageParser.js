// Pure functions for HTML ↔ Tiptap JSON conversion used by the AI chat subsystem.
// Isomorphic: works in browser (native DOMParser) and Node (linkedom, after initDomParser).

import { Editor } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { FontFamily } from '@tiptap/extension-font-family';

// Internal DOM parser adapter — browser uses native DOMParser, Node uses linkedom.
// In the browser this is set at module load time (synchronous, no init needed).
// In Node the caller must await initDomParser() before any parse call.
let _parseDocument;

if (typeof DOMParser !== 'undefined') {
  _parseDocument = (html) => new DOMParser().parseFromString(html, 'text/html');
}

/**
 * Initialise the DOM parser for Node environments. No-op in the browser.
 * Must be called before sanitizeHtmlWithoutCss() or parseHtmlToTiptapJson()
 * when running under Node.
 */
export async function initDomParser() {
  if (!_parseDocument) {
    const { parseHTML } = await import('linkedom');
    _parseDocument = (html) => {
      const { document } = parseHTML('<html><body>' + (html || '') + '</body></html>');
      return document;
    };
  }
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function parseHtmlToTiptapJson(html, blockType) {
  const isHeading = blockType === 'h1' || blockType === 'h2' || blockType === 'h3';
  const wrapperHtml = isHeading ? `<h${blockType[1]}>${html}</h${blockType[1]}>` : `<div>${html}</div>`;

  const tempEditor = new Editor({
    extensions: [
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
    ],
    content: wrapperHtml,
  });

  const json = tempEditor.getJSON();
  tempEditor.destroy();

  // Tiptap may parse the proposal into MULTIPLE top-level block nodes (several
  // <p>s, or a list whose items get demoted to paragraphs). The engine stores a
  // block's text as ONE flat inline array with hardBreak separators, so previously
  // returning only content[0].content silently dropped everything after the first
  // block. Flatten every block's inline content into one array, joining blocks with
  // a hardBreak (a paragraph break maps to a line break within the canvas block).
  const blockNodes = json.content ?? [];
  const inline = [];
  for (let i = 0; i < blockNodes.length; i++) {
    const childContent = blockNodes[i].content ?? [];
    if (i > 0 && childContent.length > 0) inline.push({ type: 'hardBreak' });
    inline.push(...childContent);
  }
  return inline;
}

export function parseTiptapJsonToHtml(content) {
  if (!content || !Array.isArray(content)) return '';
  return content.map(node => {
    if (node.type === 'text') {
      let text = escapeHtml(node.text || '');
      if (node.marks) {
        for (const mark of node.marks) {
          if (mark.type === 'bold') text = `<strong>${text}</strong>`;
          if (mark.type === 'italic') text = `<em>${text}</em>`;
          if (mark.type === 'underline') text = `<u>${text}</u>`;
          if (mark.type === 'strike') text = `<s>${text}</s>`;
        }
      }
      return text;
    } else if (node.type === 'hardBreak') {
      return '<br/>';
    }
    return '';
  }).join('');
}

export function sanitizeHtmlWithoutCss(input) {
  const doc = _parseDocument(input || '');
  doc.body.querySelectorAll('*').forEach(el => {
    el.removeAttribute('style');
    el.removeAttribute('class');
    el.removeAttribute('id');
  });
  return doc.body.innerHTML;
}
