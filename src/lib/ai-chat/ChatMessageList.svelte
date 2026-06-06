<!-- ChatMessageList.svelte -->
<script>
  let {
    messageListEl = $bindable(null),
    messages = [],
    isGenerating = false,
    blocks = [],
    renderMarkdown,
    attachPolishedCV,
    attachAllBlocks
  } = $props();
</script>

<div class="message-list" bind:this={messageListEl}>
  {#if messages.length === 0}
    <div class="empty-state">
      <span class="bot-avatar-large">🤖</span>
      <h4>Chat with AI</h4>
      <p>Select canvas blocks to ask for text enhancements, or review layout whitespace by attaching the polished view.</p>

      <div class="empty-state-suggestions">
        <button
          type="button"
          class="suggestion-btn"
          onclick={attachPolishedCV}
        >
          🎨 Attach Polished CV (Visual Review)
        </button>
        <button
          type="button"
          class="suggestion-btn"
          onclick={attachAllBlocks}
          disabled={blocks.length === 0}
        >
          📚 Attach All Blocks ({blocks.length})
        </button>
      </div>
    </div>
  {:else}
    {#each messages as msg (msg.id)}
      {#if msg.role !== 'tool'}
        <div class="message-row {msg.role}">
        <div class="message-bubble">
          {#if msg.role === 'user'}
            <div class="message-text">{msg.content}</div>
            {#if msg.attachments && msg.attachments.length > 0}
              <div class="attached-chips-display">
                {#each msg.attachments as att}
                  <span class="chip chip-readonly" class:chip-denied={att.type === 'denied'} title={att.type}>
                    {#if att.type === 'block'}📦{:else if att.type === 'polished'}🎨{:else if att.type === 'denied'}❌{:else}📎{/if}
                    {att.label}
                  </span>
                {/each}
              </div>
            {/if}
          {:else if msg.role === 'tool_call'}
            <div class="tool-call-status">
              <span class="tool-icon">⚙️</span>
              <span class="tool-text">{msg.content || 'Running tool...'}</span>
            </div>
          {:else}
            <!-- Assistant Message -->
            <div class="markdown-content">
              {@html renderMarkdown(msg.content)}
            </div>
            {#if !msg.content && isGenerating && msg === messages[messages.length - 1]}
              <div class="stream-loading-dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
            {/if}
          {/if}
        </div>
      </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  .message-list {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
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

  .bot-avatar-large {
    font-size: 36px;
    margin-bottom: 12px;
  }

  .empty-state h4 {
    font-size: 14px;
    font-weight: 700;
    color: #111827;
    margin: 0 0 6px 0;
  }

  .empty-state p {
    font-size: 12.5px;
    line-height: 1.5;
    margin: 0;
    max-width: 240px;
  }

  .message-row {
    display: flex;
    width: 100%;
  }

  .message-row.user {
    justify-content: flex-end;
  }

  .message-bubble {
    max-width: 85%;
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
    box-sizing: border-box;
  }

  .user .message-bubble {
    background-color: var(--chat-user-bubble-bg);
    color: var(--chat-user-bubble-text);
    border-bottom-right-radius: 2px;
  }

  .assistant .message-bubble {
    background-color: var(--chat-assistant-bubble-bg);
    border: 1px solid var(--chat-assistant-bubble-border);
    color: var(--chat-assistant-bubble-text);
    border-bottom-left-radius: 2px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
  }

  .attached-chips-display {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
  }

  .stream-loading-dots {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 0;
  }

  .stream-loading-dots .dot {
    width: 6px;
    height: 6px;
    background-color: #6b7280;
    border-radius: 50%;
    animation: stream-dot-pulse 1.2s infinite ease-in-out;
  }

  .stream-loading-dots .dot:nth-child(2) { animation-delay: 0.2s; }
  .stream-loading-dots .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes stream-dot-pulse {
    0%, 100% { transform: scale(0.6); opacity: 0.4; }
    50% { transform: scale(1); opacity: 1; }
  }

  .message-text {
    white-space: pre-wrap;
  }

  .tool-call-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #4b5563;
    background: rgba(10, 36, 99, 0.04);
    border: 1px solid rgba(10, 36, 99, 0.08);
    border-radius: 6px;
    padding: 6px 12px;
    margin: 4px 0;
  }

  .tool-icon {
    font-size: 12px;
    display: inline-block;
    animation: rotate-tool 3s linear infinite;
  }

  @keyframes rotate-tool {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .empty-state-suggestions {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 16px;
    width: 100%;
    max-width: 280px;
  }

  .suggestion-btn {
    background: #ffffff;
    border: 1px solid var(--chat-input-border);
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--chat-text-main);
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    font-family: var(--font-sans);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  }

  .suggestion-btn:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.04);
    border-color: var(--chat-primary);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
  }

  .suggestion-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .markdown-content :global(p) {
    margin: 0 0 8px 0;
  }
  .markdown-content :global(p:last-child) {
    margin-bottom: 0;
  }
  .markdown-content :global(strong) {
    font-weight: 700;
  }
  .markdown-content :global(em) {
    font-style: italic;
  }
  .markdown-content :global(code) {
    background: rgba(0, 0, 0, 0.05);
    padding: 2px 4px;
    border-radius: 3px;
    font-family: monospace;
    font-size: 12px;
  }
  .markdown-content :global(pre) {
    background: rgba(0, 0, 0, 0.05);
    padding: 8px;
    border-radius: 6px;
    overflow-x: auto;
    margin: 8px 0;
  }
  .markdown-content :global(pre code) {
    background: transparent;
    padding: 0;
  }
  .markdown-content :global(h1), .markdown-content :global(h2), .markdown-content :global(h3) {
    margin: 12px 0 6px 0;
    font-weight: 700;
    color: #111827;
  }
  .markdown-content :global(h1) { font-size: 17px; }
  .markdown-content :global(h2) { font-size: 15px; }
  .markdown-content :global(h3) { font-size: 13.5px; }
  .markdown-content :global(ul) {
    margin: 0 0 8px 0;
    padding-left: 20px;
  }
  .markdown-content :global(li) {
    margin-bottom: 4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid rgba(0, 0, 0, 0.12);
    border-radius: 12px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 500;
    color: #000000;
  }

  .chip-readonly {
    background: rgba(255, 255, 255, 0.15);
    border-color: rgba(255, 255, 255, 0.25);
    color: #ffffff;
  }

  .chip-readonly.chip-denied {
    background: rgba(239, 68, 68, 0.2);
    border-color: rgba(239, 68, 68, 0.45);
    color: #fee2e2;
  }
</style>
