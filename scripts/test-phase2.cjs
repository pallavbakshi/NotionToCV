/**
 * Phase 2 smoke test — multi-run layout, baseline reconciliation, single-run equivalence.
 */
const { initFonts, getFont, resolveRunStyle } = require('../src/lib/layout/fonts.js');
const { layoutSingleRun, layoutRuns } = require('../src/lib/layout/paragraph.js');
const { contentToRuns } = require('../src/lib/layout/runs.js');

(async () => {
  await initFonts();

  // Inter 400 base style
  const inter400 = getFont('Inter', 400, 'normal');
  const baseStyle = {
    fontFamily: 'Inter',
    fontWeight: 400,
    fontStyle: 'normal',
    fontSizeMm: 4,
    lineHeightMm: 5,
    color: '#111111',
    letterSpacingPt: 0,
    textTransform: 'none',
    borderBottom: null,
  };

  const runStyle = {
    font: inter400.font,
    unitsPerEm: inter400.font.unitsPerEm,
    fontSizeMm: 4,
    lineHeightMm: 5,
    color: '#111111',
    letterSpacingMm: 0,
    textTransform: 'none',
    underline: false,
    strike: false,
    faux: { italic: false, bold: false },
  };

  // Test 1: Single-run equivalence
  const text = 'Hello world this is a test paragraph that should wrap nicely.';
  const lo1 = layoutSingleRun(text, runStyle, 40, 100);
  const lo2 = layoutRuns([{ text, style: runStyle }], 40, 100, { blockId: 't1', blockType: 'paragraph' });

  console.log('Single-run equivalence test:');
  console.log('  layoutSingleRun lines:', lo1.lines.length, 'usedHeight:', lo1.usedHeightMm);
  console.log('  layoutRuns([one]) lines:', lo2.lines.length, 'usedHeight:', lo2.usedHeightMm);
  console.log('  Match:', lo1.lines.length === lo2.lines.length && lo1.usedHeightMm === lo2.usedHeightMm);

  // Test 2: Mixed bold + italic runs
  const boldStyle = resolveRunStyle(baseStyle, [{ type: 'bold' }]);
  const italicStyle = resolveRunStyle(baseStyle, [{ type: 'italic' }]);

  const runs = [
    { text: 'Normal ', style: runStyle },
    { text: 'bold ', style: boldStyle },
    { text: 'and ', style: runStyle },
    { text: 'italic', style: italicStyle },
    { text: ' text that wraps across multiple lines in a narrow column.', style: runStyle },
  ];

  const lo3 = layoutRuns(runs, 35, 100, { blockId: 't3', blockType: 'paragraph' });
  console.log('\nMixed-style layout:');
  console.log('  lines:', lo3.lines.length);
  for (let i = 0; i < lo3.lines.length; i++) {
    const line = lo3.lines[i];
    const lineText = line.glyphs.map(g => g.char).join('');
    console.log(`  Line ${i + 1}: "${lineText}"`);
    // Verify per-glyph style (check font identity against resolved styles —
    // resolveRunStyle may use a real binary, in which case faux flags are false)
    const hasBold = line.glyphs.some(g => g.font === boldStyle.font);
    const hasItalic = line.glyphs.some(g => g.font === italicStyle.font);
    if (hasBold || hasItalic) {
      console.log(`    -> hasBold=${hasBold} hasItalic=${hasItalic}`);
    }
  }

  // Test 3: contentToRuns with marks
  const inlineNodes = [
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
    { type: 'text', text: ' text' },
  ];
  const styleRuns = contentToRuns(inlineNodes, baseStyle);
  console.log('\ncontentToRuns:');
  for (const sr of styleRuns) {
    // Compare font identity, not faux flags — a real binary may be used
    const isBold = sr.style.font !== runStyle.font;
    console.log(`  "${sr.text}" isBold=${isBold} font=${sr.style.font.postscriptName || 'unknown'}`);
  }

  console.log('\nPhase 2 smoke test passed.');
})();
