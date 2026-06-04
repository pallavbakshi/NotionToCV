<script>
  import { onMount } from 'svelte';
  import NotionPane from './lib/notion/NotionPane.svelte';
  import PolishedPane from './lib/polished/PolishedPane.svelte';
  import './lib/polished/templates/clean.css';

  // Restore state from localStorage
  let initialBlocks = [{ id: 'b_initial', type: 'paragraph', content: [], canvas: null }];
  try {
    const storedBlocks = localStorage.getItem('notionToCV_blocks');
    if (storedBlocks) {
      initialBlocks = JSON.parse(storedBlocks);
    }
  } catch (e) {
    console.error('Error loading blocks from localStorage', e);
  }

  let initialPageTitle = '';
  try {
    const storedTitle = localStorage.getItem('notionToCV_pageTitle');
    if (storedTitle !== null) {
      initialPageTitle = storedTitle;
    }
  } catch (e) {
    console.error('Error loading page title from localStorage', e);
  }

  let initialPaneWidth = 480;
  try {
    const storedWidth = localStorage.getItem('notionToCV_paneWidth');
    if (storedWidth) {
      initialPaneWidth = parseInt(storedWidth, 10);
    }
  } catch (e) {
    console.error('Error loading pane width from localStorage', e);
  }

  let initialPaddingMm = 15;
  try {
    const storedPadding = localStorage.getItem('notionToCV_paddingMm');
    if (storedPadding) {
      initialPaddingMm = parseFloat(storedPadding);
    }
  } catch (e) {
    console.error('Error loading padding from localStorage', e);
  }

  // Reactive states
  let blocks = $state(initialBlocks);
  let pageTitle = $state(initialPageTitle);
  let paneWidth = $state(initialPaneWidth);
  let isDragging = $state(false);

  let paddingMm = $state(initialPaddingMm);
  let draggedBlockId = $state(null);
  let isExportMode = $state(false);
  let activeTemplate = $state('clean');

  // Sync to localStorage
  $effect(() => {
    localStorage.setItem('notionToCV_blocks', JSON.stringify(blocks));
  });

  $effect(() => {
    localStorage.setItem('notionToCV_pageTitle', pageTitle);
  });

  $effect(() => {
    localStorage.setItem('notionToCV_paneWidth', paneWidth.toString());
  });

  $effect(() => {
    localStorage.setItem('notionToCV_paddingMm', paddingMm.toString());
  });

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    const hasExport = params.has('export');
    const printId = params.get('printId');

    if (hasExport) {
      isExportMode = true;
      document.body.classList.add('export-mode');
    }

    if (printId) {
      try {
        const res = await fetch(`/api/print-data?id=${printId}`);
        if (res.ok) {
          const data = await res.json();
          blocks = data.blocks;
          pageTitle = data.pageTitle;
          paddingMm = data.paddingMm;
        }
      } catch (err) {
        console.error('Failed to load print data:', err);
      }
    }
  });

  function startDragging(e) {
    e.preventDefault();
    isDragging = true;
  }

  function handlePointerMove(e) {
    if (!isDragging) return;
    
    const newWidth = e.clientX;
    const rightPaneMinWidth = 400;
    const maxPaneWidth = window.innerWidth - rightPaneMinWidth;
    
    // Left pane min width 320px
    if (newWidth >= 320 && newWidth <= maxPaneWidth) {
      paneWidth = newWidth;
    }
  }

  function stopDragging() {
    isDragging = false;
  }

  function updateBlockCanvas(id, patch) {
    const idx = blocks.findIndex(b => b.id === id);
    if (idx !== -1) {
      blocks[idx] = { ...blocks[idx], canvas: patch };
    }
  }
</script>

<svelte:window 
  onpointermove={handlePointerMove} 
  onpointerup={stopDragging} 
/>

<div class="split-container" class:export-mode={isExportMode}>
  {#if !isExportMode}
    <div class="left-pane" style="width: {paneWidth}px;">
      <NotionPane bind:blocks bind:pageTitle bind:draggedBlockId={draggedBlockId} />
    </div>

    <button 
      type="button"
      class="divider" 
      class:active={isDragging}
      onpointerdown={startDragging}
      aria-label="Resize layout panes"
      style="border: none; outline: none; padding: 0; display: block;"
    ></button>
  {/if}

  <div class="right-pane" style={isExportMode ? 'width: 100%; max-width: none; flex: 1;' : ''}>
    <PolishedPane
      blocks={blocks}
      bind:paddingMm={paddingMm}
      bind:draggedBlockId={draggedBlockId}
      {updateBlockCanvas}
      {isExportMode}
      {pageTitle}
      templateName={activeTemplate}
    />
  </div>
</div>
