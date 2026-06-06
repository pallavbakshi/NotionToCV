#!/usr/bin/env node

/**
 * jd-pipeline.cjs — JD-Matching Pipeline (Phase 6).
 *
 * Ingests a master CV and a set of Job Descriptions, runs requirement extraction
 * and relevance-filter pre-passes, then tailors the resume per JD via the SDK
 * engine (with strict capacity), and generates a mathematically-fit PDF per
 * application.
 *
 * Usage:
 *   node scripts/jd-pipeline.cjs --master master.json --jds ./job-descriptions/ --output ./out/
 *     [--verbose] [--concurrency 3] [--cost-cap 5.00]
 *
 * Supports direct mode (default) and queued mode (--queued, requires running server).
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------
// 1. CLI arg parsing
// ---------------------------------------------------------------

const args = process.argv.slice(2);
const opts = { concurrency: 5 };

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--master':       opts.master      = args[++i]; break;
    case '--jds':          opts.jdsDir      = args[++i]; break;
    case '--jd':           opts.jdFile      = args[++i]; break;
    case '--output':       opts.output      = args[++i]; break;
    case '--concurrency': {
      const val = args[++i];
      if (!val || val.startsWith('--')) { console.error('--concurrency requires a numeric value'); process.exit(2); }
      opts.concurrency = parseInt(val) || 5;
      break;
    }
    case '--cost-cap': {
      const val = args[++i];
      if (!val || val.startsWith('--')) { console.error('--cost-cap requires a numeric value'); process.exit(2); }
      opts.costCap = parseFloat(val) || 0;
      break;
    }
    case '--queued':       opts.queued      = true; break;
    case '--verbose':      opts.verbose     = true; break;
    case '--help':
      console.log([
        'jd-pipeline.cjs — JD-Matching Pipeline',
        '',
        'Usage:',
        '  node scripts/jd-pipeline.cjs --master <cv.json> --jds <dir/> --output <dir/> [options]',
        '',
        'Options:',
        '  --master <path>       Master CV ResumeState JSON (required)',
        '  --jds <dir>           Directory of JD .txt files (required unless --jd)',
        '  --jd <path>           Single JD file (alternative to --jds)',
        '  --output <dir>        Output directory for tailored resumes and PDFs (required)',
        '  --concurrency <n>     Max simultaneous jobs (default: 5)',
        '  --cost-cap <dollars>  Maximum estimated cost; stops fan-out if exceeded',
        '  --queued              Use Phase 5 queue server instead of direct execution',
        '  --verbose             Print detailed progress',
        '  --help                Show this message',
        '',
        'Requires ANTHROPIC_API_KEY environment variable.',
      ].join('\n'));
      process.exit(0);
    default:
      console.error(`Unknown flag: ${args[i]}`);
      process.exit(2);
  }
}

if (!opts.master) { console.error('Missing required --master <path>'); process.exit(2); }
if (!opts.jdsDir && !opts.jdFile) { console.error('Missing required --jds <dir> or --jd <path>'); process.exit(2); }
if (!opts.output) { console.error('Missing required --output <dir>'); process.exit(2); }

// ---------------------------------------------------------------
// 2. Load inputs
// ---------------------------------------------------------------

let masterState;
try {
  masterState = JSON.parse(fs.readFileSync(opts.master, 'utf-8'));
} catch (e) {
  console.error(`Failed to read master CV "${opts.master}": ${e.message}`);
  process.exit(1);
}

const jdFiles = [];
if (opts.jdFile) {
  jdFiles.push(opts.jdFile);
} else {
  const dirEntries = fs.readdirSync(opts.jdsDir);
  for (const entry of dirEntries) {
    if (entry.endsWith('.txt') || entry.endsWith('.md')) {
      jdFiles.push(path.join(opts.jdsDir, entry));
    }
  }
}

if (jdFiles.length === 0) {
  console.error('No JD files found');
  process.exit(1);
}

const jds = [];
for (const file of jdFiles) {
  try {
    const text = fs.readFileSync(file, 'utf-8').trim();
    jds.push({ file, name: path.basename(file, path.extname(file)), text });
  } catch (e) {
    console.error(`Failed to read JD "${file}": ${e.message}`);
    process.exit(1);
  }
}

// Ensure output directory exists
fs.mkdirSync(opts.output, { recursive: true });

console.log(`Master CV: ${opts.master} (${masterState.blocks.length} blocks)`);
console.log(`Job Descriptions: ${jds.length}`);
console.log(`Output: ${opts.output}\n`);

// ---------------------------------------------------------------
// 3. ESM dynamic import — set up linkedom, init SDK
// ---------------------------------------------------------------

async function main() {
  const { parseHTML } = require('linkedom');
  const { document } = parseHTML('<html><head></head><body></body></html>');
  globalThis.document = document;
  globalThis.HTMLElement = document.defaultView.HTMLElement;
  globalThis.Node = document.defaultView.Node;

  const SDK = await import('../src/sdk/index.js');
  await SDK.initSdkDomParser();

  const { nodeModelProvider, nodeScreenshotProvider } = await import('../src/sdk/providers/node.js');
  const { dehydrateState } = await import('../server/agent/imageStore.js');
  const { initFonts, renderResumePDF, computeLayout, blockRectMm } = await import('../src/lib/layout/index.js');
  await initFonts();

  // ---------------------------------------------------------------
  // 4. Simple LLM call helper for non-streaming pre-passes.
  //    Uses the same Anthropic SDK as nodeModelProvider but
  //    returns a complete response instead of streaming.
  // ---------------------------------------------------------------

  async function simpleLLMCall(systemPrompt, userMessage) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5-20250915',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Extract text from response
    const textBlock = response.content.find(b => b.type === 'text');
    return textBlock?.text || '';
  }

  // ---------------------------------------------------------------
  // 5. Per-JD pre-passes: requirement extraction + relevance filter
  // ---------------------------------------------------------------

  const REQUIREMENT_EXTRACTION_PROMPT = `You are a precise job-description parser. Extract the key requirements from a job description and return them as a structured JSON list. Only include requirements explicitly stated in the JD.

Output format (JSON only, no markdown):
{
  "role": "Job title",
  "requirements": [
    { "category": "experience|skills|education|other", "text": "Requirement description" }
  ]
}`;

  const RELEVANCE_FILTER_PROMPT = `You are a resume block selector. Given a job's requirements and a master CV's blocks (each with an ID, name, and content), select the blocks most relevant to the job. Exclude blocks that are clearly irrelevant or junior-level when the job requires senior experience.

Output format (JSON only, no markdown):
{
  "selected_blocks": ["block-id-1", "block-id-2", ...],
  "rationale": "Brief explanation of selection"
}`;

  const pipelineResults = [];

  if (opts.verbose) console.log('=== Pre-passes: requirement extraction & relevance filter ===\n');

  for (let i = 0; i < jds.length; i++) {
    const jd = jds[i];
    const label = `[${i + 1}/${jds.length}] ${jd.name}`;

    // FR6.2: Extract requirements
    if (opts.verbose) console.log(`${label} — extracting requirements…`);
    const reqText = await simpleLLMCall(
      REQUIREMENT_EXTRACTION_PROMPT,
      `Job Description:\n${jd.text}`
    );

    let requirements;
    try {
      // Try to parse as JSON; handle markdown-wrapped responses
      const jsonMatch = reqText.match(/\{[\s\S]*\}/);
      requirements = jsonMatch ? JSON.parse(jsonMatch[0]) : { role: jd.name, requirements: [] };
    } catch (_e) {
      requirements = { role: jd.name, requirements: [], raw: reqText };
    }

    if (opts.verbose) console.log(`  → ${requirements.requirements?.length || 0} requirements extracted`);

    // FR6.1a: Relevance filter
    if (opts.verbose) console.log(`${label} — filtering relevant blocks…`);
    const blockList = masterState.blocks.map(b => {
      const text = b.content?.map(n => n.type === 'hardBreak' ? ' ' : (n.text || '')).join('') || '';
      return `[ID: ${b.id}] Name: ${b.name || '(unnamed)'} | Type: ${b.type} | ${b.locked ? 'LOCKED ' : ''}| Content: "${text.slice(0, 200)}"`;
    }).join('\n');

    const filterText = await simpleLLMCall(
      RELEVANCE_FILTER_PROMPT,
      `Job Requirements:\n${JSON.stringify(requirements, null, 2)}\n\nMaster CV blocks:\n${blockList}`
    );

    let filterResult;
    try {
      const jsonMatch = filterText.match(/\{[\s\S]*\}/);
      filterResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { selected_blocks: [] };
    } catch (_e) {
      filterResult = { selected_blocks: [], raw: filterText };
    }

    const selectedIds = new Set(filterResult.selected_blocks || []);
    // Always include locked blocks (they can't be edited, but they're part of the resume)
    for (const b of masterState.blocks) {
      if (b.locked) selectedIds.add(b.id);
    }

    const scopedBlocks = masterState.blocks.filter(b => selectedIds.has(b.id));
    let scopedState = { ...masterState, blocks: scopedBlocks };
    // Dehydrate imageData before processing (FR5.8 / FR6.4 mitigation)
    scopedState = await dehydrateState(scopedState);

    if (opts.verbose) {
      console.log(`  → ${scopedBlocks.length} blocks selected (from ${masterState.blocks.length} total)`);
      if (filterResult.rationale) console.log(`  → Rationale: ${filterResult.rationale}`);
    }

    pipelineResults.push({
      jd,
      requirements,
      scopedState,
      filterRationale: filterResult.rationale || '',
      jobId: null,
      result: null,
      error: null,
      fitReport: null,
      status: 'prepped'
    });
  }

  // ---------------------------------------------------------------
  // 6. Fan-out: tailor each scoped resume via engine.optimizeResume
  // ---------------------------------------------------------------

  // Declared here so both queued and direct modes can update it and the summary can read it.
  let estimatedCost = 0;

  if (opts.queued) {
    if (opts.verbose) console.log('\n=== Queued mode — enqueuing jobs via Phase 5 API ===\n');

    // FR6.3: Enqueue each job via POST /api/agent/queue
    const serverPort = process.env.DEV_SERVER_PORT || process.env.PORT || '5173';
    const baseUrl = `http://127.0.0.1:${serverPort}`;

    for (const entry of pipelineResults) {
      if (entry.status !== 'prepped') continue;
      entry.status = 'queuing';

      try {
        const instruction = [
          `Tailor this resume for: ${entry.requirements.role || entry.jd.name}`,
          'Requirements:', JSON.stringify(entry.requirements.requirements || [], null, 2),
          'Do not fabricate experience. Stay within block spatial budgets.'
        ].join('\n');

        const res = await fetch(`${baseUrl}/api/agent/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-Id': 'jd-pipeline' },
          body: JSON.stringify({ state: entry.scopedState, instruction, opts: { strictCapacity: true } })
        });

        if (!res.ok) throw new Error(await res.text());
        const { jobId } = await res.json();
        entry.jobId = jobId;
        entry.status = 'queued';

        if (opts.verbose) console.log(`  ${entry.jd.name} → queued (${jobId.slice(0, 8)}…)`);
      } catch (err) {
        entry.status = 'error';
        entry.error = `Enqueue failed: ${err.message}`;
        if (opts.verbose) console.error(`  ✗ ${entry.jd.name}: ${err.message}`);
      }
    }

    // Poll for completion
    const queuedEntries = pipelineResults.filter(e => e.status === 'queued' || e.status === 'running');
    while (queuedEntries.length > 0) {
      await new Promise(r => setTimeout(r, 5000));

      for (const entry of queuedEntries) {
        if (!entry.jobId) continue;
        try {
          const res = await fetch(`${baseUrl}/api/agent/job/${entry.jobId}`, {
            headers: { 'X-User-Id': 'jd-pipeline' }
          });
          if (!res.ok) continue;
          const job = await res.json();

          if (job.status === 'done') { applyQueuedResult(entry, job); }
          else if (job.status === 'error') { entry.status = 'error'; entry.error = job.error; }
          else if (job.status === 'cancelled') { entry.status = 'cancelled'; entry.error = 'Cancelled'; }

          // Remove terminal entries from the polling set
          if (entry.status === 'done' || entry.status === 'error' || entry.status === 'cancelled') {
            const idx = queuedEntries.indexOf(entry);
            if (idx >= 0) queuedEntries.splice(idx, 1);
          }
        } catch (_) {}
      }
    }

    function applyQueuedResult(entry, job) {
      entry.status = 'done';
      if (!job.output?.transaction?.stagedChanges) return;

      const tailoredState = JSON.parse(JSON.stringify(entry.scopedState));
      for (const [blockId, change] of Object.entries(job.output.transaction.stagedChanges)) {
        const block = tailoredState.blocks.find(b => b.id === blockId);
        if (block) {
          // In queued mode, the worker wrote proposedContent directly (not proposedHtml via htmlToInlineNodes).
          // Accept whichever is present.
          block.content = SDK.htmlToInlineNodes(change.proposedHtml);
        }
      }

      const changedBlockIds = Object.keys(job.output.transaction.stagedChanges);

      // Post-hoc capacity verification (parity with direct mode)
      let capacityViolations = [];
      for (const block of tailoredState.blocks) {
        if (!block.canvas || !['paragraph', 'h1', 'h2', 'h3'].includes(block.type)) continue;
        try {
          const rect = blockRectMm(block.canvas, entry.scopedState.paddingMm);
          const lo = computeLayout(block, rect, {
            templateName: entry.scopedState.templateName,
            paddingMm: entry.scopedState.paddingMm,
            themeColors: entry.scopedState.themeColors
          });
          if (lo.overflow) {
            capacityViolations.push({ blockId: block.id, name: block.name, used: lo.lines.length, max: lo.maxLines });
          }
        } catch (_) {}
      }

      if (capacityViolations.length > 0) {
        entry.status = 'overflow';
        entry.error = `${capacityViolations.length} block(s) overflow capacity`;
      }

      entry.result = {
        tailoredState,
        transaction: job.output.transaction,
        capacityViolations,
        fitReport: {
          role: entry.requirements.role || entry.jd.name,
          blocksScoped: entry.scopedState.blocks.length,
          blocksChanged: changedBlockIds.length,
          changedBlocks: changedBlockIds.map(id => {
            const b = entry.scopedState.blocks.find(bl => bl.id === id);
            return { id, name: b?.name || '', type: b?.type };
          }),
          doneReason: 'queued-model_complete'
        }
      };

      if (opts.verbose) console.log(`  ${entry.jd.name} — done (queued)`);
    }

  } else {
    // Direct mode — run engine inline (existing logic)
    if (opts.verbose) console.log('\n=== Tailoring per JD (concurrency: ' + opts.concurrency + ') ===\n');

  const pending = pipelineResults.filter(r => r.status === 'prepped');
  let activeCount = 0;
  let completedCount = 0;

  function processNext() {
    const next = pending.shift();
    if (!next) return;

    activeCount++;
    const label = `[${completedCount + activeCount}/${jds.length}]`;

    if (opts.verbose) console.log(`${label} Tailoring "${next.jd.name}"…`);

    tailorJob(next).then(() => {
      completedCount++;
      activeCount--;
      if (opts.verbose) console.log(`${label} ${next.jd.name} — ${next.status}`);

      // FR6.4: cost cap — if exceeded, cancel remaining pending jobs
      if (opts.costCap > 0 && estimatedCost >= opts.costCap) {
        if (opts.verbose) console.log(`  Cost cap $${opts.costCap} reached — cancelling ${pending.length} remaining jobs.`);
        for (const p of pending) {
          p.status = 'cancelled';
          p.error = 'Cost cap reached';
        }
        pending.length = 0;
        return;
      }

      processNext();
    });
  }

  async function tailorJob(entry) {
    entry.status = 'running';

    try {
      const engine = new SDK.ResumeAgentEngine({
        modelProvider: nodeModelProvider,
        screenshotProvider: nodeScreenshotProvider
      });

      const instruction = [
        `Tailor this resume for the following role: ${entry.requirements.role || entry.jd.name}`,
        '',
        'Requirements to align with:',
        JSON.stringify(entry.requirements.requirements || [], null, 2),
        '',
        'Instructions:',
        '- Rewrite matched blocks to align with these requirements.',
        '- Stay within each block\'s spatial budget — do not overflow.',
        '- Do NOT fabricate experience. Only use content from the original blocks.',
        '- Optimise for impact: use strong action verbs, quantify achievements.',
        '- Keep the same factual content — reword and emphasise, don\'t invent.'
      ].join('\n');

      const events = [];
      for await (const ev of engine.optimizeResume(entry.scopedState, instruction, {
        mode: 'agent',
        model: 'anthropic/claude-sonnet-4-5',
        strictCapacity: true
      })) {
        events.push(ev);
      }

      const doneEvent = events.find(e => e.type === 'done');
      const transaction = doneEvent?.transaction || { stagedChanges: {} };

      // Apply staged changes to scoped state
      const tailoredState = JSON.parse(JSON.stringify(entry.scopedState));
      for (const [blockId, change] of Object.entries(transaction.stagedChanges)) {
        const block = tailoredState.blocks.find(b => b.id === blockId);
        if (block) {
          block.content = SDK.htmlToInlineNodes(change.proposedHtml);
        }
      }

      // FR6.7: Capacity check — every placed block must not overflow
      let capacityViolations = [];
      for (const block of tailoredState.blocks) {
        if (!block.canvas || !['paragraph', 'h1', 'h2', 'h3'].includes(block.type)) continue;
        try {
          const rect = blockRectMm(block.canvas, entry.scopedState.paddingMm);
          const lo = computeLayout(block, rect, {
            templateName: entry.scopedState.templateName,
            paddingMm: entry.scopedState.paddingMm,
            themeColors: entry.scopedState.themeColors
          });
          if (lo.overflow) {
            capacityViolations.push({ blockId: block.id, name: block.name, used: lo.lines.length, max: lo.maxLines });
          }
        } catch (err) {
          if (opts.verbose) console.error(`  Layout check error for block ${block.id}: ${err.message}`);
        }
      }

      // Build fit report
      const toolEvents = events.filter(e => e.type === 'tool_call' || e.type === 'tool_result');
      const changedBlockIds = Object.keys(transaction.stagedChanges);
      const fitReport = {
        role: entry.requirements.role || entry.jd.name,
        requirementsCount: entry.requirements.requirements?.length || 0,
        blocksScoped: entry.scopedState.blocks.length,
        blocksChanged: changedBlockIds.length,
        changedBlocks: changedBlockIds.map(id => {
          const masterBlock = entry.scopedState.blocks.find(bl => bl.id === id);
          const tailoredBlock = tailoredState.blocks.find(bl => bl.id === id);
          const oldText = masterBlock?.content?.map(n => n.type === 'hardBreak' ? '\n' : (n.text || '')).join('') || '';
          const newText = tailoredBlock?.content?.map(n => n.type === 'hardBreak' ? '\n' : (n.text || '')).join('') || '';
          return { id, name: masterBlock?.name || '', type: masterBlock?.type, diff: { old: oldText, new: newText } };
        }),
        capacityViolations,
        toolCalls: toolEvents.length,
        doneReason: doneEvent?.reason || 'unknown'
      };

      entry.result = {
        tailoredState,
        transaction,
        capacityViolations,
        fitReport,
        events
      };

      if (capacityViolations.length > 0) {
        entry.status = 'overflow';
        entry.error = `${capacityViolations.length} block(s) overflow capacity`;
      } else {
        entry.status = 'done';
      }

      // Cost estimate (very rough: ~$0.01 per tool-call turn)
      estimatedCost += (fitReport.toolCalls / 2) * 0.01;

    } catch (err) {
      entry.status = 'error';
      entry.error = err.message;
      if (opts.verbose) console.error(`  ✗ ${entry.jd.name} failed: ${err.message}`);
    }
  }

  // Kick off initial batch
  for (let i = 0; i < Math.min(opts.concurrency, pending.length); i++) {
    processNext();
  }

  // Wait for all to complete
  while (completedCount + pipelineResults.filter(r => r.status === 'cancelled' || r.status === 'error').length < jds.length) {
    await new Promise(r => setTimeout(r, 500));
  }
  } // end direct mode

  // ---------------------------------------------------------------
  // 7. PDF generation per result
  // ---------------------------------------------------------------

  if (opts.verbose) console.log('\n=== Generating PDFs ===\n');

  for (const entry of pipelineResults) {
    if (entry.status !== 'done') continue;

    try {
      const state = entry.result.tailoredState;
      const ctx = {
        templateName: state.templateName,
        paddingMm: state.paddingMm,
        themeColors: state.themeColors,
        pageCount: state.pageCount
      };

      const pdfBytes = await renderResumePDF(state.blocks, ctx);
      const pdfPath = path.join(opts.output, `${entry.jd.name}.pdf`);
      fs.writeFileSync(pdfPath, Buffer.from(pdfBytes));

      // Also save the tailored JSON
      const jsonPath = path.join(opts.output, `${entry.jd.name}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(state, null, 2));

      // Save fit report
      const fitPath = path.join(opts.output, `${entry.jd.name}-fit-report.json`);
      fs.writeFileSync(fitPath, JSON.stringify(entry.result.fitReport, null, 2));

      if (opts.verbose) {
        const cap = entry.result.capacityViolations.length;
        console.log(`  ${entry.jd.name}.pdf — ${state.blocks.length} blocks, ${cap > 0 ? cap + ' OVERFLOW' : 'capacity OK'}`);
      }
    } catch (err) {
      console.error(`  ✗ PDF generation failed for ${entry.jd.name}: ${err.message}`);
      entry.status = 'error';
      entry.error = (entry.error ? entry.error + '; ' : '') + `PDF: ${err.message}`;
    }
  }

  // ---------------------------------------------------------------
  // 8. Results dashboard
  // ---------------------------------------------------------------

  const resultsSummary = {
    pipeline: {
      masterCv: opts.master,
      jdCount: jds.length,
      concurrency: opts.concurrency,
      estimatedCost: estimatedCost.toFixed(2)
    },
    results: pipelineResults.map(e => ({
      jd: e.jd.name,
      role: e.requirements.role || e.jd.name,
      status: e.status,
      error: e.error || null,
      blocksScoped: e.result?.fitReport?.blocksScoped || 0,
      blocksChanged: e.result?.fitReport?.blocksChanged || 0,
      changedBlocks: e.result?.fitReport?.changedBlocks || [],
      capacityViolations: e.result?.capacityViolations?.length || 0,
      doneReason: e.result?.fitReport?.doneReason || null,
      filterRationale: e.filterRationale || null
    }))
  };

  const summaryPath = path.join(opts.output, 'results.json');
  fs.writeFileSync(summaryPath, JSON.stringify(resultsSummary, null, 2));

  // Also write to web-accessible location for the dashboard
  const batchId = Date.now().toString(36);
  const webDir = path.join(process.cwd(), 'server/agent/results', batchId);
  fs.mkdirSync(webDir, { recursive: true });
  fs.writeFileSync(path.join(webDir, 'results.json'), JSON.stringify(resultsSummary, null, 2));
  // Copy individual fit reports and PDFs to web dir
  for (const entry of pipelineResults) {
    if (entry.status === 'done' || entry.status === 'overflow') {
      try {
        const srcPdf = path.join(opts.output, `${entry.jd.name}.pdf`);
        const srcJson = path.join(opts.output, `${entry.jd.name}.json`);
        const srcFit = path.join(opts.output, `${entry.jd.name}-fit-report.json`);
        if (fs.existsSync(srcPdf)) fs.copyFileSync(srcPdf, path.join(webDir, `${entry.jd.name}.pdf`));
        if (fs.existsSync(srcJson)) fs.copyFileSync(srcJson, path.join(webDir, `${entry.jd.name}.json`));
        if (fs.existsSync(srcFit)) fs.copyFileSync(srcFit, path.join(webDir, `${entry.jd.name}-fit-report.json`));
      } catch (_) {}
    }
  }

  console.log(`\n=== Pipeline complete ===`);
  const doneCount = pipelineResults.filter(e => e.status === 'done').length;
  const overflowCount = pipelineResults.filter(e => e.status === 'overflow').length;
  const errorCount = pipelineResults.filter(e => e.status === 'error').length;
  console.log(`  Done: ${doneCount}  Overflow: ${overflowCount}  Error: ${errorCount}`);
  console.log(`  Estimated cost: $${estimatedCost.toFixed(2)}`);
  console.log(`  Results: ${opts.output}/`);
  console.log(`  Summary: ${summaryPath}`);
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  if (opts.verbose) console.error(err.stack);
  process.exit(1);
});
