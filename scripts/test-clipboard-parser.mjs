// Standalone test for src/lib/notion/clipboardParser.js
//
// No test runner is configured in this project, so this is a plain Node script.
// It polyfills DOMParser with linkedom (already a dependency) and asserts the
// parser's behavior across the three clipboard flavours.
//
//   Run:  node scripts/test-clipboard-parser.mjs

import { parseHTML } from 'linkedom';
import assert from 'node:assert';

// linkedom's own DOMParser mis-nests fragments (it makes the first tag the
// document root instead of placing content in <body>, the way real browsers
// do). parseHTML builds a correct document, so we adapt it into the minimal
// DOMParser shape the parser uses — matching browser behavior the parser
// actually runs against in production.
globalThis.DOMParser = class {
  parseFromString(str) {
    const { document } = parseHTML(`<!DOCTYPE html><html><head></head><body>${str}</body></html>`);
    return document;
  }
};

const { parseClipboard } = await import('../src/lib/notion/clipboardParser.js');

// Builds a fake clipboard from a { mime: payload } map.
function clip(map) {
  return { getData: (t) => map[t] || '' };
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

const types = (blocks) => blocks.map(b => b.type);
const text = (block) => (block.content || []).map(n => n.text || (n.type === 'hardBreak' ? '\n' : '')).join('');
const markTypes = (node) => (node.marks || []).map(m => m.type).sort();

console.log('clipboardParser');

// --- 1. Internal JSON (highest fidelity) ---------------------------------
test('internal JSON round-trips, with fresh ids and reset canvas', () => {
  const original = [
    { id: 'b_old1', type: 'h2', content: [{ type: 'text', text: 'Experience' }], canvas: { x: 1, y: 2 }, name: 'exp' },
    { id: 'b_old2', type: 'paragraph', content: [{ type: 'text', text: 'Did things' }], canvas: null }
  ];
  const blocks = parseClipboard(clip({ 'application/json': JSON.stringify(original) }));
  assert.deepEqual(types(blocks), ['h2', 'paragraph']);
  assert.equal(text(blocks[0]), 'Experience');
  assert.notEqual(blocks[0].id, 'b_old1');       // new id
  assert.equal(blocks[0].canvas, null);          // canvas reset
  assert.equal(blocks[0].name, 'exp');           // other fields preserved
});

test('internal JSON wins over html/text when all present', () => {
  const blocks = parseClipboard(clip({
    'application/json': JSON.stringify([{ id: 'x', type: 'h1', content: [{ type: 'text', text: 'J' }] }]),
    'text/html': '<p>H</p>',
    'text/plain': 'P'
  }));
  assert.equal(text(blocks[0]), 'J');
});

test('malformed JSON falls through to html', () => {
  const blocks = parseClipboard(clip({ 'application/json': '{not json', 'text/html': '<h1>Hi</h1>' }));
  assert.deepEqual(types(blocks), ['h1']);
  assert.equal(text(blocks[0]), 'Hi');
});

// --- 2. HTML (Notion / Google Docs / web) --------------------------------
test('Notion-style headings + paragraphs map to h1/h2/h3 + paragraph', () => {
  const html = `<meta charset='utf-8'><h1>Jane Doe</h1><h2>Experience</h2><p>Built systems.</p><h3>Skills</h3>`;
  const blocks = parseClipboard(clip({ 'text/html': html }));
  assert.deepEqual(types(blocks), ['h1', 'h2', 'paragraph', 'h3']);
  assert.deepEqual(blocks.map(text), ['Jane Doe', 'Experience', 'Built systems.', 'Skills']);
});

test('headings preserve document order', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<h1>A</h1><p>B</p><h2>C</h2>' }));
  assert.deepEqual(types(blocks), ['h1', 'paragraph', 'h2']);
  assert.deepEqual(blocks.map(text), ['A', 'B', 'C']);
});

test('inline marks: bold/italic/strike/underline', () => {
  const html = '<p>plain <strong>bold</strong> <em>it</em> <s>st</s> <u>un</u></p>';
  const blocks = parseClipboard(clip({ 'text/html': html }));
  assert.equal(blocks.length, 1);
  const nodes = blocks[0].content;
  const byText = (t) => nodes.find(n => n.text === t);
  assert.deepEqual(markTypes(byText('bold')), ['bold']);
  assert.deepEqual(markTypes(byText('it')), ['italic']);
  assert.deepEqual(markTypes(byText('st')), ['strike']);
  assert.deepEqual(markTypes(byText('un')), ['underline']);
});

test('nested marks combine (bold+italic)', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<p><strong><em>x</em></strong></p>' }));
  assert.deepEqual(markTypes(blocks[0].content[0]), ['bold', 'italic']);
});

test('Google Docs inline-style spans become marks', () => {
  const html = `<b style="font-weight:normal"><p><span style="font-weight:700">B</span><span style="font-style:italic">I</span></p></b>`;
  const blocks = parseClipboard(clip({ 'text/html': html }));
  assert.equal(blocks.length, 1);
  const nodes = blocks[0].content;
  assert.deepEqual(markTypes(nodes.find(n => n.text === 'B')), ['bold']);
  assert.deepEqual(markTypes(nodes.find(n => n.text === 'I')), ['italic']);
});

test('bulleted list items flatten to "• " paragraphs', () => {
  const html = '<ul><li>one</li><li>two</li></ul>';
  const blocks = parseClipboard(clip({ 'text/html': html }));
  assert.deepEqual(types(blocks), ['paragraph', 'paragraph']);
  assert.deepEqual(blocks.map(text), ['• one', '• two']);
});

test('ordered list items flatten with numeric prefixes', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<ol><li>a</li><li>b</li></ol>' }));
  assert.deepEqual(blocks.map(text), ['1. a', '2. b']);
});

test('nested lists indent with nbsp + depth-appropriate sub-bullet', () => {
  const html = '<ul><li>parent<ul><li>child</li></ul></li></ul>';
  const blocks = parseClipboard(clip({ 'text/html': html }));
  const NBSP = '\u00A0';
  assert.deepEqual(blocks.map(text), ['• parent', NBSP.repeat(3) + '◦ child']);
});

test('table rows flatten to pipe-joined paragraphs', () => {
  const html = '<table><tr><td>r1c1</td><td>r1c2</td></tr><tr><td>r2c1</td><td>r2c2</td></tr></table>';
  const blocks = parseClipboard(clip({ 'text/html': html }));
  assert.deepEqual(blocks.map(text), ['r1c1 | r1c2', 'r2c1 | r2c2']);
});

test('blockquote flattens to a paragraph', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<blockquote>quoted</blockquote>' }));
  assert.deepEqual(types(blocks), ['paragraph']);
  assert.equal(text(blocks[0]), 'quoted');
});

test('<br> becomes a hardBreak', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<p>line1<br>line2</p>' }));
  const nodeTypes = blocks[0].content.map(n => n.type);
  assert.ok(nodeTypes.includes('hardBreak'));
  assert.equal(text(blocks[0]), 'line1\nline2');
});

test('source whitespace/newlines are collapsed', () => {
  const html = '<p>  lots\n   of    space  </p>';
  const blocks = parseClipboard(clip({ 'text/html': html }));
  assert.equal(text(blocks[0]), 'lots of space');
});

test('hr and stray block tags are dropped, not crash', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<p>a</p><hr><p>b</p>' }));
  assert.deepEqual(blocks.map(text), ['a', 'b']);
});

test('div-wrapped blocks recurse', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<div><div><h2>H</h2><p>P</p></div></div>' }));
  assert.deepEqual(types(blocks), ['h2', 'paragraph']);
});

test('no usable inline content yields no blocks (html → null → fallback skipped)', () => {
  const blocks = parseClipboard(clip({ 'text/html': '<hr><br>' }));
  assert.equal(blocks, null);
});

// --- 3. Plain text fallback ----------------------------------------------
test('plain text splits on newlines with markdown heading prefixes', () => {
  const blocks = parseClipboard(clip({ 'text/plain': '# Title\nbody\n## Sub' }));
  assert.deepEqual(types(blocks), ['h1', 'paragraph', 'h2']);
  assert.deepEqual(blocks.map(text), ['Title', 'body', 'Sub']);
});

test('empty clipboard returns null', () => {
  assert.equal(parseClipboard(clip({})), null);
  assert.equal(parseClipboard(null), null);
});

console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
