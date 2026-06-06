/**
 * Phase 2 smoke test — mock-provider harness for the agent engine.
 * Verifies: normal run, 30-turn cap, abort, coach mode, staged_change → transaction.
 */

const path = require('path');

(async () => {
  console.log('Phase 2 SDK smoke test — agent engine…');
  let passed = 0;
  let failed = 0;

  // ---------------------------------------------------------------
  // 1. Set up linkedom DOM for htmlToInlineNodes in Node.
  //    DO NOT set globalThis.window — initFonts() uses typeof window === 'undefined'
  //    to decide between Node (readFile) and browser (fetch). Setting window would
  //    break font loading.
  const { parseHTML } = require('linkedom');
  const { document } = parseHTML('<html><head></head><body></body></html>');
  globalThis.document = document;
  globalThis.HTMLElement = globalThis.HTMLElement || document.defaultView.HTMLElement;
  globalThis.Node = globalThis.Node || document.defaultView.Node;

  const { ResumeAgentEngine, initSdkDomParser, htmlToInlineNodes } = await import('../src/sdk/index.js');
  await initSdkDomParser();

  const { sanitizeHtmlWithoutCss, initDomParser } = await import('../src/lib/ai-chat/messageParser.js');
  await initDomParser();

  // ---------------------------------------------------------------
  // 2. Test htmlToInlineNodes — 11 HTML patterns (DoD: all under linkedom)
  //    htmlToInlineNodes receives already-sanitised HTML.
  //    Sanitisation is verified separately in Phase 1 / the tool path.
  // ---------------------------------------------------------------
  {
    const patterns = [
      { label: 'plain text',           html: '<p>Hello</p>',               expect: n => n.length === 1 && n[0].text === 'Hello' && !n[0].marks?.length },
      { label: 'bold',                 html: '<p><strong>Bold</strong></p>', expect: n => n[0].marks?.some(m => m.type === 'bold') },
      { label: 'italic',               html: '<p><em>Italic</em></p>',       expect: n => n[0].marks?.some(m => m.type === 'italic') },
      { label: 'underline',            html: '<p><u>Under</u></p>',          expect: n => n[0].marks?.some(m => m.type === 'underline') },
      { label: 'strike',               html: '<p><s>Strike</s></p>',         expect: n => n[0].marks?.some(m => m.type === 'strike') },
      { label: 'mixed marks',          html: '<p><strong><em>Both</em></strong></p>', expect: n => { const m = n[0].marks; return m?.some(x => x.type === 'bold') && m?.some(x => x.type === 'italic'); } },
      { label: '<br>',                 html: '<p>Line1<br>Line2</p>',        expect: n => n[1]?.type === 'hardBreak' },
      { label: 'multi-<p>',            html: '<p>A</p><p>B</p>',             expect: n => n[1]?.type === 'hardBreak' },
      { label: 'nested marks',         html: '<p><strong>Bold <em>Both</em></strong></p>', expect: n => n.length === 2 && n[1].marks?.some(m => m.type === 'bold') && n[1].marks?.some(m => m.type === 'italic') },
      { label: 'empty string',         html: '',                             expect: n => n.length === 0 },
      { label: 'null/undefined',       html: null,                           expect: n => n.length === 0 },
    ];

    for (const { label, html, expect } of patterns) {
      const sanitised = typeof html === 'string' ? sanitizeHtmlWithoutCss(html) : '';
      const nodes = htmlToInlineNodes(sanitised);
      if (expect(nodes)) {
        console.log(`  PASS: htmlToInlineNodes — ${label}`);
        passed++;
      } else {
        console.error(`  FAIL: htmlToInlineNodes — ${label}: got ${JSON.stringify(nodes)}`);
        failed++;
      }
    }
  }

  // Sample resume state — all blocks unplaced to avoid the font-dependent
  // computeLayout path in pure Node (initFonts requires fetch('/fonts/...')).
  // The engine exercises all code paths except layout computation; Phase 3
  // (CLI harness) will test capacity checks end-to-end with real fonts.
  const sampleState = {
    title: 'Test Resume',
    paddingMm: 15,
    templateName: 'clean',
    themeColors: {
      h1Font: 'Inter', h2Font: 'Inter', h3Font: 'Inter', textFont: 'Inter',
      h1Color: '#111', h2Color: '#111', h3Color: '#111', textColor: '#111',
      backgroundColor: '#ffffff'
    },
    pageCount: 1,
    blocks: [
      { id: 'b1', type: 'paragraph', name: 'summary', content: [{ type: 'text', text: 'Experienced engineer.' }], canvas: null, locked: false },
      { id: 'b2', type: 'paragraph', name: 'locked-block', content: [{ type: 'text', text: 'Cannot touch this.' }], canvas: null, locked: true },
      { id: 'b3', type: 'paragraph', name: 'unplaced', content: [{ type: 'text', text: 'Not on canvas.' }], canvas: null, locked: false }
    ]
  };

  const mockScreenshotProvider = async () => ({ screenshot: 'mock-base64' });

  // ---------------------------------------------------------------
  // 3. Helper: collect all events from a run
  // ---------------------------------------------------------------
  async function collectEvents(engine, state, instruction = 'test', opts = {}) {
    const events = [];
    try {
      for await (const ev of engine.optimizeResume(state, instruction, opts)) {
        events.push(ev);
      }
    } catch (e) {
      events.push({ type: 'error', error: e.message });
    }
    return events;
  }

  // ---------------------------------------------------------------
  // 4. Test 1 — Normal run: read → update → model_complete
  // ---------------------------------------------------------------
  {
    let callCount = 0;
    async function* normalProvider() {
      callCount++;
      if (callCount === 1) {
        // Turn 1: text + read_block tool call
        yield {
          content: 'Let me check your resume…',
          tool_calls: [{ index: 0, id: 'tc1', function: { name: 'read_block', arguments: JSON.stringify({ id: 'b1' }) } }]
        };
        yield { content: ' Looking at summary…' };
      } else if (callCount === 2) {
        // Turn 2: text + update_block_content
        yield {
          content: 'I will update it.',
          tool_calls: [{ index: 0, id: 'tc2', function: { name: 'update_block_content', arguments: JSON.stringify({ id: 'b1', html_without_css: '<p>Senior engineer with 10+ years.</p>' }) } }]
        };
      }
      // callCount >= 3: yield nothing → model has no tool calls → model_complete
    }

    const engine = new ResumeAgentEngine({
      modelProvider: normalProvider,
      screenshotProvider: mockScreenshotProvider
    });

    const events = await collectEvents(engine, sampleState, 'test', { mode: 'agent' });

    const types = events.map(e => e.type);
    console.log('  Run 1 event sequence:', types.join(' → '));

    if (types.includes('text') && types.includes('tool_call') && types.includes('tool_result')) {
      console.log('  PASS: emits text, tool_call, tool_result');
      passed++;
    } else { failed++; }

    const stagedEv = events.find(e => e.type === 'staged_change');
    if (stagedEv && stagedEv.blockId === 'b1') {
      console.log('  PASS: staged_change emitted for updated block');
      passed++;
    } else { failed++; }

    const doneEv = events[events.length - 1];
    if (doneEv.type === 'done' && doneEv.reason === 'model_complete') {
      console.log('  PASS: terminal done with reason=model_complete');
      passed++;
    } else { failed++; }

    if (doneEv.transaction?.stagedChanges?.b1) {
      console.log('  PASS: transaction carries stagedChanges.b1');
      passed++;
    } else { failed++; }
  }

  // ---------------------------------------------------------------
  // 5. Test 2 — 30-turn cap
  // ---------------------------------------------------------------
  {
    async function* neverEndingProvider() {
      yield {
        tool_calls: [{ index: 0, id: 'tc_loop', function: { name: 'read_block', arguments: JSON.stringify({ id: 'b1' }) } }]
      };
    }

    const engine = new ResumeAgentEngine({
      modelProvider: neverEndingProvider,
      screenshotProvider: mockScreenshotProvider
    });

    const events = await collectEvents(engine, sampleState, 'test', { mode: 'agent' });
    const toolCallEvents = events.filter(e => e.type === 'tool_call');
    const doneEv = events[events.length - 1];

    console.log(`  Cap test: ${toolCallEvents.length} tool_call events, final reason: ${doneEv.reason}`);

    if (toolCallEvents.length === 30) {
      console.log('  PASS: exactly 30 tool-call turns');
      passed++;
    } else { failed++; }

    if (doneEv.type === 'done' && doneEv.reason === 'max_turns') {
      console.log('  PASS: capped with reason=max_turns');
      passed++;
    } else { failed++; }

    // Verify the engine stops calling provider after cap
    // We can't easily test that, but if toolCallEvents === 30, the loop stopped
  }

  // ---------------------------------------------------------------
  // 6. Test 3 — Abort mid-loop
  // ---------------------------------------------------------------
  {
    let yielded = false;
    async function* abortableProvider() {
      // First delta: text
      yield { content: 'Thinking…' };
      // Second delta: tool call that will trigger abort
      if (!yielded) {
        yielded = true;
        yield {
          tool_calls: [{ index: 0, id: 'tc_abort', function: { name: 'read_block', arguments: JSON.stringify({ id: 'b1' }) } }]
        };
      }
    }

    const controller = new AbortController();
    const engine = new ResumeAgentEngine({
      modelProvider: abortableProvider,
      screenshotProvider: mockScreenshotProvider
    });

    const events = [];
    try {
      for await (const ev of engine.optimizeResume(sampleState, 'test', { mode: 'agent', signal: controller.signal })) {
        events.push(ev);
        if (ev.type === 'tool_call') {
          controller.abort(); // abort after first tool call dispatched
        }
      }
    } catch (_e) { /* ignore */ }

    const doneEv = events[events.length - 1];
    console.log('  Abort test final event:', doneEv?.type, doneEv?.reason);

    if (doneEv?.type === 'done' && doneEv?.reason === 'aborted') {
      console.log('  PASS: abort terminates with reason=aborted');
      passed++;
    } else { failed++; }
  }

  // ---------------------------------------------------------------
  // 7. Test 4 — Coach mode (no tools, just text)
  // ---------------------------------------------------------------
  {
    async function* coachProvider() {
      yield { content: 'Your resume looks great!' };
      yield { content: ' Consider adding metrics.' };
    }

    const engine = new ResumeAgentEngine({
      modelProvider: coachProvider,
      screenshotProvider: mockScreenshotProvider
    });

    const events = await collectEvents(engine, sampleState, 'test', { mode: 'coach' });

    const types = events.map(e => e.type);
    console.log('  Coach mode events:', types.join(' → '));

    const hasToolCall = events.some(e => e.type === 'tool_call');
    const hasText = events.some(e => e.type === 'text');
    const doneEv = events[events.length - 1];

    if (!hasToolCall) {
      console.log('  PASS: coach mode has no tool calls');
      passed++;
    } else { failed++; }

    if (hasText) {
      console.log('  PASS: coach mode emits text');
      passed++;
    } else { failed++; }

    if (doneEv?.type === 'done' && doneEv?.reason === 'model_complete') {
      console.log('  PASS: coach mode ends with model_complete');
      passed++;
    } else { failed++; }
  }

  // ---------------------------------------------------------------
  // 8. Test 5 — Locked block rejection
  // ---------------------------------------------------------------
  {
    async function* lockedTestProvider() {
      yield {
        tool_calls: [{ index: 0, id: 'tc_lock', function: { name: 'update_block_content', arguments: JSON.stringify({ id: 'b2', html_without_css: '<p>Changed!</p>' }) } }]
      };
    }

    const engine = new ResumeAgentEngine({
      modelProvider: lockedTestProvider,
      screenshotProvider: mockScreenshotProvider
    });

    const events = await collectEvents(engine, sampleState, 'test', { mode: 'agent' });
    const toolResult = events.find(e => e.type === 'tool_result');

    if (toolResult?.result?.error && toolResult.result.error.includes('locked')) {
      console.log('  PASS: locked block edit returns error, no staged change');
      passed++;
    } else { failed++; }

    const hasStaged = events.some(e => e.type === 'staged_change');
    if (!hasStaged) {
      console.log('  PASS: no staged_change emitted for locked block');
      passed++;
    } else { failed++; }
  }

  // ---------------------------------------------------------------
  // 9. Test 6 — Default messages when none provided
  // ---------------------------------------------------------------
  {
    async function* silentProvider() {
      // No deltas → immediate model_complete
    }

    const engine = new ResumeAgentEngine({
      modelProvider: silentProvider,
      screenshotProvider: mockScreenshotProvider
    });

    const events = await collectEvents(engine, sampleState, 'test', { mode: 'agent' });
    const doneEv = events[events.length - 1];

    if (doneEv?.type === 'done' && doneEv?.reason === 'model_complete') {
      console.log('  PASS: empty provider completes cleanly');
      passed++;
    } else { failed++; }
  }

  // ---------------------------------------------------------------
  console.log(`\nPhase 2 done. ${passed} passed, ${failed} failed.`);
  process.exit(failed > 0 ? 1 : 0);
})();
