<!-- Dashboard.svelte -->
<script>
  let { resumes = [], onEdit, onDelete, onCreateNew } = $props();

  function formatDate(isoString) {
    if (!isoString) return 'Never';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (e) {
      return 'Unknown';
    }
  }

  function getTemplateLabel(id) {
    if (!id) return 'Clean';
    if (id.startsWith('custom-')) return 'Custom AI Template';
    return id.charAt(0).toUpperCase() + id.slice(1);
  }

  function handleDelete(id, title, event) {
    event.stopPropagation();
    const confirmed = confirm(`Are you sure you want to delete "${title || 'Untitled CV'}"?`);
    if (confirmed) {
      onDelete?.(id);
    }
  }
</script>

<div class="dashboard-backdrop">
  <div class="dashboard-container">
    
    <!-- Header -->
    <header class="dashboard-header">
      <div class="header-left">
        <span class="app-logo">🏛️</span>
        <h1 class="dashboard-title">NotionToCV</h1>
      </div>
      <button type="button" class="btn-create-new" onclick={onCreateNew}>
        <span class="plus-icon">+</span> Create New CV
      </button>
    </header>

    <!-- Main List -->
    {#if resumes.length === 0}
      <!-- Empty State -->
      <div class="empty-state">
        <div class="empty-icon">📜</div>
        <h2 class="empty-title">No Resumes Found</h2>
        <p class="empty-subtitle">Begin your new document using a premium template or transcribe an existing PDF.</p>
        <button type="button" class="btn-create-new large" onclick={onCreateNew}>
          Create Your First CV
        </button>
      </div>
    {:else}
      <!-- Grid -->
      <div class="cv-grid">
        {#each resumes as cv (cv.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="cv-card" onclick={() => onEdit?.(cv.id)}>
            <div class="card-body">
              <h3 class="cv-title">{cv.pageTitle.trim() || 'Untitled CV'}</h3>
              <div class="cv-meta">
                <span class="meta-item">
                  <span class="meta-icon">🎨</span>
                  {getTemplateLabel(cv.templateName)}
                </span>
                <span class="meta-item">
                  <span class="meta-icon">🧩</span>
                  {cv.blocks ? cv.blocks.length : 0} blocks
                </span>
              </div>
              <p class="cv-date">Updated: {formatDate(cv.updatedAt)}</p>
            </div>
            
            <div class="card-actions">
              <button type="button" class="btn-action edit" onclick={() => onEdit?.(cv.id)}>
                Edit CV
              </button>
              <button type="button" class="btn-action delete" onclick={(e) => handleDelete(cv.id, cv.pageTitle, e)}>
                Delete
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}

  </div>
</div>

<style>
  .dashboard-backdrop {
    min-height: 100vh;
    background-color: var(--surface-2);
    background-image: radial-gradient(circle at 100% 100%, rgba(62, 146, 204, 0.05) 0%, transparent 40%),
                      radial-gradient(circle at 0% 0%, rgba(10, 36, 99, 0.03) 0%, transparent 30%);
    display: flex;
    justify-content: center;
    padding: 60px 24px 100px;
    font-family: var(--font-serif);
    color: var(--color-carbon-black);
    box-sizing: border-box;
  }

  .dashboard-container {
    width: 100%;
    max-width: 960px;
    display: flex;
    flex-direction: column;
    gap: 40px;
  }

  /* Header styles */
  .dashboard-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid var(--outline-subtle);
    padding-bottom: 24px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .app-logo {
    font-size: 28px;
    color: var(--color-imperial-blue);
  }

  .dashboard-title {
    font-family: var(--font-serif);
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -0.02em;
    color: var(--color-imperial-blue);
    margin: 0;
  }

  .btn-create-new {
    background-color: var(--color-magenta-bloom);
    color: #ffffff;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 10px 20px;
    border-radius: var(--radius-default);
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: background-color 0.15s, transform 0.1s, box-shadow 0.15s;
    box-shadow: 0 2px 8px rgba(216, 49, 91, 0.2);
  }

  .btn-create-new:hover {
    background-color: #be284e;
    transform: translateY(-1px);
    box-shadow: var(--shadow-ambient);
  }

  .btn-create-new:active {
    transform: translateY(1px);
  }

  .btn-create-new.large {
    font-size: 14px;
    padding: 12px 28px;
    margin-top: 10px;
  }

  .plus-icon {
    font-size: 16px;
    line-height: 1;
  }

  /* Empty State */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 80px 40px;
    background: var(--color-ghost-white);
    border: 1px solid var(--outline-subtle);
    border-radius: var(--radius-lg);
    gap: 16px;
    box-shadow: 0 2px 8px rgba(10, 36, 99, 0.02);
  }

  .empty-icon {
    font-size: 48px;
    margin-bottom: 8px;
    opacity: 0.85;
  }

  .empty-title {
    font-family: var(--font-serif);
    font-size: 22px;
    font-weight: 700;
    color: var(--color-imperial-blue);
    margin: 0;
  }

  .empty-subtitle {
    font-family: var(--font-sans);
    font-size: 14px;
    color: var(--notion-text-muted);
    max-width: 340px;
    margin: 0 0 8px;
    line-height: 1.5;
  }

  /* CV Cards Grid */
  .cv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 24px;
  }

  .cv-card {
    background: var(--color-ghost-white);
    border: 1px solid var(--outline-subtle);
    border-radius: var(--radius-lg);
    padding: 24px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 180px;
    gap: 20px;
    position: relative;
    overflow: hidden;
    transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
  }

  /* Sliding Imperial Blue left-border accent line */
  .cv-card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    width: 3px;
    background-color: var(--color-imperial-blue);
    transform: scaleY(0);
    transition: transform 0.2s ease;
  }

  .cv-card:hover {
    border-color: rgba(62, 146, 204, 0.4);
    transform: translateY(-3px);
    box-shadow: var(--shadow-ambient);
  }

  .cv-card:hover::before {
    transform: scaleY(1);
  }

  .cv-title {
    font-family: var(--font-serif);
    font-size: 18px;
    font-weight: 700;
    color: var(--color-imperial-blue);
    margin: 0 0 12px;
    line-height: 1.35;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cv-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: var(--notion-text-muted);
    font-family: var(--font-sans);
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .meta-icon {
    font-size: 13px;
  }

  .cv-date {
    font-family: var(--font-sans);
    font-size: 11px;
    color: var(--notion-text-muted);
    opacity: 0.8;
    margin: 0;
  }

  .card-actions {
    display: flex;
    gap: 12px;
    border-top: 1px solid var(--outline-subtle);
    padding-top: 16px;
  }

  .btn-action {
    flex: 1;
    border: none;
    font-family: var(--font-sans);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 8px 0;
    border-radius: var(--radius-default);
    cursor: pointer;
    transition: background-color 0.15s, color 0.15s;
    text-align: center;
  }

  .btn-action.edit {
    background-color: transparent;
    border: 1px solid var(--color-imperial-blue);
    color: var(--color-imperial-blue);
  }

  .btn-action.edit:hover {
    background-color: rgba(10, 36, 99, 0.05);
  }

  .btn-action.delete {
    background-color: rgba(186, 26, 26, 0.03);
    border: 1px solid rgba(186, 26, 26, 0.15);
    color: var(--error);
  }

  .btn-action.delete:hover {
    background-color: rgba(186, 26, 26, 0.08);
    color: #93000a;
  }
</style>
