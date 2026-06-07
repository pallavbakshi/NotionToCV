<!-- ModeToggle.svelte -->
<script>
  let { historyView, chatMode, subAgent, setChatMode, setSubAgent } = $props();
</script>

{#if !historyView}
  <div class="mode-toggle-bar">
    <button
      type="button"
      class="mode-toggle-btn"
      class:active={chatMode === 'chat'}
      onclick={() => setChatMode('chat')}
    >
      Chat Mode
    </button>
    <button
      type="button"
      class="mode-toggle-btn"
      class:active={chatMode === 'agent'}
      onclick={() => setChatMode('agent')}
    >
      Agent Mode
    </button>
  </div>

  {#if chatMode === 'agent'}
    <div class="sub-agent-row">
      <span class="sub-agent-label">Sub-agent:</span>
      <select class="sub-agent-select" value={subAgent || 'editor'} onchange={(e) => setSubAgent(e.target.value)}>
        <option value="editor">Content Editor</option>
        <option value="layout_designer">Layout Designer</option>
      </select>
    </div>
  {/if}
{/if}

<style>
  .mode-toggle-bar {
    display: flex;
    background: rgba(0, 0, 0, 0.04);
    margin: 8px 12px 0 12px;
    padding: 3px;
    border-radius: 8px;
    flex-shrink: 0;
  }

  .mode-toggle-btn {
    flex: 1;
    background: transparent;
    border: none;
    border-radius: 6px;
    padding: 6px;
    font-size: 12px;
    font-weight: 600;
    color: #4b5563;
    cursor: pointer;
    transition: all 0.15s ease-in-out;
  }

  .mode-toggle-btn:hover {
    color: #111827;
  }

  .mode-toggle-btn.active {
    background: #ffffff;
    color: var(--chat-primary, #0a2463);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .sub-agent-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 6px 12px 0 12px;
    flex-shrink: 0;
  }

  .sub-agent-label {
    font-size: 11px;
    font-weight: 600;
    color: #6b7280;
    white-space: nowrap;
  }

  .sub-agent-select {
    flex: 1;
    padding: 4px 6px;
    font-size: 12px;
    font-weight: 500;
    color: #374151;
    background: rgba(0, 0, 0, 0.03);
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 5px;
    cursor: pointer;
    outline: none;
  }

  .sub-agent-select:focus {
    border-color: var(--chat-primary, #0a2463);
    box-shadow: 0 0 0 2px rgba(10, 36, 99, 0.1);
  }
</style>
