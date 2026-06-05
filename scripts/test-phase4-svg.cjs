/**
 * Phase 4 SVG smoke test.
 */
const { initFonts } = require('../src/lib/layout/fonts.js');
const { computeLayout, blockRectMm } = require('../src/lib/layout/index.js');
const { renderBlockSVG } = require('../src/lib/layout/render-svg.js');

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

  const block = {
    id: 'b1',
    type: 'paragraph',
    content: [{ type: 'text', text: 'Hello World' }],
    canvas: { page: 1, col: 0, row: 0, colSpan: 2, rowSpan: 2 },
  };
  const rect = blockRectMm(block.canvas, 15);
  const lo = computeLayout(block, rect, ctx);
  const svg = renderBlockSVG(lo, { glyphMode: 'text' });
  console.log('SVG output (first 500 chars):');
  console.log(svg.slice(0, 500));

  console.log('\nPhase 4 SVG smoke test passed.');
})();
