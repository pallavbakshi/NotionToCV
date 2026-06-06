#!/usr/bin/env node

/**
 * resume-agent.cjs — CLI harness for the headless Agentic Resume SDK.
 *
 * Runs the identical src/sdk engine as the browser, but with Node providers
 * (direct Anthropic SDK for model calls, Puppeteer for screenshots).
 *
 * Usage:
 *   node scripts/resume-agent.cjs --input resume.json --prompt "Make it stronger" [--output out.json] [--verbose] [--strict-capacity] [--jd job.txt]
 *
 * Per the PRD (Phase 3 §3):
 *   - Auto-accepts staged edits and writes the resulting JSON.
 *   - Prints a unified diff + layout-capacity report per changed block BEFORE writing.
 *   - --strict-capacity rejects overflowing edits and exits non-zero.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------
// 1. CLI arg parsing
// ---------------------------------------------------------------

const args = process.argv.slice(2);
const opts = {};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--input':   opts.input   = args[++i]; break;
    case '--output':  opts.output  = args[++i]; break;
    case '--prompt':  opts.prompt  = args[++i]; break;
    case '--jd':      opts.jd      = args[++i]; break;
    case '--model':   opts.model   = args[++i]; break;
    case '--verbose': opts.verbose = true;      break;
    case '--strict-capacity': opts.strictCapacity = true; break;
    case '--help':
      console.log([
        'resume-agent.cjs — Headless resume optimisation with the Agentic Resume SDK.',
        '',
        'Usage:',
        '  node scripts/resume-agent.cjs --input <resume.json> --prompt "<instruction>" [options]',
        '',
        'Options:',
        '  --input <path>          ResumeState JSON file (required)',
        '  --output <path>         Output path for the tailored JSON (required)',
        '  --prompt <string>       Natural-language optimisation instruction (required)',
        '  --jd <path>             Job description text file to drive tailoring',
        '  --model <id>            Model override (default: claude-sonnet-4-5-20250915)',
        '  --verbose               Print tool calls, results, and capacity numbers',
        '  --strict-capacity       Reject edits that overflow block capacity (non-zero exit if any rejected)',
        '  --help                  Show this message',
        '',
        'Requires ANTHROPIC_API_KEY environment variable.',
      ].join('\n'));
      process.exit(0);
    default:
      console.error(`Unknown flag: ${args[i]}`);
      process.exit(2);
  }
}

if (!opts.input)  { console.error('Missing required --input <path>');  process.exit(2); }
if (!opts.output) { console.error('Missing required --output <path>'); process.exit(2); }
if (!opts.prompt && !opts.jd) { console.error('Missing required --prompt <string> (or --jd <file>)'); process.exit(2); }

// ---------------------------------------------------------------
// 2. Read input & compose instruction
// ---------------------------------------------------------------

let inputState;
try {
  inputState = JSON.parse(fs.readFileSync(opts.input, 'utf-8'));
} catch (e) {
  console.error(`Failed to read input file "${opts.input}": ${e.message}`);
  process.exit(1);
}

let instruction = opts.prompt || '';
if (opts.jd) {
  try {
    const jdText = fs.readFileSync(opts.jd, 'utf-8').trim();
    instruction = instruction
      ? `${instruction}\n\nJob Description:\n${jdText}`
      : `Tailor this resume for the following job description:\n${jdText}`;
  } catch (e) {
    console.error(`Failed to read JD file "${opts.jd}": ${e.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------
// 3. ESM dynamic import — set up linkedom, init SDK, load providers
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
  const { computeLayout, blockRectMm, initFonts } = await import('../src/lib/layout/index.js');

  // ---------------------------------------------------------------
  // 4. Instantiate engine & run
  // ---------------------------------------------------------------

  const engine = new SDK.ResumeAgentEngine({
    modelProvider: nodeModelProvider,
    screenshotProvider: nodeScreenshotProvider,
    model: opts.model
  });

  if (opts.verbose) console.log(`Running agent on "${opts.input}"...\n`);

  const events = [];

  for await (const ev of engine.optimizeResume(inputState, instruction, { mode: 'agent' })) {
    events.push(ev);

    if (opts.verbose) {
      switch (ev.type) {
        case 'text':
          process.stdout.write(ev.delta);
          break;
        case 'tool_call':
          console.log(`\n  ⚙  ${ev.name}(${JSON.stringify(ev.args)})`);
          break;
        case 'tool_result':
          console.log(`  ✓  ${ev.name} — ${JSON.stringify(ev.result).slice(0, 120)}`);
          break;
        case 'staged_change':
          console.log(`  ✎  staged change for block ${ev.blockId}`);
          break;
        case 'error':
          console.error(`\n  ✗  ${ev.error}`);
          break;
        case 'done':
          console.log(`\n  →  done (${ev.reason})\n`);
          break;
      }
    }
  }

  const doneEvent = events.find(e => e.type === 'done');
  if (!doneEvent || !doneEvent.transaction || !doneEvent.transaction.stagedChanges) {
    if (opts.verbose) console.log('No changes proposed by agent.');
    fs.writeFileSync(opts.output, JSON.stringify(inputState, null, 2));
    console.log(`Output written to ${opts.output} (no changes).`);
    return;
  }

  const stagedChanges = doneEvent.transaction.stagedChanges;
  const changedBlockIds = Object.keys(stagedChanges);

  // ---------------------------------------------------------------
  // 5. Diff + capacity report (per changed block, BEFORE writing)
  // ---------------------------------------------------------------

  await initFonts();

  let rejectedCount = 0;
  const outputState = JSON.parse(JSON.stringify(inputState)); // deep clone

  for (const blockId of changedBlockIds) {
    const change = stagedChanges[blockId];
    const block = inputState.blocks.find(b => b.id === blockId);
    if (!block) continue;

    // FR3.3: derive inline nodes from proposedHtml via htmlToInlineNodes
    const proposedContent = SDK.htmlToInlineNodes(change.proposedHtml);

    // Build plaintext for diff — hardBreak → newline
    const nodesToText = (nodes) =>
      (nodes || []).map(n => n.type === 'hardBreak' ? '\n' : (n.text || '')).join('');

    const oldText = nodesToText(block.content);
    const newText = nodesToText(proposedContent);

    // Simple unified diff
    console.log(`--- ${block.name || blockId} (original)`);
    console.log(`+++ ${block.name || blockId} (proposed)`);
    const diff = minimalUnifiedDiff(oldText, newText);
    console.log(diff);

    // Layout capacity check
    if (block.canvas) {
      const rect = blockRectMm(block.canvas, inputState.paddingMm);
      const layoutCtx = {
        templateName: inputState.templateName,
        paddingMm: inputState.paddingMm,
        themeColors: inputState.themeColors
      };

      const proposedBlock = { ...block, content: proposedContent };
      const lo = computeLayout(proposedBlock, rect, layoutCtx);

      console.log(`  capacity: max_lines=${lo.maxLines} used=${lo.lines.length} remaining=${lo.linesRemaining} overflow=${lo.overflow}`);

      if (opts.strictCapacity && lo.overflow) {
        console.log(`  REJECTED — content overflows block budget (strict-capacity mode)`);
        rejectedCount++;
        continue; // don't apply this change
      }
    }

    // Apply the change to output state
    const outBlock = outputState.blocks.find(b => b.id === blockId);
    if (outBlock) {
      outBlock.content = proposedContent;
    }
    console.log();
  }

  const appliedCount = changedBlockIds.length - rejectedCount;
  console.log(`Changes: ${appliedCount} applied, ${rejectedCount} rejected.`);

  // ---------------------------------------------------------------
  // 6. Write output
  // ---------------------------------------------------------------

  const outputJson = JSON.stringify(outputState, null, 2);
  fs.writeFileSync(opts.output, outputJson);
  console.log(`Output written to ${opts.output}`);

  if (rejectedCount > 0) {
    process.exit(1);
  }
}

// ---------------------------------------------------------------
// Minimal unified diff (no external dependency)
// ---------------------------------------------------------------

function minimalUnifiedDiff(oldText, newText) {
  const oldWords = oldText.split(/\s+/).filter(Boolean);
  const newWords = newText.split(/\s+/).filter(Boolean);
  const lines = [];

  const oldSet = new Set(oldWords);
  const newSet = new Set(newWords);

  let i = 0, j = 0;
  while (i < oldWords.length || j < newWords.length) {
    if (i < oldWords.length && j < newWords.length && oldWords[i] === newWords[j]) {
      lines.push(`  ${oldWords[i]}`);
      i++; j++;
    } else {
      let advanced = false;

      // Words in old but not in new → removed
      if (i < oldWords.length && !newSet.has(oldWords[i])) {
        lines.push(`- ${oldWords[i]}`);
        i++;
        advanced = true;
      }

      // Words in new but not in old → added
      if (j < newWords.length && !oldSet.has(newWords[j])) {
        lines.push(`+ ${newWords[j]}`);
        j++;
        advanced = true;
      }

      // Both words exist in the other set but at different positions → reorder as replace
      if (i < oldWords.length && j < newWords.length && oldWords[i] !== newWords[j]) {
        lines.push(`- ${oldWords[i]}`);
        lines.push(`+ ${newWords[j]}`);
        i++; j++;
        advanced = true;
      }

      // Fallback: j is exhausted (condensing rewrite) → treat remaining old as removed
      if (!advanced && i < oldWords.length) {
        lines.push(`- ${oldWords[i]}`);
        i++;
      } else if (!advanced && j < newWords.length) {
        lines.push(`+ ${newWords[j]}`);
        j++;
      }
    }
  }

  return lines.join('\n') || '  (no change)';
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  if (opts.verbose) console.error(err.stack);
  process.exit(1);
});
