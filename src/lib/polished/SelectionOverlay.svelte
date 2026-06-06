<!-- SelectionOverlay.svelte — Marquee selection rectangle for the polished view. -->
<script>
  let { marqueeState = null } = $props();
</script>

{#if marqueeState}
  <div
    class="marquee-selection"
    style="
      left: {Math.min(marqueeState.startX, marqueeState.currentX)}px;
      top: {Math.min(marqueeState.startY, marqueeState.currentY)}px;
      width: {Math.abs(marqueeState.startX - marqueeState.currentX)}px;
      height: {Math.abs(marqueeState.startY - marqueeState.currentY)}px;
    "
  ></div>
{/if}

<style>
  .marquee-selection {
    position: fixed;
    border: 1px solid #3b82f6;
    background-color: rgba(59, 130, 246, 0.1);
    pointer-events: none;
    z-index: 9999;
  }
</style>
