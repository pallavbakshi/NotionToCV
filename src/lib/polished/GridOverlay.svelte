<!-- GridOverlay.svelte -->
<script>
  import { ROW_MM } from '../layout/index.js';
  let { paddingMm = 15, isVisible = false } = $props();

  let colWidth = $derived((210 - 2 * paddingMm - 12) / 4);
</script>

{#if isVisible}
  <div 
    class="grid-overlay" 
    style="
      left: {paddingMm}mm; 
      right: {paddingMm}mm; 
      top: {paddingMm}mm; 
      bottom: {paddingMm}mm;
      --row-mm: {ROW_MM}mm;
    "
  >
    {#each Array(4) as _, i}
      <div 
        class="grid-col" 
        style="
          left: {i * (colWidth + 4)}mm; 
          width: {colWidth}mm;
        "
      ></div>
    {/each}
  </div>
{/if}

<style>
  .grid-overlay {
    position: absolute;
    display: block !important;
    box-sizing: border-box;
    border: 1px solid #efefef;
    pointer-events: none;
    z-index: 2;
    /* Clean light gray horizontal lines using regular linear-gradient + background-size repeat */
    background-image: linear-gradient(
      to bottom,
      transparent,
      transparent calc(var(--row-mm) - 1px),
      #efefef calc(var(--row-mm) - 1px),
      #efefef var(--row-mm)
    );
    background-size: 100% var(--row-mm);
  }

  .grid-col {
    position: absolute;
    top: 0;
    bottom: 0;
    border-left: 1px solid #efefef;
    border-right: 1px solid #efefef;
    background-color: transparent;
    box-sizing: border-box;
  }

  @media print {
    .grid-overlay {
      display: none !important;
    }
  }
</style>
