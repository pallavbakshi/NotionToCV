// server/agent/worker.js — Background worker that pulls queued jobs and runs
// the identical src/sdk engine with Node providers. No agent logic of its own
// (FR5.7) — it is provider injection + job lifecycle around the shared SDK.

import { dequeueNext, markDone, markError, purgeExpired } from './queue.js';

// Lazy imports — the SDK and providers are ESM; they get loaded once the first
// time a job is picked up. Before that, the module loads without any SDK deps.
let _engine;

async function ensureEngine() {
  if (!_engine) {
    // Set up linkedom DOM for htmlToInlineNodes (same setup as CLI test harness)
    const { parseHTML } = await import('linkedom');
    const { document } = parseHTML('<html><head></head><body></body></html>');
    globalThis.document = document;
    globalThis.HTMLElement = document.defaultView.HTMLElement;
    globalThis.Node = document.defaultView.Node;

    const SDK = await import('../../src/sdk/index.js');
    await SDK.initSdkDomParser();

    const { nodeModelProvider, nodeScreenshotProvider } = await import('../../src/sdk/providers/node.js');

    _engine = { SDK, nodeModelProvider, nodeScreenshotProvider };
  }
  return _engine;
}

/** Interval ID for the poll loop. Set by start(), cleared by stop(). */
let _pollInterval = null;

/** Number of jobs currently running. Caps at MAX_CONCURRENT. */
let _activeCount = 0;
const MAX_CONCURRENT = 5;

/**
 * Start the background worker poll loop.
 * @param {number} [intervalMs=2000] — poll interval
 */
export function start(intervalMs = 2000) {
  if (_pollInterval) return;
  _pollInterval = setInterval(poll, intervalMs);
  console.log('[worker] Started (poll interval: ' + intervalMs + 'ms, max concurrent: ' + MAX_CONCURRENT + ')');
}

/** Stop the background worker. */
export function stop() {
  if (_pollInterval) {
    clearInterval(_pollInterval);
    _pollInterval = null;
    console.log('[worker] Stopped');
  }
}

/**
 * Single poll cycle: purge expired, dequeue next job, run it (non-blocking).
 */
async function poll() {
  await purgeExpired();

  // Fix #4: enforce concurrency cap — don't dequeue if already at the limit.
  if (_activeCount >= MAX_CONCURRENT) return;

  const job = dequeueNext();
  if (!job) return; // nothing queued

  _activeCount++;
  console.log(`[worker] Picked up job ${job.id.slice(0, 8)}… (active: ${_activeCount}/${MAX_CONCURRENT})`);

  // Run the job without awaiting so the poll interval can pick up more jobs.
  runJob(job).finally(() => { _activeCount--; });
}

/**
 * Execute a single queued job.
 * @param {Object} job
 */
async function runJob(job) {
  try {
    const { SDK, nodeModelProvider, nodeScreenshotProvider } = await ensureEngine();
    const { rehydrateState } = await import('./imageStore.js');

    const { state: dehydratedState, instruction, opts } = job.input;

    // FR5.8: on-demand rehydration — don't load image bytes upfront. Build a
    // screenshot provider wrapper that rehydrates the full state only on the first
    // screenshot request, then caches the result for the rest of the job.
    // Text-only jobs (which never call get_block_screenshot) never touch the disk.
    let rehydratedState = null;
    async function lazyScreenshotProvider(args) {
      if (!rehydratedState) {
        rehydratedState = await rehydrateState(dehydratedState);
      }
      return nodeScreenshotProvider({ ...args, blocks: rehydratedState.blocks });
    }

    // Fix #9: only pass safe, known opts to the engine — never let the queue
    // client inject messages/systemPrompt to override host-built context (FR2.8).
    const safeOpts = {
      model: opts.model,
      maxTurns: opts.maxTurns,
      strictCapacity: opts.strictCapacity
    };

    const engine = new SDK.ResumeAgentEngine({
      modelProvider: nodeModelProvider,
      screenshotProvider: lazyScreenshotProvider,
      model: safeOpts.model,
      maxTurns: safeOpts.maxTurns
    });

    // FR5.6: wall-clock budget guard — abort the job if it runs over the limit.
    const JOB_TIMEOUT_MS = (opts.timeoutMs && Number.isFinite(opts.timeoutMs))
      ? Math.min(opts.timeoutMs, 30 * 60 * 1000) // cap at 30 min regardless
      : 20 * 60 * 1000; // default 20 min
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      console.log(`[worker] Job ${job.id.slice(0, 8)} timed out after ${JOB_TIMEOUT_MS / 1000}s`);
      job.abortController?.abort();
    }, JOB_TIMEOUT_MS);

    const events = [];
    try {
      for await (const ev of engine.optimizeResume(dehydratedState, instruction, {
        ...safeOpts,
        mode: 'agent',
        signal: job.abortController?.signal
      })) {
        events.push(ev);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const doneEvent = events.find(e => e.type === 'done');
    const transaction = doneEvent?.transaction || { stagedChanges: {} };

    markDone(job.id, transaction);
    console.log(`[worker] Job ${job.id.slice(0, 8)} completed (reason: ${doneEvent?.reason || 'unknown'})`);

  } catch (err) {
    if (err.name === 'AbortError' && timedOut) {
      console.log(`[worker] Job ${job.id.slice(0, 8)} timed out`);
      markError(job.id, 'Job exceeded time limit');
    } else if (err.name === 'AbortError') {
      console.log(`[worker] Job ${job.id.slice(0, 8)} aborted`);
    } else {
      console.error(`[worker] Job ${job.id.slice(0, 8)} failed:`, err.message);
      markError(job.id, err.message);
    }
  }
}
