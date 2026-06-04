<script>
  import { onMount } from 'svelte';
  import NotionPane from './lib/notion/NotionPane.svelte';
  import PolishedPane from './lib/polished/PolishedPane.svelte';
  import TemplateGallery from './lib/polished/TemplateGallery.svelte';
  import './lib/polished/templates/clean.css';
  import './lib/polished/templates/modern.css';
  import './lib/polished/templates/elegant.css';
  import './lib/polished/templates/compact.css';

  // Restore state from localStorage
  let initialBlocks = [{ id: 'b_initial', type: 'paragraph', content: [], canvas: null, name: null }];
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

  let initialTemplate = null;
  try {
    const storedTemplate = localStorage.getItem('notionToCV_template');
    if (storedTemplate) {
      initialTemplate = storedTemplate;
    }
  } catch (e) {
    console.error('Error loading template from localStorage', e);
  }

  // Reactive states
  let blocks = $state(initialBlocks);
  let pageTitle = $state(initialPageTitle);
  let paneWidth = $state(initialPaneWidth);
  let isDragging = $state(false);

  let paddingMm = $state(initialPaddingMm);
  let draggedBlockId = $state(null);
  let isExportMode = $state(false);
  let activeTemplate = $state(initialTemplate);

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

  $effect(() => {
    if (activeTemplate) {
      localStorage.setItem('notionToCV_template', activeTemplate);
    }
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
          if (data && Array.isArray(data.blocks)) {
            blocks = data.blocks;
            pageTitle = data.pageTitle ?? '';
            paddingMm = data.paddingMm ?? 15;
            if (data.templateName) activeTemplate = data.templateName;
          }
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

  function updateBlockName(id, name) {
    const idx = blocks.findIndex(b => b.id === id);
    if (idx !== -1) {
      blocks[idx] = { ...blocks[idx], name };
    }
  }

  function handleTemplateSelect(templateId) {
    activeTemplate = templateId;
  }

  function handleChangeTemplate() {
    activeTemplate = null;
  }
</script>

<svelte:window
  onpointermove={handlePointerMove}
  onpointerup={stopDragging}
/>

{#if !activeTemplate && !isExportMode}
  <TemplateGallery onSelect={handleTemplateSelect} />
{:else}
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
        {updateBlockName}
        {isExportMode}
        {pageTitle}
        templateName={activeTemplate ?? 'clean'}
        onChangeTemplate={handleChangeTemplate}
      />
    </div>
  </div>
{/if}
