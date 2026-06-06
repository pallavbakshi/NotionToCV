<!-- ChatHistoryList.svelte -->
<script>
  let { chatList, activeChatId, selectChat, deleteChat } = $props();
</script>

<div class="history-list">
  {#if chatList.length === 0}
    <div class="empty-state">No previous chats.</div>
  {:else}
    {#each chatList as chat (chat.id)}
      <div
        class="history-item-btn"
        class:active={chat.id === activeChatId}
        onclick={() => selectChat(chat.id)}
        role="button"
        tabindex="0"
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') selectChat(chat.id); }}
      >
        <div class="history-item-details">
          <span class="history-title">{chat.title}</span>
          <span class="history-time">{new Date(chat.updatedAt).toLocaleDateString()}</span>
        </div>
        <button
          type="button"
          class="btn-delete-history"
          onclick={(e) => deleteChat(chat.id, e)}
          title="Delete Conversation"
        >✕</button>
      </div>
    {/each}
  {/if}
</div>

<style>
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .history-item-btn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: rgba(255, 255, 255, 0.6);
    border: 1px solid rgba(55, 53, 47, 0.08);
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s;
  }

  .history-item-btn:hover {
    background: rgba(255, 255, 255, 0.95);
    border-color: rgba(10, 36, 99, 0.2);
    box-shadow: 0 2px 8px rgba(10, 36, 99, 0.04);
  }

  .history-item-btn.active {
    background: rgba(0, 0, 0, 0.04);
    border-color: var(--chat-primary);
  }

  .history-item-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .history-title {
    font-size: 13.5px;
    font-weight: 600;
    color: #1f2937;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-time {
    font-size: 10px;
    color: #9ca3af;
  }

  .btn-delete-history {
    background: transparent;
    border: none;
    color: #9ca3af;
    font-size: 12px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }

  .btn-delete-history:hover {
    color: #ef4444;
    background: rgba(239, 68, 68, 0.08);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 20px;
    margin: auto;
    color: #6b7280;
  }
</style>
