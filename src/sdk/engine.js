// Agentic engine — the environment-agnostic autonomous tool-calling loop.
//
// Inverts the host-based loop: instead of writing into chatList / stagedChanges,
// the engine yields AgentEvents and accumulates staged changes internally,
// returning them as a transaction.
//
// Zero Svelte, zero browser globals, zero fetch. Everything host-specific
// arrives through the injected modelProvider / screenshotProvider.

import { runAgentTool, runLayoutDesignerTool, AGENT_TOOLS, LAYOUT_DESIGNER_TOOLS, getAgentSystemPrompt, getSystemPromptOutline, computeBlockCapacity } from './tools.js';
import { getLayoutDesignerPrompt } from './prompts.js';
import { blockRectMm } from '../lib/layout/index.js';

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
   * @param {'editor'|'layout_designer'} [opts.subAgent] - Sub-agent when mode is 'agent'. Default: 'editor'.
   * @returns {AsyncIterable<import('./types.js').AgentEvent>}
   */
  async *optimizeResume(state, instruction, opts = {}) {
    const signal = opts.signal;
    const mode = opts.mode || 'agent';
    const subAgent = opts.subAgent || 'editor';
    const isLayout = mode === 'agent' && subAgent === 'layout_designer';
    const systemPrompt = opts.systemPrompt ||
      (isLayout
        ? getLayoutDesignerPrompt(state.blocks, state.title)
        : mode === 'agent'
          ? getAgentSystemPrompt(state.blocks, state.title)
          : getSystemPromptOutline(state.blocks, state.title));

    let history = opts.messages && opts.messages.length > 0
      ? [...opts.messages]
      : [{ role: 'user', content: instruction || 'Optimize my resume.' }];

    /** @type {Object<string, import('./types.js').StagedChange>} */
    let stagedChanges = {};
    let turn = 0;

    // Layout Designer: track placements to enforce visual checkpoints
    let layoutPlacementCount = 0;
    let layoutLastScreenshotAt = 0;

    // Track blocks with content overflow — the AI MUST fix these before placing more
    /** @type {Set<string>} */
    let pendingOverflows = new Set();

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
          tools: isLayout ? LAYOUT_DESIGNER_TOOLS : mode === 'agent' ? AGENT_TOOLS : undefined,
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
          yield { type: 'done', reason: 'aborted', transaction: { stagedChanges } };
          return;
        }
        // Emit error event then a single done that carries whatever was staged — fixes
        // Fix #5 (staged work not lost) and Fix #11 (reason was misleadingly 'aborted').
        yield { type: 'error', error: `Model call failed: ${err.message}` };
        yield { type: 'done', reason: 'error', transaction: { stagedChanges } };
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
        // Omit content entirely when empty — null serializes as "content":null which
        // Gemini's OpenAI-compat layer rejects. undefined is stripped by JSON.stringify.
        ...(contentAccumulated ? { content: contentAccumulated } : {}),
        tool_calls: completedToolCalls
      };
      history.push(assistantMsg);

      for (const tc of completedToolCalls) {
        // Check abort between tool dispatches — important for multi-tool turns
        // where a screenshot tool may be slow and the user aborts mid-batch.
        if (signal?.aborted) {
          yield { type: 'done', reason: 'aborted', transaction: { stagedChanges } };
          return;
        }

        const tcName = tc.function?.name || '';
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(tc.function?.arguments || '{}');
        } catch (_e) { /* fall through with empty args */ }

        // Ensure tool call IDs are always non-empty — Gemini sometimes omits them in
        // streaming deltas. Empty IDs cause tool_call_id mismatches in multi-tool turns.
        if (!tc.id) tc.id = `tool_${completedToolCalls.indexOf(tc)}_${tcName}`;

        yield { type: 'tool_call', id: tc.id, name: tcName, args: parsedArgs };

        const toolResult = await (isLayout ? runLayoutDesignerTool : runAgentTool)(tcName, parsedArgs, {
          blocks: state.blocks,
          paddingMm: state.paddingMm,
          templateName: state.templateName,
          themeColors: state.themeColors,
          pageTitle: state.title,
          stagedChanges,
          screenshotProvider: this.screenshotProvider,
          strictCapacity: opts.strictCapacity || false
        });

        // Layout Designer: track placements and screenshots for visual checkpoints
        if (isLayout) {
          if (tcName === 'place_block') {
            layoutPlacementCount++;
            if (toolResult.result?.message?.includes('OVERFLOW')) {
              pendingOverflows.add(parsedArgs.id);
            } else {
              pendingOverflows.delete(parsedArgs.id);
            }
          }
          if (tcName === 'get_block_screenshot' || tcName === 'get_page_screenshot') layoutLastScreenshotAt = layoutPlacementCount;
        }

        const { result, stagedChangesUpdate, canvasChange, canvasChanges, contentChange } = toolResult;

        yield { type: 'tool_result', id: tc.id, name: tcName, result };

        if (canvasChange) {
          yield { type: 'canvas_change', blockId: canvasChange.blockId, canvas: canvasChange.canvas };
        }
        if (canvasChanges) {
          for (const cc of canvasChanges) {
            yield { type: 'canvas_change', blockId: cc.blockId, canvas: cc.canvas };
          }
        }

        if (contentChange) {
          console.log('[engine] yielding content_change', contentChange.blockId, 'len:', contentChange.content?.filter(n => n.type === 'text').map(n => n.text).join('').length);
          yield { type: 'content_change', blockId: contentChange.blockId, content: contentChange.content };
        }

        if (stagedChangesUpdate) {
          // Emit staged_change whenever a block's staged content changes — including
          // the second (or Nth) update to the same block. Compare by serialized value
          // so that true no-ops (identical re-proposal) are not re-emitted.
          const prev = stagedChanges;
          stagedChanges = stagedChangesUpdate;
          for (const [blockId, change] of Object.entries(stagedChangesUpdate)) {
            if (JSON.stringify(prev[blockId]) !== JSON.stringify(change)) {
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

      // Layout Designer: merge checkpoint + overflow into a single user message to avoid
      // consecutive user-role messages, which Gemini's OpenAI-compat layer rejects.
      if (isLayout) {
        const parts = [];

        if (layoutPlacementCount > 0 && layoutPlacementCount - layoutLastScreenshotAt >= 5) {
          parts.push(`[SYSTEM] You have placed ${layoutPlacementCount - layoutLastScreenshotAt} blocks since your last visual check. Pause now. Call evaluate_layout on the current page to get a numeric score and penalty list, then call get_page_screenshot to see the full page. Fix any penalties (especially hard fails and tall-thin blocks) before continuing. Then resume placing remaining blocks.`);
          layoutLastScreenshotAt = layoutPlacementCount;
        }

        if (pendingOverflows.size > 0) {
          const blockList = [...pendingOverflows].map(id => {
            const b = state.blocks.find(bl => bl.id === id);
            return b ? `"${b.name || b.id}" (${b.type})` : id;
          }).join(', ');
          parts.push(`[SYSTEM] The following blocks have content overflow and MUST be fixed before you place any more blocks: ${blockList}. Re-place these blocks with a larger rowSpan. Do NOT call place_block on new blocks until all overflows are resolved.`);
        }

        if (parts.length > 0) {
          history.push({ role: 'user', content: parts.join('\n\n') });
        }
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
   * Delegates to the same computeBlockCapacity used by update_block_content
   * so CLI/pipeline gating and in-loop checks always agree (FR2.9).
   *
   * @param {import('./types.js').Block} block
   * @param {Object} rect - { leftMm, topMm, widthMm, heightMm } or null
   * @param {Object} layoutCtx - { templateName, paddingMm, themeColors }
   * @returns {import('./types.js').LayoutCapacity}
   */
  validateBlockLayout(block, rect, layoutCtx) {
    return computeBlockCapacity(block, rect, layoutCtx);
  }
}
