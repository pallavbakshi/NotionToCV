<!-- NotionPane.svelte -->
<script>
  import { onMount } from 'svelte';
  import BlockEditor from './BlockEditor.svelte';

  // Svelte 5 props
  let { 
    blocks = $bindable(), 
    pageTitle = $bindable(),
    draggedBlockId = $bindable(),
    paddingMm = $bindable(15),
    activeTemplate = $bindable('clean'),
    customTemplates = $bindable({}),
    themeColors = $bindable(),
    undo = null,
    redo = null,
    historyPastLength = 0,
    historyFutureLength = 0,
    onAskAI = null,
    stagedChanges = $bindable({}),
    acceptStagedChange = null,
    denyStagedChange = null,
    acceptAllStagedChanges = null,
    denyAllStagedChanges = null
  } = $props();

  let fileInput;
  let focusTarget = $state({ index: null, position: 'end', timestamp: 0 });
  let hasAnyStagedChanges = $derived(Object.keys(stagedChanges).length > 0);

  // Canvas-sourced elements (hr, vbar, headshot) are managed on the canvas side only
  let notionBlocks = $derived(blocks.filter(b => b.source !== 'canvas'));

  // Drag and drop states
  let dragFromIndex = $state(null);
  let dropTargetIndex = $state(null);
  let dropIndicatorTop = $state(null);
  let scrollContainerEl;
  let contentWrapperEl;

  // Multi-block states
  let selectedBlockIds = $state([]);
  let selectionBox = $state({
    active: false,
    startX: 0,
    startY: 0,
    left: 0,
    top: 0,
    width: 0,
    height: 0
  });

  // Programmatic focus helper
  function focusBlock(index, position = 'end') {
    if (index >= 0 && index < blocks.length) {
      focusTarget = { index, position, timestamp: Date.now() };
    }
  }

  // Mutations
  function addBlockAfter(index, afterCursorContent = []) {
    const newBlock = {
      id: 'b_' + Math.random().toString(36).substring(2, 9),
      type: 'paragraph',
      content: afterCursorContent,
      canvas: null,
      name: null
    };
    blocks.splice(index + 1, 0, newBlock);
    blocks = [...blocks];
    focusBlock(index + 1, 'start');
  }

  function deleteBlock(index) {
    if (blocks.length <= 1) {
      // Invariant: Never allow an empty blocks array
      blocks = [{
        id: 'b_' + Math.random().toString(36).substring(2, 9),
        type: 'paragraph',
        content: [],
        canvas: null,
        name: null
      }];
      focusBlock(0);
    } else {
      blocks.splice(index, 1);
      blocks = [...blocks];
      // Focus preceding block, or first block if index was 0
      const focusIdx = index > 0 ? index - 1 : 0;
      focusBlock(focusIdx, 'end');
    }
  }

  function deleteMultipleBlocks(ids) {
    if (ids.length === 0) return;
    const firstId = ids[0];
    const firstIdx = blocks.findIndex(b => b.id === firstId);

    blocks = blocks.filter(b => !ids.includes(b.id));

    // Invariant: Never allow an empty blocks array
    if (blocks.length === 0) {
      blocks = [{
        id: 'b_' + Math.random().toString(36).substring(2, 9),
        type: 'paragraph',
        content: [],
        canvas: null,
        name: null
      }];
    }

    selectedBlockIds = [];
    const focusIdx = firstIdx > 0 ? firstIdx - 1 : 0;
    focusBlock(focusIdx, 'end');
  }

  function duplicateBlock(index) {
    const original = blocks[index];
    const newBlock = {
      id: 'b_' + Math.random().toString(36).substring(2, 9),
      type: original.type,
      content: JSON.parse(JSON.stringify(original.content)),
      canvas: null,
      name: null
    };
    blocks.splice(index + 1, 0, newBlock);
    blocks = [...blocks];
    focusBlock(index + 1, 'end');
  }

  function duplicateMultipleBlocks(ids) {
    if (ids.length === 0) return;
    const selectedBlocks = blocks.filter(b => ids.includes(b.id));
    const duplicates = selectedBlocks.map(b => ({
      ...b,
      id: 'b_' + Math.random().toString(36).substring(2, 9),
      content: JSON.parse(JSON.stringify(b.content)),
      canvas: null,
      name: null
    }));

    const lastId = ids[ids.length - 1];
    const targetIdx = blocks.findIndex(b => b.id === lastId);
    const insertIdx = targetIdx !== -1 ? targetIdx + 1 : blocks.length;

    blocks.splice(insertIdx, 0, ...duplicates);
    blocks = [...blocks];

    selectedBlockIds = duplicates.map(b => b.id);
  }

  function updateBlock(index, patch) {
    if (index >= 0 && index < blocks.length) {
      blocks[index] = { ...blocks[index], ...patch };
    }
  }

  function moveBlock(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const item = blocks[fromIndex];
    blocks.splice(fromIndex, 1);
    
    let adjustedToIndex = toIndex;
    if (toIndex > fromIndex) {
      adjustedToIndex--;
    }
    blocks.splice(adjustedToIndex, 0, item);
    blocks = [...blocks];
  }

  function moveBlocks(idsToMove, toRealIndex) {
    const targetBlocks = blocks.filter(b => idsToMove.includes(b.id));
    if (targetBlocks.length === 0) return;

    const targetBlock = blocks[toRealIndex] || null;
    const remainingBlocks = blocks.filter(b => !idsToMove.includes(b.id));

    let insertIdx = remainingBlocks.length;
    if (targetBlock) {
      insertIdx = remainingBlocks.findIndex(b => b.id === targetBlock.id);
      if (insertIdx === -1) insertIdx = remainingBlocks.length;
    }

    remainingBlocks.splice(insertIdx, 0, ...targetBlocks);
    blocks = remainingBlocks;
  }

  // Merging logic
  function mergeWithPrevious(index, currentContent) {
    if (index <= 0) return;
    const prevBlock = blocks[index - 1];
    
    // Concatenate inline nodes
    const mergedContent = [...(prevBlock.content || []), ...currentContent];
    
    // Calculate junction cursor position (1 + text length of previous block)
    let prevTextLength = 0;
    if (prevBlock.content) {
      for (const node of prevBlock.content) {
        if (node.type === 'text' && node.text) {
          prevTextLength += node.text.length;
        } else if (node.type === 'hardBreak') {
          prevTextLength += 1;
        }
      }
    }
    const junctionPos = 1 + prevTextLength;

    // Update previous block
    blocks[index - 1] = {
      ...prevBlock,
      content: mergedContent
    };

    // Remove current block
    blocks.splice(index, 1);
    blocks = [...blocks];
    
    // Focus previous block at junction position
    focusBlock(index - 1, junctionPos);
  }

  // JSON Import & Export
  function exportJSON() {
    const data = {
      pageTitle,
      blocks,
      paddingMm,
      templateName: activeTemplate,
      customTemplates,
      themeColors
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (pageTitle.trim() || 'Untitled') + '_resume.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function triggerImport() {
    fileInput.click();
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data && Array.isArray(data.blocks)) {
          blocks = data.blocks;
          pageTitle = data.pageTitle || '';
          if (data.paddingMm !== undefined) paddingMm = data.paddingMm;
          if (data.templateName) activeTemplate = data.templateName;
          if (data.customTemplates) customTemplates = data.customTemplates;
          if (data.themeColors) {
            themeColors = {
              primaryColor: data.themeColors.primaryColor ?? '#0a2463',
              textColor: data.themeColors.textColor ?? '#1e1b18',
              backgroundColor: data.themeColors.backgroundColor ?? '#ffffff'
            };
          }
        } else {
          alert('Invalid JSON file format. It must contain a "blocks" array.');
        }
      } catch (err) {
        alert('Failed to parse JSON file.');
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset file input
  }

  // Drag and Drop Event Handlers
  function handleDragStart(index, e) {
    dragFromIndex = index;
    const block = notionBlocks[index];
    if (block) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', block.id);
      draggedBlockId = block.id;

      // If dragged block isn't in selection, reset selection to just this block
      if (!selectedBlockIds.includes(block.id)) {
        selectedBlockIds = [block.id];
      }
    }
  }

  function handleDragOver(index, e) {
    e.preventDefault();
    if (dragFromIndex === null) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const relativeY = e.clientY - rect.top;
    const isTopHalf = relativeY < rect.height / 2;

    const targetIdx = isTopHalf ? index : index + 1;

    // Do not show indicator if dropping results in no change
    if (targetIdx === dragFromIndex || targetIdx === dragFromIndex + 1) {
      dropTargetIndex = null;
      dropIndicatorTop = null;
      return;
    }

    dropTargetIndex = targetIdx;

    if (!contentWrapperEl) return;
    const wrapperRect = contentWrapperEl.getBoundingClientRect();

    if (targetIdx < blocks.length) {
      const targetElement = e.currentTarget.parentNode.children[targetIdx];
      if (targetElement) {
        const targetRect = targetElement.getBoundingClientRect();
        dropIndicatorTop = targetRect.top - wrapperRect.top;
      }
    } else {
      const lastElement = e.currentTarget.parentNode.children[blocks.length - 1];
      if (lastElement) {
        const lastRect = lastElement.getBoundingClientRect();
        dropIndicatorTop = lastRect.bottom - wrapperRect.top;
      }
    }
  }

  function handleDragEnd() {
    dragFromIndex = null;
    dropTargetIndex = null;
    dropIndicatorTop = null;
    draggedBlockId = null;
  }

  function handleDrop(index, e) {
    e.preventDefault();
    if (dragFromIndex !== null && dropTargetIndex !== null) {
      const draggedBlock = notionBlocks[dragFromIndex];
      const toNotion = notionBlocks[dropTargetIndex];
      const toReal = toNotion ? blocks.findIndex(b => b.id === toNotion.id) : blocks.length;

      if (draggedBlock && selectedBlockIds.includes(draggedBlock.id)) {
        moveBlocks(selectedBlockIds, toReal);
      } else {
        const fromReal = blocks.findIndex(b => b.id === draggedBlock?.id);
        if (fromReal !== -1) moveBlock(fromReal, toReal);
      }
    }
    handleDragEnd();
  }

  // Pointer events for marquee selection
  function handleContainerPointerDown(e) {
    if (e.button !== 0) return;

    const target = e.target;
    if (
      target.closest('.ProseMirror') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('select') ||
      target.closest('textarea') ||
      target.closest('.drag-handle') ||
      target.closest('.block-name-badge') ||
      target.closest('.bubble-menu-card') ||
      target.closest('.slash-menu-card') ||
      target.closest('.at-menu-card') ||
      target.closest('.action-menu-card')
    ) {
      return;
    }

    if (!e.shiftKey) {
      selectedBlockIds = [];
    }

    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;

    selectionBox = {
      active: true,
      startX,
      startY,
      left: startX,
      top: startY,
      width: 0,
      height: 0
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  }

  function handlePointerMove(e) {
    if (!selectionBox.active) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const left = Math.min(selectionBox.startX, currentX);
    const top = Math.min(selectionBox.startY, currentY);
    const width = Math.abs(selectionBox.startX - currentX);
    const height = Math.abs(selectionBox.startY - currentY);

    selectionBox = {
      ...selectionBox,
      left,
      top,
      width,
      height
    };

    updateSelectionFromBox();
  }

  function updateSelectionFromBox() {
    if (!selectionBox.active) return;
    if (!contentWrapperEl) return;

    const boxRect = {
      left: selectionBox.left,
      right: selectionBox.left + selectionBox.width,
      top: selectionBox.top,
      bottom: selectionBox.top + selectionBox.height
    };

    const rows = contentWrapperEl.querySelectorAll('.block-editor-row');
    const newSelectedIds = [];

    rows.forEach(row => {
      const rect = row.getBoundingClientRect();
      const overlap = !(
        rect.right < boxRect.left ||
        rect.left > boxRect.right ||
        rect.bottom < boxRect.top ||
        rect.top > boxRect.bottom
      );

      if (overlap) {
        const blockId = row.getAttribute('data-block-id');
        if (blockId) {
          newSelectedIds.push(blockId);
        }
      }
    });

    selectedBlockIds = newSelectedIds;
  }

  function handlePointerUp() {
    selectionBox.active = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  }

  // Shift range selection
  function handleSelectBlock(blockId, shift) {
    if (shift) {
      const targetIdx = blocks.findIndex(b => b.id === blockId);
      if (targetIdx === -1) return;

      if (selectedBlockIds.length === 0) {
        selectedBlockIds = [blockId];
      } else {
        const lastSelectedId = selectedBlockIds[selectedBlockIds.length - 1];
        const lastIdx = blocks.findIndex(b => b.id === lastSelectedId);

        if (lastIdx !== -1) {
          const start = Math.min(lastIdx, targetIdx);
          const end = Math.max(lastIdx, targetIdx);
          const rangeBlocks = blocks.slice(start, end + 1).map(b => b.id);
          selectedBlockIds = [...new Set([...selectedBlockIds, ...rangeBlocks])];
        } else {
          selectedBlockIds = [blockId];
        }
      }
    } else {
      selectedBlockIds = [blockId];
    }
  }

  function handleEditorFocus(blockId) {
    selectedBlockIds = [];
  }

  // Keyboard copy/cut/paste and general window handlers
  onMount(() => {
    function handleKeyDown(e) {
      if (selectedBlockIds.length === 0) return;

      if (e.key === 'Escape') {
        selectedBlockIds = [];
        return;
      }

      if (e.key === 'Backspace' || e.key === 'Delete') {
        if (
          document.activeElement.tagName === 'INPUT' || 
          document.activeElement.tagName === 'TEXTAREA' ||
          document.activeElement.closest('.ProseMirror')
        ) {
          return;
        }
        e.preventDefault();
        deleteMultipleBlocks(selectedBlockIds);
      }
    }

    function isSelectionInChatDrawer() {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const node = selection.anchorNode;
        if (node) {
          const element = node.nodeType === 3 ? node.parentElement : node;
          if (element && element.closest('.chat-drawer')) {
            return true;
          }
        }
      }
      return false;
    }

    function handleCopy(e) {
      if (selectedBlockIds.length === 0) return;
      if (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.closest('.ProseMirror') ||
        isSelectionInChatDrawer()
      ) {
        return;
      }

      e.preventDefault();
      const selectedBlocks = blocks.filter(b => selectedBlockIds.includes(b.id));
      const plainText = selectedBlocks.map(b => {
        const textContent = b.content ? b.content.map(node => node.text || '').join('') : '';
        if (b.type === 'h1') return '# ' + textContent;
        if (b.type === 'h2') return '## ' + textContent;
        if (b.type === 'h3') return '### ' + textContent;
        return textContent;
      }).join('\n');

      const jsonData = JSON.stringify(selectedBlocks);
      e.clipboardData.setData('text/plain', plainText);
      e.clipboardData.setData('application/json', jsonData);
    }

    function handleCut(e) {
      if (selectedBlockIds.length === 0) return;
      if (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.closest('.ProseMirror') ||
        isSelectionInChatDrawer()
      ) {
        return;
      }

      e.preventDefault();
      handleCopy(e);
      deleteMultipleBlocks(selectedBlockIds);
    }

    async function handlePaste(e) {
      if (selectedBlockIds.length === 0) return;
      if (
        document.activeElement.tagName === 'INPUT' || 
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.closest('.ProseMirror')
      ) {
        return;
      }

      e.preventDefault();
      const clipboardData = e.clipboardData || window.clipboardData;
      const jsonData = clipboardData.getData('application/json');
      const textData = clipboardData.getData('text/plain');

      let newBlocks = [];
      try {
        if (jsonData) {
          const parsed = JSON.parse(jsonData);
          if (Array.isArray(parsed) && parsed.every(b => b.type && b.id)) {
            newBlocks = parsed.map(b => ({
              ...b,
              id: 'b_' + Math.random().toString(36).substring(2, 9),
              canvas: null
            }));
          }
        }
      } catch (err) {}

      if (newBlocks.length === 0 && textData) {
        const lines = textData.split(/\r?\n/);
        newBlocks = lines.map(line => {
          let type = 'paragraph';
          let contentText = line;
          if (line.startsWith('# ')) {
            type = 'h1';
            contentText = line.substring(2);
          } else if (line.startsWith('## ')) {
            type = 'h2';
            contentText = line.substring(3);
          } else if (line.startsWith('### ')) {
            type = 'h3';
            contentText = line.substring(4);
          }
          return {
            id: 'b_' + Math.random().toString(36).substring(2, 9),
            type,
            content: contentText ? [{ type: 'text', text: contentText }] : [],
            canvas: null,
            name: null
          };
        });
      }

      if (newBlocks.length > 0) {
        const lastSelectedId = selectedBlockIds[selectedBlockIds.length - 1];
        const targetIdx = blocks.findIndex(b => b.id === lastSelectedId);
        const insertIdx = targetIdx !== -1 ? targetIdx + 1 : blocks.length;

        blocks.splice(insertIdx, 0, ...newBlocks);
        blocks = [...blocks];

        selectedBlockIds = newBlocks.map(b => b.id);
      }
    }

    function handleWindowClick(e) {
      if (e.target.closest('.floating-chat-bubble-container')) {
        return;
      }
      if (selectedBlockIds.length > 0 && scrollContainerEl && !scrollContainerEl.contains(e.target)) {
        selectedBlockIds = [];
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('copy', handleCopy);
    window.addEventListener('cut', handleCut);
    window.addEventListener('paste', handlePaste);
    window.addEventListener('pointerdown', handleWindowClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('copy', handleCopy);
      window.removeEventListener('cut', handleCut);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('pointerdown', handleWindowClick);
    };
  });
</script>

<!-- Top Bar -->
<div class="top-bar">
  <div class="view-label">Notion View</div>
  <div class="action-buttons">
    <button type="button" class="btn btn-outline" onclick={() => undo?.()} disabled={historyPastLength === 0} title="Undo (Cmd+Z)">↶ Undo</button>
    <button type="button" class="btn btn-outline" onclick={() => redo?.()} disabled={historyFutureLength === 0} title="Redo (Cmd+Shift+Z)">↷ Redo</button>
    <div style="width: 1px; height: 16px; background-color: var(--notion-border); margin: 0 4px; align-self: center;"></div>
    {#if hasAnyStagedChanges}
      <button type="button" class="btn btn-accept-all" onclick={acceptAllStagedChanges} title="Accept all proposed changes">
        ✓ Accept All ({Object.keys(stagedChanges).length})
      </button>
      <button type="button" class="btn btn-deny-all" onclick={denyAllStagedChanges} title="Deny all proposed changes">
        ✕ Deny All
      </button>
      <div style="width: 1px; height: 16px; background-color: var(--notion-border); margin: 0 4px; align-self: center;"></div>
    {/if}
    <button type="button" class="btn btn-outline" onclick={triggerImport}>Import JSON</button>
    <button type="button" class="btn btn-outline" onclick={exportJSON}>Export JSON</button>
    <input 
      type="file" 
      accept=".json" 
      style="display: none;" 
      bind:this={fileInput} 
      onchange={handleImportFile}
    />
  </div>
</div>

<!-- Editor scroll container -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div 
  class="notion-editor-scroll" 
  bind:this={scrollContainerEl}
  onpointerdown={handleContainerPointerDown}
>
  <div class="notion-content-wrapper" style="position: relative;" bind:this={contentWrapperEl}>
    <!-- Page Title -->
    <div class="title-container">
      <input 
        type="text" 
        class="page-title-input" 
        bind:value={pageTitle} 
        placeholder="Untitled"
      />
    </div>

    <!-- Drag drop list container (canvas-sourced elements are hidden here) -->
    <div class="blocks-container">
      {#each notionBlocks as block, idx (block.id)}
        {@const realIdx = blocks.findIndex(b => b.id === block.id)}
        <div
          class="block-row-wrapper"
          ondragover={(e) => handleDragOver(idx, e)}
          ondrop={(e) => handleDrop(idx, e)}
          role="listitem"
        >
          <BlockEditor
            bind:block={blocks[realIdx]}
            blocks={blocks}
            index={realIdx}
            isFirst={idx === 0}
            isLast={idx === notionBlocks.length - 1}
            {focusTarget}
            {addBlockAfter}
            {deleteBlock}
            {updateBlock}
            {moveBlock}
            {focusBlock}
            {mergeWithPrevious}
            {duplicateBlock}
            onDragStart={(e) => handleDragStart(idx, e)}
            onDragEnd={handleDragEnd}
            selected={selectedBlockIds.includes(block.id)}
            selectedBlockIds={selectedBlockIds}
            onSelectBlock={handleSelectBlock}
            onEditorFocus={handleEditorFocus}
            deleteSelectedBlocks={deleteMultipleBlocks}
            duplicateSelectedBlocks={duplicateMultipleBlocks}
            onAskAI={onAskAI}
            bind:stagedChanges={stagedChanges}
            {acceptStagedChange}
            {denyStagedChange}
          />
        </div>
      {/each}
    </div>

    <!-- Reorder insertion line -->
    {#if dropIndicatorTop !== null}
      <div 
        class="drop-indicator" 
        style="top: {dropIndicatorTop}px;"
      ></div>
    {/if}

    <!-- Selection Marquee visual box -->
    {#if selectionBox.active}
      <div 
        class="marquee-selection-box"
        style="
          position: fixed;
          left: {selectionBox.left}px;
          top: {selectionBox.top}px;
          width: {selectionBox.width}px;
          height: {selectionBox.height}px;
          border: 1px solid rgba(35, 131, 226, 0.4);
          background-color: rgba(35, 131, 226, 0.08);
          pointer-events: none;
          z-index: 10000;
          border-radius: 2px;
        "
      ></div>
    {/if}
  </div>
</div>

{#if selectedBlockIds.length > 0}
  <div class="floating-chat-bubble-container" contenteditable="false">
    <button
      type="button"
      class="floating-chat-bubble"
      onclick={() => onAskAI?.(selectedBlockIds)}
    >
      💬 Chat with AI ({selectedBlockIds.length} block{selectedBlockIds.length > 1 ? 's' : ''})
    </button>
  </div>
{/if}

<style>
  .floating-chat-bubble-container {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    animation: bubble-fade-up 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes bubble-fade-up {
    from {
      opacity: 0;
      transform: translate(-50%, 12px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
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

  .floating-chat-bubble:hover {
    background: #081d50;
    transform: scale(1.03);
  }
  .top-bar {
    height: 44px;
    border-bottom: 1px solid var(--notion-border);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    background-color: #f9fafb;
    user-select: none;
    flex-shrink: 0;
  }

  .view-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--notion-text-muted);
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .action-buttons {
    display: flex;
    gap: 8px;
  }

  .action-buttons .btn {
    font-size: 12px;
    padding: 3px 8px;
  }

  .notion-editor-scroll {
    flex-grow: 1;
    overflow-y: auto;
    background-color: #ffffff;
    padding: 32px 0 160px 0;
  }

  .notion-content-wrapper {
    max-width: 720px;
    margin: 0 auto;
    padding: 0 48px 0 0;
    width: 100%;
  }

  .title-container {
    padding-left: 48px;
    margin-bottom: 28px;
  }

  .page-title-input {
    font-size: 40px;
    font-weight: 700;
    border: none;
    background: transparent;
    outline: none;
    width: 100%;
    color: var(--notion-text);
    font-family: var(--font-sans);
  }

  .page-title-input::placeholder {
    color: var(--notion-text-placeholder);
  }

  .blocks-container {
    display: flex;
    flex-direction: column;
  }

  .block-row-wrapper {
    position: relative;
    width: 100%;
  }

  .drop-indicator {
    position: absolute;
    left: 48px; /* align with block text start */
    right: 0;
    height: 2px;
    background-color: var(--notion-blue);
    pointer-events: none;
    z-index: 5;
    transition: top 0.05s ease-out;
  }

  .btn-accept-all {
    background-color: #22c55e !important;
    border: 1px solid #16a34a !important;
    color: #ffffff !important;
    font-weight: 600;
  }
  .btn-accept-all:hover {
    background-color: #16a34a !important;
  }
  .btn-deny-all {
    background-color: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    color: #64748b !important;
    font-weight: 600;
  }
  .btn-deny-all:hover {
    background-color: #f1f5f9 !important;
    color: #334155 !important;
  }
</style>
