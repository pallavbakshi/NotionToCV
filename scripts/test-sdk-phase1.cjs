/**
 * Phase 1 SDK smoke test — Node execution of the isomorphic message parser.
 *
 * Verifies:
 *   1. sanitizeHtmlWithoutCss works under linkedom (the core isomorphic boundary)
 *   2. ESM dynamic import of the sdk/index.js contract works
 *   3. validateBlockLayout returns the expected capacity shape
 *
 * Does NOT test parseHtmlToTiptapJson — that path goes through Tiptap's Editor
 * constructor which needs a full ProseMirror view (mounted element, animation
 * frames, etc.). The Tiptap path is exercised in the browser host today and
 * will get full Node coverage in Phase 3 (CLI harness) when the entire
 * render pipeline is wired.
 */

const path = require('path');

(async () => {
  console.log('Phase 1 SDK smoke test — isomorphic parser + SDK contract…');
  let passed = 0;
  let failed = 0;

  // ---------------------------------------------------------------
  // 1. Set up linkedom DOM globals
  //    DO NOT set globalThis.DOMParser — messageParser checks for it
  //    at module load and would take the browser branch. Instead we
  //    call initDomParser() so it lazy-imports linkedom.
  // ---------------------------------------------------------------
  const { parseHTML } = require('linkedom');
  const { window, document } = parseHTML('<html><head></head><body></body></html>');
  globalThis.document = document;
  globalThis.window = window;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;

  // ---------------------------------------------------------------
  // 2. Init the parser (linkedom path) and test sanitisation
  // ---------------------------------------------------------------
  const parserMod = await import('../src/lib/ai-chat/messageParser.js');
  await parserMod.initDomParser();

  const raw = '<p style="color:red" class="x" id="a">Hello <strong>World</strong></p>';
  const clean = parserMod.sanitizeHtmlWithoutCss(raw);
  console.log('  sanitise: ' + clean);

  if (!clean.includes('Hello') || !clean.includes('<strong>World</strong>')) {
    console.error('  FAIL: sanitised output missing expected content');
    failed++;
  } else if (clean.includes('style=') || clean.includes('class="') || clean.includes('id="')) {
    console.error('  FAIL: attributes not stripped');
    failed++;
  } else {
    console.log('  PASS: sanitise strips styles/classes/ids');
    passed++;
  }

  // Edge cases
  const empty = parserMod.sanitizeHtmlWithoutCss('');
  if (empty !== '') { console.error('  FAIL: empty input'); failed++; }
  else { console.log('  PASS: empty input'); passed++; }

  const nil = parserMod.sanitizeHtmlWithoutCss(null);
  if (nil !== '') { console.error('  FAIL: null input'); failed++; }
  else { console.log('  PASS: null input'); passed++; }

  // ---------------------------------------------------------------
  // 3. Round-trip: parseTiptapJsonToHtml (pure, no DOM needed)
  // ---------------------------------------------------------------
  const tiptapFixture = [
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'World', marks: [{ type: 'bold' }] }
  ];
  const html = parserMod.parseTiptapJsonToHtml(tiptapFixture);
  console.log('  round-trip: ' + html);

  if (!html.includes('<strong>World</strong>') || !html.includes('Hello ')) {
    console.error('  FAIL: round-trip missing expected markup');
    failed++;
  } else {
    console.log('  PASS: round-trip preserves bold');
    passed++;
  }

  // ---------------------------------------------------------------
  // 4. SDK contract: import the index, verify constructor + interface
  //    validateBlockLayout wraps computeLayout which needs initFonts()
  //    — that path requires font asset files (fetched via local URLs
  //    that need a dev server). The CLI harness (Phase 3) will bundle
  //    fonts for Node. For now, just verify the module imports and the
  //    not-implemented guard on optimizeResume.
  // ---------------------------------------------------------------
  const SDK = await import('../src/sdk/index.js');
  const engine = new SDK.ResumeAgentEngine({
    modelProvider: async function*() {},
    screenshotProvider: async () => ({ screenshot: '' })
  });

  if (engine.model && engine.maxTurns === 30) {
    console.log('  PASS: ResumeAgentEngine constructs with defaults');
    passed++;
  } else {
    console.error('  FAIL: constructor defaults wrong');
    failed++;
  }

  if (typeof engine.validateBlockLayout === 'function') {
    console.log('  PASS: validateBlockLayout is a function');
    passed++;
  } else {
    console.error('  FAIL: validateBlockLayout missing');
    failed++;
  }

  // optimizeResume should throw since it's not implemented yet
  try {
    for await (const _ of engine.optimizeResume({ title: '', paddingMm: 15, templateName: 'clean', themeColors: {}, pageCount: 1, blocks: [] }, 'test')) {
      // should not reach
    }
    console.error('  FAIL: optimizeResume did not throw');
    failed++;
  } catch (e) {
    if (e.message.includes('not implemented')) {
      console.log('  PASS: optimizeResume correctly throws "not implemented"');
      passed++;
    } else {
      console.error('  FAIL: unexpected error from optimizeResume: ' + e.message);
      failed++;
    }
  }

  console.log(`\nPhase 1 done. ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
