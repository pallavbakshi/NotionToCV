// Agentic engine — the environment-agnostic autonomous tool-calling loop.
//
// Inverts the host-based loop: instead of writing into chatList / stagedChanges,
// the engine yields AgentEvents and accumulates staged changes internally,
// returning them as a transaction.
//
// Zero Svelte, zero browser globals, zero fetch. Everything host-specific
// arrives through the injected modelProvider / screenshotProvider.

import { runAgentTool, AGENT_TOOLS, getAgentSystemPrompt, getSystemPromptOutline } from './tools.js';
import { computeLayout } from '../lib/layout/index.js';

export class ResumeAgentEngine {
  /**
   * @param {Object} config
   * @param {import('./types.js').ModelProvider} config.modelProvider
   * @param {import('./types.js').ScreenshotProvider} config.screenshotProvider
   * @param {string} [config.model]
   * @param {number} [config.maxTurns]
   */
  constructor({ modelProvider, screenshotProvider, model, maxTurns }) {
    this.modelProvider = modelProvider;
    this.screenshotProvider = screenshotProvider;
    this.model = model || 'anthropic/claude-sonnet-4-5';
    this.maxTurns = maxTurns || 30;
  }

  /**
   * Run the autonomous agent loop.
   *
   * @param {import('./types.js').ResumeState} state
   * @param {string} [instruction] - User's natural-language prompt (default: "Optimize my resume.").
   *   Ignored when opts.messages is provided (host-built initial messages per FR2.8).
   * @param {Object} [opts]
   * @param {Array<Object>} [opts.messages] - Initial LLM conversation array (host-built).
   * @param {string} [opts.systemPrompt] - System prompt (built by host or auto-generated).
   * @param {string} [opts.model] - Per-call model override (defaults to constructor model).
   * @param {AbortSignal} [opts.signal] - Abort signal.
   * @param {'agent'|'coach'} [opts.mode]
   * @returns {AsyncIterable<import('./types.js').AgentEvent>}
   */
  async *optimizeResume(state, instruction, opts = {}) {
    const signal = opts.signal;
    const mode = opts.mode || 'agent';
    const systemPrompt = opts.systemPrompt ||
      (mode === 'agent'
        ? getAgentSystemPrompt(state.blocks, state.title)
        : getSystemPromptOutline(state.blocks, state.title));

    let history = opts.messages && opts.messages.length > 0
      ? [...opts.messages]
      : [{ role: 'user', content: instruction || 'Optimize my resume.' }];

    /** @type {Object<string, import('./types.js').StagedChange>} */
    let stagedChanges = {};
    let turn = 0;

    while (true) {
      // Abort check
      if (signal?.aborted) {
        yield { type: 'done', reason: 'aborted' };
        return;
      }

      // --- Model call ---
      /** @type {string} */
      let contentAccumulated = '';
      /** @type {Array<{id:string,type:'function',function:{name:string,arguments:string}}>} */
      let toolCallsAccumulated = [];

      try {
        const deltas = this.modelProvider({
          messages: history,
          systemPrompt,
          model: opts.model || this.model,
          tools: mode === 'agent' ? AGENT_TOOLS : undefined,
          signal
        });

        for await (const delta of deltas) {
          if (delta.content) {
            contentAccumulated += delta.content;
            yield { type: 'text', delta: delta.content };
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!toolCallsAccumulated[idx]) {
                toolCallsAccumulated[idx] = {
                  id: tc.id || '',
                  type: 'function',
                  function: { name: tc.function?.name || '', arguments: '' }
                };
              }
              if (tc.id) toolCallsAccumulated[idx].id = tc.id;
              if (tc.function?.name) toolCallsAccumulated[idx].function.name = tc.function.name;
              if (tc.function?.arguments) toolCallsAccumulated[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          yield { type: 'done', reason: 'aborted' };
          return;
        }
        yield { type: 'error', error: `Model call failed: ${err.message}` };
        yield { type: 'done', reason: 'aborted' };
        return;
      }

      // --- Check for tool calls ---
      const completedToolCalls = toolCallsAccumulated.filter(Boolean);

      if (completedToolCalls.length === 0) {
        yield {
          type: 'done',
          reason: 'model_complete',
          transaction: { stagedChanges }
        };
        return;
      }

      // --- Dispatch tools ---
      const assistantMsg = {
        role: 'assistant',
        content: contentAccumulated || null,
        tool_calls: completedToolCalls
      };
      history.push(assistantMsg);

      for (const tc of completedToolCalls) {
        const tcName = tc.function?.name || '';
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || '{}');
        } catch (_e) { /* fall through with empty args */ }

        yield { type: 'tool_call', id: tc.id, name: tcName, args: parsedArgs };

        const { result, stagedChangesUpdate } = await runAgentTool(tcName, parsedArgs, {
          blocks: state.blocks,
          paddingMm: state.paddingMm,
          templateName: state.templateName,
          themeColors: state.themeColors,
          pageTitle: state.title,
          stagedChanges,
          screenshotProvider: this.screenshotProvider
        });

        yield { type: 'tool_result', id: tc.id, name: tcName, result };

        if (stagedChangesUpdate) {
          // Emit staged_change only for newly added blocks — not the full
          // accumulated map, which would re-emit blocks from earlier turns.
          const prevKeys = new Set(Object.keys(stagedChanges));
          stagedChanges = stagedChangesUpdate;
          for (const [blockId, change] of Object.entries(stagedChangesUpdate)) {
            if (!prevKeys.has(blockId)) {
              yield { type: 'staged_change', blockId, change };
            }
          }
        }

        // Append tool result to history
        history.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tcName,
          content: JSON.stringify(result)
        });
      }

      // --- Turn cap ---
      turn++;
      if (turn >= this.maxTurns) {
        yield {
          type: 'done',
          reason: 'max_turns',
          transaction: { stagedChanges }
        };
        return;
      }
    }
  }

  /**
   * Validate whether content fits within a block's spatial budget.
   * Runs the same computeLayout path the tools use internally.
   *
   * @param {import('./types.js').Block} block
   * @param {Object} rect - { leftMm, topMm, widthMm, heightMm } or null
   * @param {Object} layoutCtx - { templateName, paddingMm, themeColors }
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
