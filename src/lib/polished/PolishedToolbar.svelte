<!-- PolishedToolbar.svelte — Toolbar + hamburger dropdown for the polished view. -->
<script>
  let {
    isExportMode = false,
    onGoToDashboard = null,
    undo = null,
    redo = null,
    historyPastLength = 0,
    historyFutureLength = 0,
    onChangeTemplate = null,
    templateName = 'clean',
    isChatDrawerOpen = false,
    toggleChatDrawer = null,
    addPage = null,
    toggleStyleDrawer = null,
    isDrawerOpen = false,
    paddingMm = $bindable(15),
    blocks = [],
    pageTitle = '',
    themeColors = {},
    totalPages = 1
  } = $props();

  let isMenuOpen = $state(false);
  let downloading = $state(false);

  export function closeMenu() { isMenuOpen = false; }

  async function downloadPdf() {
    if (downloading) return;
    downloading = true;
    try {
      const response = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks,
          pageTitle,
          paddingMm,
          templateName,
          themeColors,
          pageCount: totalPages
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to generate PDF');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const sanitizedTitle = (pageTitle.trim() || 'Untitled').replace(/[/\\:*?"<>|]/g, '_');
      a.download = `${sanitizedTitle}_resume.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (err) {
      console.error('Error generating PDF:', err);
      alert('Error generating PDF: ' + err.message);
    } finally {
      downloading = false;
    }
  }
</script>

{#if !isExportMode}
  <div class="canvas-toolbar">
    <div class="toolbar-left">
      {#if onGoToDashboard}
        <button type="button" class="btn-goto-dashboard" onclick={onGoToDashboard}>← Dashboard</button>
        <div class="toolbar-divider-v"></div>
      {/if}
      <div class="toolbar-label">Polished View</div>
      <button type="button" class="btn-change-template" onclick={() => undo?.()} disabled={historyPastLength === 0} style="display: flex; align-items: center; gap: 4px;" title="Undo (Cmd+Z)">↶ Undo</button>
      <button type="button" class="btn-change-template" onclick={() => redo?.()} disabled={historyFutureLength === 0} style="display: flex; align-items: center; gap: 4px;" title="Redo (Cmd+Shift+Z)">↷ Redo</button>
      <div class="toolbar-divider-v"></div>
      {#if onChangeTemplate}
        <button type="button" class="btn-change-template" onclick={onChangeTemplate}>
          ⊞ {templateName.charAt(0).toUpperCase() + templateName.slice(1)}
        </button>
      {/if}
    </div>

    <div class="toolbar-right" style="display: flex; align-items: center; gap: 8px;">
      <button type="button" class="btn-chat-toggle" class:active={isChatDrawerOpen} onclick={toggleChatDrawer} title="Chat with AI">
        💬 Chat with AI
      </button>

      <div class="hamburger-menu-wrap">
        <button type="button" class="btn-hamburger" class:open={isMenuOpen} onclick={(e) => { e.stopPropagation(); isMenuOpen = !isMenuOpen; }} aria-label="Canvas options">
          <span class="ham-line"></span>
          <span class="ham-line"></span>
          <span class="ham-line"></span>
        </button>

        {#if isMenuOpen}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="ham-dropdown" onclick={(e) => e.stopPropagation()}>
            <div class="ham-section">
              <button type="button" class="ham-btn" onclick={() => { addPage(); isMenuOpen = false; }}>+ Add Page</button>
            </div>

            <div class="ham-divider"></div>

            <div class="ham-section">
              <span class="ham-section-label">Theme</span>
              <button type="button" class="ham-btn" class:active={isDrawerOpen} onclick={() => { toggleStyleDrawer(); isMenuOpen = false; }}>
                🎨 Style Settings
              </button>
            </div>

            <div class="ham-divider"></div>

            <div class="ham-section">
              <span class="ham-section-label">Page Padding: {paddingMm}mm</span>
              <input type="range" min="10" max="25" step="1" bind:value={paddingMm} class="ham-slider" />
            </div>

            <div class="ham-divider"></div>

            <div class="ham-section">
              <button type="button" class="ham-btn ham-btn-primary" onclick={() => { downloadPdf(); isMenuOpen = false; }} disabled={downloading}>
                {#if downloading}<span class="spinner"></span> Generating...{:else}↓ Download PDF{/if}
              </button>
            </div>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .canvas-toolbar {
    height: 44px;
    border-bottom: 1px solid rgba(55, 53, 47, 0.09);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background-color: #f9fafb;
    user-select: none;
    flex-shrink: 0;
    z-index: 100;
  }

  .toolbar-left { display: flex; align-items: center; gap: 10px; }

  .toolbar-label {
    font-size: 11px; font-weight: 600; color: #878682;
    letter-spacing: 0.8px; text-transform: uppercase;
  }

  .btn-change-template {
    font-size: 11px; font-weight: 500; color: #4b5563;
    background: rgba(55, 53, 47, 0.06);
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 5px; padding: 3px 8px; cursor: pointer;
    transition: background-color 0.15s, color 0.15s; white-space: nowrap;
  }

  .btn-change-template:hover {
    background-color: rgba(35, 131, 226, 0.1); color: #2383e2;
    border-color: rgba(35, 131, 226, 0.25);
  }

  .btn-change-template:disabled { opacity: 0.5; cursor: not-allowed; }

  .btn-goto-dashboard {
    font-size: 11px; font-weight: 600; color: #2383e2;
    background: transparent; border: none; border-radius: 5px;
    padding: 3px 8px; cursor: pointer; transition: background-color 0.15s;
    white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;
  }

  .btn-goto-dashboard:hover { background-color: rgba(35, 131, 226, 0.08); }

  .toolbar-divider-v {
    width: 1px; height: 16px; background-color: rgba(55, 53, 47, 0.12); margin: 0 4px;
  }

  .toolbar-right { display: flex; align-items: center; gap: 8px; }

  .btn-chat-toggle {
    font-size: 11px; font-weight: 600; color: #4b5563;
    background: rgba(55, 53, 47, 0.06);
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 5px; padding: 3px 10px; cursor: pointer;
    transition: all 0.15s; white-space: nowrap;
    display: flex; align-items: center; gap: 4px;
  }

  .btn-chat-toggle:hover, .btn-chat-toggle.active {
    background-color: rgba(10, 36, 99, 0.08); color: #0a2463;
    border-color: rgba(10, 36, 99, 0.25);
  }

  /* Hamburger */
  .hamburger-menu-wrap { position: relative; }

  .btn-hamburger {
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    gap: 4px; width: 32px; height: 32px; background: transparent;
    border: 1px solid rgba(55, 53, 47, 0.14); border-radius: 6px;
    cursor: pointer; padding: 0;
    transition: background-color 0.15s, border-color 0.15s;
  }

  .btn-hamburger:hover, .btn-hamburger.open {
    background-color: rgba(55, 53, 47, 0.06); border-color: rgba(55, 53, 47, 0.22);
  }

  .ham-line {
    display: block; width: 14px; height: 1.5px; background-color: #374151;
    border-radius: 1px; transition: background-color 0.15s;
  }

  .btn-hamburger.open .ham-line { background-color: #2383e2; }

  .ham-dropdown {
    position: absolute; top: calc(100% + 8px); right: 0; min-width: 230px;
    background: #ffffff; border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 10px; box-shadow: 0 8px 24px rgba(10, 36, 99, 0.12), 0 2px 6px rgba(0,0,0,0.06);
    z-index: 500; overflow: hidden; animation: ham-in 0.12s ease-out;
  }

  @keyframes ham-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .ham-section { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }

  .ham-section-label {
    font-size: 10px; font-weight: 600; color: #9ca3af;
    text-transform: uppercase; letter-spacing: 0.6px;
  }

  .ham-divider { height: 1px; background-color: rgba(55, 53, 47, 0.07); margin: 0; }

  .ham-btn {
    width: 100%; text-align: left; background: transparent;
    border: 1px solid rgba(55, 53, 47, 0.12); border-radius: 6px;
    padding: 7px 10px; font-size: 13px; font-weight: 500; color: #374151;
    cursor: pointer; transition: background-color 0.12s, color 0.12s, border-color 0.12s;
    display: flex; align-items: center; gap: 6px;
  }

  .ham-btn:hover {
    background-color: rgba(35, 131, 226, 0.07); border-color: rgba(35, 131, 226, 0.25); color: #2383e2;
  }

  .ham-btn.active {
    background-color: rgba(35, 131, 226, 0.1); border-color: rgba(35, 131, 226, 0.3); color: #2383e2;
  }

  .ham-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .ham-btn-primary { background-color: #2383e2; border-color: #2383e2; color: #ffffff; font-weight: 600; }

  .ham-btn-primary:hover { background-color: #1a6fc2; border-color: #1a6fc2; color: #ffffff; }

  .ham-slider {
    width: 100%; height: 4px; -webkit-appearance: none; appearance: none;
    background: #e2e8f0; border-radius: 9999px; outline: none; cursor: pointer;
  }

  .ham-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 14px; height: 14px;
    border-radius: 50%; background: #2383e2; cursor: pointer; border: none;
    transition: transform 0.1s ease;
  }

  .ham-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }

  .spinner {
    width: 12px; height: 12px; border: 2px solid rgba(255,255,255,0.6);
    border-top-color: transparent; border-radius: 50%;
    animation: spin 0.8s linear infinite; display: inline-block; flex-shrink: 0;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
</style>
