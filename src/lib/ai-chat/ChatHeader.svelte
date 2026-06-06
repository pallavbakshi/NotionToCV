<!-- ChatHeader.svelte -->
<script>
  let { historyView = $bindable(false), chatMode, startNewConversation, onClose } = $props();
</script>

<div class="drawer-header">
  {#if historyView}
    <h3>💬 Chat History</h3>
    <button type="button" class="btn-header-action" onclick={() => historyView = false} title="Back to Chat">Back</button>
  {:else}
    <div class="header-left">
      <h3>💬 Chat with AI</h3>
      <span class="chat-model-tag">{chatMode === 'agent' ? 'Claude Sonnet 4.5' : 'Gemini 2.5'}</span>
    </div>
    <div class="header-actions">
      <button type="button" class="btn-header-action" onclick={() => historyView = true} title="View previous chats">History</button>
      <button type="button" class="btn-header-action btn-add-chat" onclick={startNewConversation} title="Start new conversation">+</button>
      <button type="button" class="btn-close-drawer" onclick={onClose}>✕</button>
    </div>
  {/if}
</div>

<style>
  .drawer-header {
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    border-bottom: 1px solid rgba(55, 53, 47, 0.08);
    flex-shrink: 0;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .drawer-header h3 {
    font-size: 15.5px;
    font-weight: 700;
    color: var(--chat-text-main);
    margin: 0;
  }

  .chat-model-tag {
    font-size: 10px;
    background: rgba(0, 0, 0, 0.08);
    color: var(--chat-text-main);
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 500;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-header-action {
    background: transparent;
    border: 1px solid rgba(55, 53, 47, 0.15);
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #4b5563;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .btn-header-action:hover {
    background-color: rgba(55, 53, 47, 0.05);
  }

  .btn-add-chat {
    font-size: 13px;
    font-weight: 700;
    padding: 0 8px;
    height: 20px;
    display: flex;
    align-items: center;
  }

  .btn-close-drawer {
    background: transparent;
    border: none;
    font-size: 14px;
    color: #878682;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.15s;
    margin-left: 4px;
  }

  .btn-close-drawer:hover {
    background-color: rgba(55, 53, 47, 0.05);
  }
</style>
