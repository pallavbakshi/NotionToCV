<!-- BlockRenderer.svelte -->
<script>
  let { content = [], block = null } = $props();

  // Check if this is a canvas-sourced element
  let isCanvasElement = $derived(block?.source === 'canvas');
  let elementType = $derived(block?.elementType);

  function getStyle(node) {
    if (!node.marks) return '';
    let styles = [];
    for (const mark of node.marks) {
      if (mark.type === 'textStyle') {
        if (mark.attrs?.color) {
          styles.push(`color: ${mark.attrs.color}`);
        }
        if (mark.attrs?.fontFamily) {
          if (mark.attrs.fontFamily !== 'Default') {
            styles.push(`font-family: '${mark.attrs.fontFamily}', sans-serif`);
          }
        }
      }
    }
    return styles.join('; ');
  }

  function hasMark(node, type) {
    if (!node.marks) return false;
    return node.marks.some(m => m.type === type);
  }
</script>

{#if isCanvasElement}
  <!-- Canvas Element Rendering -->
  {#if elementType === 'horizontal_divider'}
    <div class="ce-horizontal-divider">
      <div class="divider-line"></div>
    </div>
  {:else if elementType === 'vertical_divider'}
    <div class="ce-vertical-divider">
      <div class="divider-line"></div>
    </div>
  {:else if elementType === 'headshot'}
    <div class="ce-headshot">
      {#if block.imageData}
        <img src={block.imageData} alt="Headshot" class="headshot-image" />
      {:else}
        <div class="headshot-placeholder">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="8" r="4" />
            <path d="M20 21a8 8 0 1 0-16 0" />
          </svg>
          <span class="placeholder-text">Drop image</span>
        </div>
      {/if}
    </div>
  {/if}
{:else}
  <!-- Standard Notion Content Rendering -->
  {#each content as node}
    {#if node.type === 'text'}
      <span 
        style={getStyle(node)}
        class:bold={hasMark(node, 'bold')}
        class:italic={hasMark(node, 'italic')}
        class:underline={hasMark(node, 'underline')}
        class:strike={hasMark(node, 'strike')}
      >{node.text}</span>
    {/if}
  {/each}
{/if}

<style>
  .bold {
    font-weight: 700;
  }
  .italic {
    font-style: italic;
  }
  .underline {
    text-decoration: underline;
  }
  .strike {
    text-decoration: line-through;
  }
  .underline.strike {
    text-decoration: underline line-through;
  }

  /* Canvas Element: Horizontal Divider */
  .ce-horizontal-divider {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 2px;
  }

  .ce-horizontal-divider .divider-line {
    width: 100%;
    height: 0;
    border-top: 1px solid #1e293b;
  }

  /* Canvas Element: Vertical Divider */
  .ce-vertical-divider {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px 0;
  }

  .ce-vertical-divider .divider-line {
    width: 0;
    height: 100%;
    border-left: 1px solid #1e293b;
  }

  /* Canvas Element: Headshot */
  .ce-headshot {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .headshot-image {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .headshot-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, #f8fafc, #f1f5f9);
    border: 1.5px dashed #cbd5e1;
    border-radius: 4px;
    color: #94a3b8;
  }

  .placeholder-text {
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  @media print {
    .headshot-placeholder {
      border-style: solid;
      border-color: #e2e8f0;
    }
  }
</style>
