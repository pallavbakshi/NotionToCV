<!-- ChatInput.svelte -->
<script>
  let {
    historyView = false,
    renderError = '',
    stagedAttachments = [],
    showAttachDropdown = $bindable(false),
    fileInputEl = $bindable(null),
    inputText = $bindable(''),
    isGenerating = false,
    backgroundJobStatus = 'idle',
    blocks = [],
    removeAttachment,
    attachAllBlocks,
    attachPolishedCV,
    triggerFileInput,
    handleFileUpload,
    sendMessage,
    stopGeneration,
    handleRunInBackground
  } = $props();
</script>

{#if !historyView}
  <div class="drawer-input-area">
    {#if renderError}
      <div class="error-banner">{renderError}</div>
    {/if}

    {#if stagedAttachments.length > 0}
      <div class="staged-chips">
        {#each stagedAttachments as att, i}
          <span class="chip" class:chip-loading={att.loading} class:chip-denied={att.type === 'denied'}>
            {#if att.type === 'block'}📦{:else if att.type === 'polished'}🎨{:else if att.type === 'denied'}❌{:else}📎{/if}
            {att.label}
            {#if !att.loading}
              <button type="button" class="btn-remove-chip" onclick={() => removeAttachment(i)}>✕</button>
            {/if}
          </span>
        {/each}
      </div>
    {/if}

    <div class="chat-input-controls">
      <div class="attach-dropdown-wrap">
        <button
          type="button"
          class="btn-control-icon"
          onclick={() => showAttachDropdown = !showAttachDropdown}
          title="Attach Context"
        >
          📎
        </button>

        {#if showAttachDropdown}
          <div class="attach-dropdown-menu">
            <button
              type="button"
              onclick={attachAllBlocks}
              disabled={blocks.length === 0}
            >
              📚 Attach All Blocks ({blocks.length})
            </button>
            <button type="button" onclick={attachPolishedCV}>
              🎨 Attach Polished CV (Visual Review)
            </button>
            <button type="button" onclick={triggerFileInput}>
              💻 Upload Local File
            </button>
          </div>
        {/if}
      </div>

      <input
        type="file"
        style="display:none;"
        bind:this={fileInputEl}
        onchange={handleFileUpload}
      />

      <textarea
        bind:value={inputText}
        placeholder="Chat with AI..."
        rows="1"
        spellcheck="false"
        onkeydown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        }}
      ></textarea>

      {#if isGenerating || backgroundJobStatus === 'polling'}
        <button type="button" class="btn-send-message btn-stop-message" onclick={stopGeneration} title="Stop Generating">
          ⏹
        </button>
      {:else}
        <button
          type="button"
          class="btn-send-message btn-bg-job"
          onclick={handleRunInBackground}
          disabled={!inputText.trim()}
          title="Run in Background"
        >
          ⚡
        </button>
        <button
          type="button"
          class="btn-send-message"
          onclick={sendMessage}
          disabled={!inputText.trim() && stagedAttachments.length === 0}
          title="Send Message"
        >
          ➔
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .drawer-input-area {
    padding: 12px;
    border-top: 1px solid rgba(55, 53, 47, 0.08);
    background: rgba(255, 255, 255, 0.5);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
  }

  .error-banner {
    background-color: #fee2e2;
    border: 1px solid #fca5a5;
    border-radius: 6px;
    padding: 6px 10px;
    color: #b91c1c;
    font-size: 10px;
    margin-bottom: 8px;
  }

  .staged-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
    padding: 0 2px;
  }

  .chat-input-controls {
    display: flex;
    align-items: center;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.15);
    border-radius: 8px;
    padding: 4px 6px;
    gap: 6px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
  }

  .chat-input-controls:focus-within {
    border-color: var(--chat-primary);
  }

  .attach-dropdown-wrap {
    position: relative;
  }

  .btn-control-icon {
    background: transparent;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    transition: background-color 0.15s;
  }

  .btn-control-icon:hover {
    background-color: #f3f4f6;
    color: #111827;
  }

  .attach-dropdown-menu {
    position: absolute;
    bottom: 30px;
    left: 0;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.15);
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    border-radius: 6px;
    padding: 4px;
    display: flex;
    flex-direction: column;
    min-width: 170px;
    z-index: 600;
  }

  .attach-dropdown-menu button {
    background: transparent;
    border: none;
    font-size: 11px;
    font-weight: 500;
    text-align: left;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    color: #374151;
    transition: background-color 0.15s;
  }

  .attach-dropdown-menu button:hover:not(:disabled) {
    background-color: #f3f4f6;
  }

  .attach-dropdown-menu button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .chat-input-controls textarea {
    flex: 1;
    border: none;
    background: transparent;
    font-size: 13.5px;
    font-family: inherit;
    color: #000000;
    outline: none;
    resize: none;
    padding: 6px 0;
    max-height: 80px;
    line-height: 1.4;
  }

  .btn-send-message {
    background: var(--chat-primary);
    border: none;
    color: #ffffff;
    font-size: 11px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: background-color 0.15s, opacity 0.15s;
  }

  .btn-send-message:hover:not(:disabled) {
    background-color: var(--chat-primary-hover);
  }

  .btn-bg-job {
    background-color: transparent;
    color: var(--chat-text-muted);
    border: 1px solid var(--chat-border);
    font-size: 12px;
  }
  .btn-bg-job:hover:not(:disabled) {
    background-color: #eef2ff;
    color: #3730a3;
    border-color: #c7d2fe;
  }

  .btn-send-message:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .btn-stop-message {
    background: #ef4444;
  }
  .btn-stop-message:hover {
    background: #dc2626;
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

  .chip-loading {
    background: rgba(156, 163, 175, 0.06);
    border-color: rgba(156, 163, 175, 0.15);
    color: #6b7280;
    animation: chip-pulse 1.5s infinite ease-in-out;
  }

  .chip.chip-denied {
    background: rgba(239, 68, 68, 0.08);
    border-color: rgba(239, 68, 68, 0.3);
    color: #dc2626;
  }

  @keyframes chip-pulse {
    0%, 100% { opacity: 0.6; }
    50% { opacity: 1; }
  }

  .btn-remove-chip {
    background: transparent;
    border: none;
    color: #ef4444;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    margin-left: 2px;
  }
</style>
