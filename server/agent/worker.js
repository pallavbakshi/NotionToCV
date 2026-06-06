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

/**
 * Start the background worker poll loop.
 * @param {number} [intervalMs=2000] — poll interval
 */
export function start(intervalMs = 2000) {
  if (_pollInterval) return;
  _pollInterval = setInterval(poll, intervalMs);
  console.log('[worker] Started (poll interval: ' + intervalMs + 'ms)');
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
 * Single poll cycle: purge expired, dequeue next job, run it.
 */
async function poll() {
  await purgeExpired();

  const job = dequeueNext();
  if (!job) return; // nothing queued

  console.log(`[worker] Picked up job ${job.id.slice(0, 8)}…`);

  try {
    const { SDK, nodeModelProvider, nodeScreenshotProvider } = await ensureEngine();
    const { rehydrateState } = await import('./imageStore.js');

    const { state: dehydratedState, instruction, opts } = job.input;
    const state = await rehydrateState(dehydratedState);

    const engine = new SDK.ResumeAgentEngine({
      modelProvider: nodeModelProvider,
      screenshotProvider: nodeScreenshotProvider,
      model: opts.model
    });

    const events = [];
    for await (const ev of engine.optimizeResume(state, instruction, {
      ...opts,
      mode: 'agent',       // always agent in background; spread after so it can't be overridden
      signal: job.abortController?.signal
    })) {
      events.push(ev);
    }

    const doneEvent = events.find(e => e.type === 'done');
    const transaction = doneEvent?.transaction || { stagedChanges: {} };

    markDone(job.id, transaction);
    console.log(`[worker] Job ${job.id.slice(0, 8)} completed`);

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`[worker] Job ${job.id.slice(0, 8)} aborted`);
    } else {
      console.error(`[worker] Job ${job.id.slice(0, 8)} failed:`, err.message);
      markError(job.id, err.message);
    }
  }
}
