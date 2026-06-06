// Agentic Resume SDK — public entry point.
//
// The SDK is environment-agnostic: it imports no Svelte, no browser globals,
// and no fetch. All host-specific capabilities (LLM transport, screenshots)
// are injected as providers conforming to the interfaces in types.js.
//
// Phase 1 ships the interface skeleton. The engine loop is implemented in
// Phase 2. The only live method at this stage is validateBlockLayout —
// a synchronous primitive that wraps the existing headless layout engine
// so CLI / pipeline code can gate on capacity without a full agent run.

import { computeLayout } from '../lib/layout/index.js';

/**
 * The top-level agent engine. Hosts construct it with their preferred
 * providers (browser fetch, Node Anthropic SDK, etc.) and call
 * optimizeResume to run the autonomous tool-calling loop.
 */
export class ResumeAgentEngine {
  /**
   * @param {Object} config
   * @param {import('./types.js').ModelProvider} config.modelProvider
   * @param {import('./types.js').ScreenshotProvider} config.screenshotProvider
   * @param {string} [config.model] - Model override (default: "anthropic/claude-sonnet-4-5")
   * @param {number} [config.maxTurns] - Hard ceiling on tool-call turns (default: 30)
   */
  constructor({ modelProvider, screenshotProvider, model, maxTurns = 30 }) {
    /** @type {import('./types.js').ModelProvider} */
    this.modelProvider = modelProvider;

    /** @type {import('./types.js').ScreenshotProvider} */
    this.screenshotProvider = screenshotProvider;

    /** @type {string} */
    this.model = model || 'anthropic/claude-sonnet-4-5';

    /** @type {number} */
    this.maxTurns = maxTurns;
  }

  /**
   * Run the autonomous agent loop over the given resume state.
   *
   * Iterate over the returned async iterable to receive live AgentEvents:
   * text deltas, tool calls/results, staged changes, and a terminal done/error.
   *
   * @param {import('./types.js').ResumeState} state - Full resume state.
   * @param {string} instruction - User prompt / JD-driven instruction.
   * @param {Object} [opts]
   * @param {AbortSignal} [opts.signal] - Abort signal to cancel the run.
   * @param {string} [opts.mode] - "agent" (tools on) or "coach" (read-only, no tools).
   * @returns {AsyncIterable<import('./types.js').AgentEvent>}
   */
  async *optimizeResume(state, instruction, opts) {
    throw new Error('not implemented — optimizeResume lands in Phase 2');
  }

  /**
   * Validate whether content fits within a block's spatial budget.
   *
   * Runs the same computeLayout path used by the read_block and update_block_content
   * tools so capacity numbers always match what the engine reports in-loop.
   *
   * @param {import('./types.js').Block} block - Block with canvas placement set.
   * @param {Object} rect - Layout rectangle { leftMm, topMm, widthMm, heightMm }.
   * @param {Object} layoutCtx - Layout context { templateName, paddingMm, themeColors }.
   * @returns {import('./types.js').LayoutCapacity}
   */
  validateBlockLayout(block, rect, layoutCtx) {
    const lo = computeLayout(block, rect, layoutCtx);

    return {
      max_lines: lo.maxLines,
      current_lines_used: lo.lines.length,
      lines_remaining: lo.linesRemaining,
      is_overflowing: lo.overflow
    };
  }
}
