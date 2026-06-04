<script>
  import NotionPane from './lib/notion/NotionPane.svelte';
  import PolishedPane from './lib/polished/PolishedPane.svelte';

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

  // Reactive states
  let blocks = $state(initialBlocks);
  let pageTitle = $state(initialPageTitle);
  let paneWidth = $state(initialPaneWidth);
  let isDragging = $state(false);

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
</script>

<svelte:window 
  onpointermove={handlePointerMove} 
  onpointerup={stopDragging} 
/>

<div class="split-container">
  <div class="left-pane" style="width: {paneWidth}px;">
    <NotionPane bind:blocks bind:pageTitle />
  </div>

  <button 
    type="button"
    class="divider" 
    class:active={isDragging}
    onpointerdown={startDragging}
    aria-label="Resize layout panes"
    style="border: none; outline: none; padding: 0; display: block;"
  ></button>

  <div class="right-pane">
    <PolishedPane />
  </div>
</div>
