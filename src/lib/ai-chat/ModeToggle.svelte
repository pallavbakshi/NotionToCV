<!-- ModeToggle.svelte -->
<script>
  let { historyView, chatMode, setChatMode } = $props();
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
</style>
