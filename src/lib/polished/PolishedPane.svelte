<!-- PolishedPane.svelte — Polished view container: toolbar, theme drawer, A4 pages, AI chat, overlays. -->
<script>
  import { onDestroy, tick } from 'svelte';
  import CvPage from './CvPage.svelte';
  import ElementsDock from './ElementsDock.svelte';
  import { findOverlappingIds } from './canvasUtils.js';
  import ChatDrawer from '../ai-chat/ChatDrawer.svelte';
  import { stagedChatBlockIds } from '../shared/stagingStore.js';
  import PolishedToolbar from './PolishedToolbar.svelte';
  import ThemeDrawer from './ThemeDrawer.svelte';
  import SelectionOverlay from './SelectionOverlay.svelte';

  let {
    blocks,
    paddingMm = $bindable(15),
    draggedBlockId = $bindable(),
    updateBlockCanvas,
    updateBlockName,
    updateBlockImageData = null,
    removeCanvasElement = null,
    isExportMode = false,
    pageTitle = '',
    templateName = 'clean',
    themeColors = $bindable(),
    onGoToDashboard,
    onChangeTemplate,
    undo = null,
    redo = null,
    historyPastLength = 0,
    historyFutureLength = 0,
    activeResumeId = null,
    isChatDrawerOpen = $bindable(false),
    addCanvasElement = null,
    toggleBlockLock = null,
    onImportJSON = null
  } = $props();

  let themeDrawerEl = $state(null);
  let chatDrawerEl = $state(null);
  let toolbarEl = $state(null);
  let selectedBlockIds = $state([]);
  let marqueeState = $state(null);
  let manualPageCount = $state(1);
  let isDrawerOpen = $state(false);

  // Page management
  const colWidth = (210 - 2 * paddingMm - 12) / 4;
  const overlappingBlockIds = $derived(findOverlappingIds(blocks, colWidth, paddingMm));
  const overlapCount = $derived(overlappingBlockIds.size);
  const unplacedCount = $derived(blocks.filter(b => !b.canvas).length);
  const maxPlacedPage = $derived(blocks.reduce((max, b) => b.canvas?.page > max ? b.canvas.page : max, 0));
  const totalPages = $derived(Math.max(manualPageCount, maxPlacedPage));

  const pagesToRender = $derived.by(() => {
    let pages = [];
    for (let p = 1; p <= totalPages; p++) pages.push(p);
    if (draggedBlockId) pages.push(totalPages + 1);
    return pages;
  });

  function addPage() { manualPageCount = totalPages + 1; }
  function deletePage(pageNum) {
    if (totalPages <= 1) return;
    const snapshot = [...blocks];
    snapshot.forEach(b => {
      if (!b.canvas) return;
      if (b.canvas.page === pageNum) {
        if (b.source === 'canvas' && removeCanvasElement) removeCanvasElement(b.id);
        else updateBlockCanvas(b.id, null);
      } else if (b.canvas.page > pageNum) {
        updateBlockCanvas(b.id, { page: b.canvas.page - 1 });
      }
    });
    if (manualPageCount > 1) manualPageCount--;
  }

  // Theme drawer
  function openStyleDrawer() {
    isChatDrawerOpen = false;
    themeDrawerEl?.openStyleDrawer();
    isDrawerOpen = true;
  }
  function closeStyleDrawer() { isDrawerOpen = false; }
  function toggleStyleDrawer() { isDrawerOpen ? closeStyleDrawer() : openStyleDrawer(); }

  // Chat
  function openChatDrawer() { isDrawerOpen = false; isChatDrawerOpen = true; }
  function toggleChatDrawer() { isChatDrawerOpen ? (isChatDrawerOpen = false) : openChatDrawer(); }
  function handleAskAI(blockIds) {
    openChatDrawer();
    stagedChatBlockIds.set(blockIds);
  }
  async function chatWithPolishedView() {
    openChatDrawer();
    await tick();
    chatDrawerEl?.forceAttachPolishedCV();
  }

  // Keyboard
  function handleKeyDown(e) {
    if (selectedBlockIds.length === 0) return;
    const active = document.activeElement;
    const isEditingText = active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT');
    if (isEditingText) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      selectedBlockIds.forEach(id => {
        const b = blocks.find(x => x.id === id);
        if (b && !b.locked) {
          if (b.source === 'canvas' && removeCanvasElement) removeCanvasElement(b.id);
          else updateBlockCanvas(b.id, null);
        }
      });
      selectedBlockIds = [];
      e.preventDefault();
    } else if (e.key === 'Escape') { selectedBlockIds = []; e.preventDefault(); }
  }

  // Container click
  function handleContainerClick(e) {
    const target = e.target;
    if (target.closest('.canvas-block') || target.closest('.canvas-toolbar') || target.closest('.elements-dock') ||
        target.closest('.ham-dropdown') || target.closest('.btn-delete-page') || target.closest('.floating-chat-bubble-container') ||
        target.closest('.chat-drawer') || target.closest('.theme-drawer') || target.closest('.btn-chat-polished-banner')) return;
    selectedBlockIds = [];
    isDrawerOpen = false;
    if (!target.closest('.hamburger-menu-wrap')) {
      toolbarEl?.closeMenu?.();
    }
  }

  // Marquee selection
  function handleContainerPointerDown(e) {
    const target = e.target;
    if (target.closest('.canvas-block') || target.closest('.canvas-toolbar') || target.closest('.elements-dock') ||
        target.closest('.ham-dropdown') || target.closest('.btn-delete-page') || target.closest('.floating-chat-bubble-container') ||
        target.closest('.chat-drawer') || target.closest('.theme-drawer') || target.closest('.btn-chat-polished-banner') ||
        target.closest('button') || target.closest('input') || target.closest('select')) return;
    if (e.button !== 0) return;

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) selectedBlockIds = [];
    marqueeState = { startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY };
    window.addEventListener('pointermove', handleMarqueePointerMove);
    window.addEventListener('pointerup', handleMarqueePointerUp, { once: true });
    isDrawerOpen = false;
  }

  function handleMarqueePointerMove(e) {
    if (!marqueeState) return;
    marqueeState = { ...marqueeState, currentX: e.clientX, currentY: e.clientY };
  }

  function handleMarqueePointerUp(e) {
    if (!marqueeState) return;
    window.removeEventListener('pointermove', handleMarqueePointerMove);

    const rect = {
      left: Math.min(marqueeState.startX, marqueeState.currentX),
      top: Math.min(marqueeState.startY, marqueeState.currentY),
      right: Math.max(marqueeState.startX, marqueeState.currentX),
      bottom: Math.max(marqueeState.startY, marqueeState.currentY)
    };

    const selected = [];
    const pageElements = document.querySelectorAll('.cv-page-container');
    pageElements.forEach(pageEl => {
      const pageRect = pageEl.getBoundingClientRect();
      if (rect.right < pageRect.left || rect.left > pageRect.right || rect.bottom < pageRect.top || rect.top > pageRect.bottom) return;

      const blocksOnPage = pageEl.querySelectorAll('.canvas-block');
      blocksOnPage.forEach(blockEl => {
        const bRect = blockEl.getBoundingClientRect();
        if (rect.right > bRect.left && rect.left < bRect.right && rect.bottom > bRect.top && rect.top < bRect.bottom) {
          const id = blockEl.getAttribute('data-block-id');
          if (id) selected.push(id);
        }
      });
    });

    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      selectedBlockIds = Array.from(new Set([...selectedBlockIds, ...selected]));
    } else {
      selectedBlockIds = selected;
    }
    marqueeState = null;
  }

  onDestroy(() => {
    window.removeEventListener('pointermove', handleMarqueePointerMove);
  });
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="polished-container" class:export-mode={isExportMode} onclick={handleContainerClick} onpointerdown={handleContainerPointerDown}>

  <PolishedToolbar
    bind:this={toolbarEl}
    {isExportMode}
    {onGoToDashboard}
    {undo}
    {redo}
    {historyPastLength}
    {historyFutureLength}
    {onChangeTemplate}
    {templateName}
    {isChatDrawerOpen}
    {toggleChatDrawer}
    {addPage}
    {toggleStyleDrawer}
    {isDrawerOpen}
    bind:paddingMm
    {blocks}
    {pageTitle}
    {themeColors}
    {totalPages}
    {onImportJSON}
  />

  {#if !isExportMode}
    <ThemeDrawer bind:this={themeDrawerEl} bind:isDrawerOpen bind:themeColors />
  {/if}

  {#if !isExportMode && isChatDrawerOpen}
    <ChatDrawer
      bind:this={chatDrawerEl}
      resumeId={activeResumeId || 'default'}
      {blocks}
      {pageTitle}
      {paddingMm}
      templateName={templateName}
      {themeColors}
      {selectedBlockIds}
      onClose={() => isChatDrawerOpen = false}
    />
  {/if}

  <!-- A4 pages -->
  <div class="pages-scroll-area" class:export-scroll={isExportMode}>
    {#if !isExportMode && overlapCount > 0}
      <div class="overlap-banner">
        <span class="banner-icon">⚠️</span>
        <span class="banner-text">{overlapCount} block{overlapCount > 1 ? 's' : ''} overlapping — move or resize the highlighted blocks to fix.</span>
      </div>
    {/if}

    {#if !isExportMode}
      <div class="canvas-top-actions">
        <button type="button" class="btn-chat-polished-banner" onclick={chatWithPolishedView} title="Analyze visual layout, whitespace and fonts with AI feedback">
          🎨 Chat with AI (Polished CV)
        </button>
      </div>
    {/if}

    <div class="pages-list">
      {#each pagesToRender as pageNum}
        <div class="page-wrapper" class:is-ghost={pageNum > totalPages}>
          {#if !isExportMode && totalPages > 1 && pageNum <= totalPages}
            <div class="page-header-actions">
              <button type="button" class="btn-delete-page" onclick={() => deletePage(pageNum)} title="Delete Page {pageNum}">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
                Delete Page {pageNum}
              </button>
            </div>
          {/if}
          <CvPage
            page={pageNum}
            {blocks}
            {paddingMm}
            bind:selectedBlockIds
            {updateBlockCanvas}
            {updateBlockName}
            {updateBlockImageData}
            {removeCanvasElement}
            {overlappingBlockIds}
            bind:draggedBlockId
            {templateName}
            {themeColors}
            onAskAI={handleAskAI}
            {toggleBlockLock}
          />
          {#if !isExportMode && pageNum > totalPages}
            <div class="ghost-page-label">Page {pageNum} (Drop block to add page)</div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  {#if !isExportMode && addCanvasElement}
    <ElementsDock {addCanvasElement} {removeCanvasElement} bind:draggedBlockId {blocks} />
  {/if}

  <SelectionOverlay {marqueeState} />

  {#if !isExportMode && selectedBlockIds.length > 0 && !isChatDrawerOpen}
    <div class="floating-chat-bubble-container">
      <button type="button" class="floating-chat-bubble" onclick={() => handleAskAI(selectedBlockIds)}>
        💬 Chat with AI about {selectedBlockIds.length} block{selectedBlockIds.length > 1 ? 's' : ''}
      </button>
    </div>
  {/if}
</div>

<style>
  .polished-container {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    background-color: #f1f5f9;
    overflow: hidden;
    position: relative;
    box-sizing: border-box;
  }

  .polished-container.export-mode {
    background-color: #ffffff;
    height: auto;
    overflow: visible;
  }

  /* Pages */
  .pages-scroll-area {
    flex-grow: 1;
    overflow-y: auto;
    padding: 40px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }

  .pages-scroll-area.export-scroll {
    overflow: visible;
    padding: 0;
    gap: 0;
    background-color: #ffffff;
  }

  .pages-list {
    display: flex;
    flex-direction: column;
    gap: 15mm;
  }

  .export-scroll .pages-list { gap: 0; }

  .page-wrapper { position: relative; }

  .page-wrapper.is-ghost { opacity: 0.65; }

  .page-wrapper.is-ghost :global(.cv-page) {
    border: 2px dashed #cbd5e1;
    box-shadow: none;
    background-color: rgba(255, 255, 255, 0.4);
  }

  .ghost-page-label {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    color: #64748b;
    pointer-events: none;
    text-shadow: 0 1px 2px #ffffff;
  }

  .page-header-actions {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 8px;
    width: 210mm;
    margin-left: auto;
    margin-right: auto;
  }

  .btn-delete-page {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background-color: #ffffff;
    border: 1px solid var(--notion-border, #e2e8f0);
    border-radius: var(--radius-default, 4px);
    color: var(--color-carbon-black, #874F41);
    font-size: 11px;
    font-family: var(--font-sans);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 6px 12px;
    cursor: pointer;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    transition: all 0.15s ease;
  }

  .btn-delete-page:hover {
    background-color: #fbf5f3;
    border-color: var(--color-magenta-bloom, #E64833);
    color: var(--color-magenta-bloom, #E64833);
  }

  /* Overlap banner */
  .overlap-banner {
    width: 210mm;
    background-color: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 13px;
    color: #991b1b;
    box-sizing: border-box;
  }

  .banner-icon { font-size: 16px; }
  .banner-text { font-weight: 500; }

  /* Chat banner */
  .canvas-top-actions {
    display: flex;
    justify-content: center;
    padding: 12px 0 4px 0;
    flex-shrink: 0;
  }

  .btn-chat-polished-banner {
    font-size: 11px;
    font-weight: 700;
    color: #0a2463;
    background: rgba(10, 36, 99, 0.05);
    border: 1px dashed rgba(10, 36, 99, 0.25);
    border-radius: 6px;
    padding: 6px 16px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
    box-shadow: 0 1px 3px rgba(10, 36, 99, 0.02);
  }

  .btn-chat-polished-banner:hover {
    background: rgba(10, 36, 99, 0.09);
    border-color: #0a2463;
    box-shadow: 0 2px 8px rgba(10, 36, 99, 0.06);
  }

  /* Floating chat bubble */
  .floating-chat-bubble-container {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    animation: bubble-fade-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes bubble-fade-up {
    from { opacity: 0; transform: translate(-50%, 12px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }

  .floating-chat-bubble {
    background: #0a2463;
    color: #ffffff;
    border: none;
    border-radius: 20px;
    padding: 8px 16px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(10, 36, 99, 0.15), 0 2px 4px rgba(10, 36, 99, 0.1);
    display: flex;
    align-items: center;
    gap: 6px;
    transition: background-color 0.15s, transform 0.15s;
    font-family: var(--font-sans);
  }

  .floating-chat-bubble:hover { background: #081d50; transform: scale(1.03); }

  @media print {
    .polished-container {
      background-color: #ffffff !important;
      overflow: visible !important;
      height: auto !important;
    }
    .pages-scroll-area { padding: 0 !important; gap: 0 !important; overflow: visible !important; }
    .pages-list { gap: 0 !important; }
    .overlap-banner, .ghost-page-label { display: none !important; }
    .page-wrapper.is-ghost { display: none !important; }
    .canvas-top-actions, .floating-chat-bubble-container { display: none !important; }
  }
</style>
