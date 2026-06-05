/**
 * Phase 3 smoke test — computeLayout for text blocks, pass-through, unplaced.
 */
const { initFonts } = require('../src/lib/layout/fonts.js');
const { computeLayout } = require('../src/lib/layout/index.js');
const { blockRectMm } = require('../src/lib/layout/units.js');

(async () => {
  await initFonts();

  const ctx = {
    templateName: 'clean',
    customTemplates: {},
    paddingMm: 15,
    themeColors: {
      h1Font: 'Inter', h2Font: 'Inter', h3Font: 'Inter', textFont: 'Inter',
      h1Color: '#111111', h2Color: '#111111', h3Color: '#111111', textColor: '#4b4b4b',
      backgroundColor: '#ffffff',
    },
  };

  // Test 1: Text paragraph with hardBreaks
  const textBlock = {
    id: 'b1',
    type: 'paragraph',
    content: [
      { type: 'text', text: 'First line of text.' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Second line after break.' },
      { type: 'hardBreak' },
      { type: 'hardBreak' },
      { type: 'text', text: 'After double break.' },
    ],
    canvas: { page: 1, col: 0, row: 0, colSpan: 4, rowSpan: 5 },
  };
  const rect1 = blockRectMm(textBlock.canvas, 15);
  const lo1 = computeLayout(textBlock, rect1, ctx);
  console.log('Text block with hardBreaks:');
  console.log('  lines:', lo1.lines.length, 'usedHeight:', lo1.usedHeightMm.toFixed(2), 'overflow:', lo1.overflow);
  for (let i = 0; i < lo1.lines.length; i++) {
    const t = lo1.lines[i].glyphs.map(g => g.char).join('');
    console.log(`  Line ${i + 1}: "${t}"`);
  }

  // Test 2: h2 with border-bottom
  const h2Block = {
    id: 'b2',
    type: 'h2',
    content: [{ type: 'text', text: 'Section Title' }],
    canvas: { page: 1, col: 0, row: 5, colSpan: 4, rowSpan: 3 },
  };
  const rect2 = blockRectMm(h2Block.canvas, 15);
  const lo2 = computeLayout(h2Block, rect2, ctx);
  console.log('\nH2 with border:');
  console.log('  lines:', lo2.lines.length, 'usedHeight:', lo2.usedHeightMm.toFixed(2));
  console.log('  decorations:', JSON.stringify(lo2.decorations));

  // Test 3: Pass-through divider
  const dividerBlock = {
    id: 'b3',
    type: 'horizontal_divider',
    source: 'canvas',
    elementType: 'horizontal_divider',
    canvas: { page: 1, col: 0, row: 10, colSpan: 0, rowSpan: 1 },
  };
  const rect3 = blockRectMm(dividerBlock.canvas, 15);
  const lo3 = computeLayout(dividerBlock, rect3, ctx);
  console.log('\nDivider pass-through:');
  console.log('  kind:', lo3.kind, 'usedHeight:', lo3.usedHeightMm);

  // Test 4: Unplaced block
  const unplacedBlock = {
    id: 'b4',
    type: 'paragraph',
    content: [{ type: 'text', text: 'This is an unplaced block with some text content.' }],
    canvas: null,
  };
  const lo4 = computeLayout(unplacedBlock, null, ctx);
  console.log('\nUnplaced block:');
  console.log('  placement:', lo4.placement, 'lines:', lo4.lines.length, 'overflow:', lo4.overflow);
  console.log('  blockWidthMm:', lo4.blockWidthMm, 'blockHeightMm:', lo4.blockHeightMm);

  // Test 5: Overflow detection
  const longBlock = {
    id: 'b5',
    type: 'paragraph',
    content: [{ type: 'text', text: 'This is a very long paragraph that should definitely overflow a small block because there is way too much text to fit inside just a few millimeters of vertical space.' }],
    canvas: { page: 1, col: 0, row: 0, colSpan: 2, rowSpan: 2 },
  };
  const rect5 = blockRectMm(longBlock.canvas, 15);
  const lo5 = computeLayout(longBlock, rect5, ctx);
  console.log('\nOverflow block (2 rows = 10mm):');
  console.log('  usedHeight:', lo5.usedHeightMm.toFixed(2), 'overflow:', lo5.overflow, 'maxLines:', lo5.maxLines, 'linesRemaining:', lo5.linesRemaining);

  console.log('\nPhase 3 smoke test passed.');
})();
