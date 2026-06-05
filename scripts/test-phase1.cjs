/**
 * Phase 1 smoke test — verify shapeRun + breakLines + layoutSingleRun.
 */
const { initFonts, getFont } = require('../src/lib/layout/fonts.js');
const { breakLines } = require('../src/lib/layout/linebreak.js');
const { shapeRun } = require('../src/lib/layout/shape.js');
const { layoutSingleRun } = require('../src/lib/layout/paragraph.js');

(async () => {
  await initFonts();

  // Inter 400 / 4mm / line-height 5mm
  const fontResult = getFont('Inter', 400, 'normal');
  const runStyle = {
    font: fontResult.font,
    unitsPerEm: fontResult.font.unitsPerEm,
    fontSizeMm: 4,
    lineHeightMm: 5,
    color: '#111111',
    letterSpacingMm: 0,
    textTransform: 'none',
    underline: false,
    strike: false,
    faux: { italic: false, bold: false },
  };

  // Test 1: shapeRun
  const text = 'Hello World AV To';
  const glyphs = shapeRun(text, runStyle);
  console.log('Shaped', glyphs.length, 'glyphs');
  console.log('  H:', glyphs[0].advanceMm.toFixed(3), 'mm');
  console.log('  e:', glyphs[1].advanceMm.toFixed(3), 'mm');
  console.log('  l:', glyphs[2].advanceMm.toFixed(3), 'mm');

  // Test 2: breakLines
  const longText = 'This is a longer paragraph that should wrap across multiple lines when given a narrow enough column width.';
  const longGlyphs = shapeRun(longText, runStyle);
  const contentWidth = 40; // mm
  const lines = breakLines(longGlyphs, contentWidth);
  console.log('\nBroken into', lines.length, 'lines at', contentWidth, 'mm:');
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i].glyphs.map(g => g.char).join('');
    console.log(`  Line ${i + 1}: "${lineText}" (${lines[i].widthMm.toFixed(2)} mm)`);
  }

  // Test 3: layoutSingleRun with overflow
  const lo = layoutSingleRun(longText, runStyle, contentWidth, 20); // 20mm = 4 lines max
  console.log('\nLaidOutBlock:');
  console.log('  lines:', lo.lines.length);
  console.log('  usedHeightMm:', lo.usedHeightMm.toFixed(2));
  console.log('  maxLines:', lo.maxLines);
  console.log('  linesRemaining:', lo.linesRemaining);
  console.log('  overflow:', lo.overflow);

  // Test 4: uppercase + letter-spacing
  const h2Style = {
    ...runStyle,
    textTransform: 'uppercase',
    letterSpacingMm: (1.5 * 25.4) / 72, // 1.5pt in mm
  };
  const upperGlyphs = shapeRun('hello', h2Style);
  const normalGlyphs = shapeRun('hello', runStyle);
  console.log('\nUppercase + tracking:', upperGlyphs.reduce((s, g) => s + g.advanceMm, 0).toFixed(3), 'mm');
  console.log('Normal:', normalGlyphs.reduce((s, g) => s + g.advanceMm, 0).toFixed(3), 'mm');

  console.log('\nPhase 1 smoke test passed.');
})();
