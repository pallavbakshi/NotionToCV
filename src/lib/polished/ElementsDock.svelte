<!-- ElementsDock.svelte -->
<script>
  let {
    addCanvasElement,
    removeCanvasElement,
    draggedBlockId = $bindable(),
    blocks
  } = $props();

  let pendingElementId = $state(null);

  const elements = [
    {
      type: 'horizontal_divider',
      label: 'H. Divider',
      icon: '━━',
      description: 'Full-width line'
    },
    {
      type: 'vertical_divider',
      label: 'V. Divider',
      icon: '┃',
      description: 'Gutter line'
    },
    {
      type: 'headshot',
      label: 'Headshot',
      icon: '🧑',
      description: 'Image placeholder'
    }
  ];

  function getPlacedCount(type) {
    return blocks.filter(b => b.source === 'canvas' && b.elementType === type && b.canvas !== null).length;
  }

  function handleDragStart(elementDef, e) {
    const newId = addCanvasElement(elementDef.type);
    pendingElementId = newId;
    draggedBlockId = newId;

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', newId);

    // Custom drag image
    const ghost = e.currentTarget.cloneNode(true);
    ghost.style.cssText = 'position:absolute;top:-9999px;opacity:0.85;transform:scale(0.9);';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 40, 20);
    requestAnimationFrame(() => ghost.remove());
  }

  function handleDragEnd() {
    if (pendingElementId) {
      const block = blocks.find(b => b.id === pendingElementId);
      if (block && block.canvas === null) {
        removeCanvasElement(pendingElementId);
      }
    }
    pendingElementId = null;
    draggedBlockId = null;
  }
</script>

<div class="elements-dock">
  <div class="dock-header">
    <span class="dock-label">Elements</span>
    <span class="dock-hint">Drag onto canvas</span>
  </div>
  <div class="dock-items">
    {#each elements as el}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="dock-card"
        draggable="true"
        role="button"
        tabindex="0"
        ondragstart={(e) => handleDragStart(el, e)}
        ondragend={handleDragEnd}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); }}
        title="{el.label} — drag onto canvas"
      >
        <div class="card-icon">{el.icon}</div>
        <div class="card-info">
          <span class="card-label">{el.label}</span>
          <span class="card-desc">{el.description}</span>
        </div>
        {#if getPlacedCount(el.type) > 0}
          <span class="card-badge">{getPlacedCount(el.type)}</span>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .elements-dock {
    flex-shrink: 0;
    background: #f9fafb;
    border-top: 1px solid rgba(55, 53, 47, 0.09);
    padding: 10px 20px 12px;
    z-index: 80;
  }

  .dock-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .dock-label {
    font-size: 10px;
    font-weight: 700;
    color: #878682;
    letter-spacing: 0.8px;
    text-transform: uppercase;
  }

  .dock-hint {
    font-size: 10px;
    color: #94a3b8;
    font-style: italic;
  }

  .dock-items {
    display: flex;
    gap: 10px;
  }

  .dock-card {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.09);
    border-radius: 8px;
    cursor: grab;
    user-select: none;
    transition: border-color 0.2s, box-shadow 0.2s, transform 0.2s;
    position: relative;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  }

  .dock-card:hover {
    border-color: #2383e2;
    box-shadow: 0 4px 12px rgba(35, 131, 226, 0.12), 0 1px 3px rgba(0, 0, 0, 0.04);
    transform: translateY(-2px);
  }

  .dock-card:active {
    cursor: grabbing;
    transform: translateY(0);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  }

  .card-icon {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #f8fafc, #f1f5f9);
    border-radius: 6px;
    font-size: 16px;
    flex-shrink: 0;
    color: #475569;
  }

  .card-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .card-label {
    font-size: 12px;
    font-weight: 600;
    color: #1e293b;
    line-height: 1.2;
    white-space: nowrap;
  }

  .card-desc {
    font-size: 10px;
    color: #94a3b8;
    line-height: 1.2;
    white-space: nowrap;
  }

  .card-badge {
    position: absolute;
    top: -5px;
    right: -5px;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #2383e2;
    color: #ffffff;
    font-size: 10px;
    font-weight: 700;
    border-radius: 50%;
    box-shadow: 0 1px 3px rgba(35, 131, 226, 0.3);
  }

  @media print {
    .elements-dock { display: none !important; }
  }
</style>
