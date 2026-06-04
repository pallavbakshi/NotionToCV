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
        <span class="app-logo">📄✨</span>
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
        <div class="empty-icon">📂</div>
        <h2 class="empty-title">No CVs yet</h2>
        <p class="empty-subtitle">Create a CV from templates or import a PDF to get started.</p>
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
              <h3 class="cv-title">{cv.pageTitle?.trim() || 'Untitled CV'}</h3>
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
                Edit
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
    background: linear-gradient(135deg, #0f172a 0%, #1e1e38 100%);
    display: flex;
    justify-content: center;
    padding: 60px 24px 100px;
    font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #f8fafc;
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
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    padding-bottom: 24px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .app-logo {
    font-size: 32px;
  }

  .dashboard-title {
    font-size: 28px;
    font-weight: 800;
    letter-spacing: -0.8px;
    background: linear-gradient(to right, #60a5fa, #a78bfa);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    margin: 0;
  }

  .btn-create-new {
    background-color: #2563eb;
    color: #ffffff;
    font-size: 14px;
    font-weight: 600;
    padding: 10px 20px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    transition: background-color 0.15s, transform 0.1s;
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);
  }

  .btn-create-new:hover {
    background-color: #1d4ed8;
    transform: translateY(-1px);
  }

  .btn-create-new:active {
    transform: translateY(1px);
  }

  .btn-create-new.large {
    font-size: 15px;
    padding: 12px 28px;
    margin-top: 10px;
  }

  .plus-icon {
    font-size: 18px;
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
    background: rgba(255, 255, 255, 0.03);
    border: 1.5px dashed rgba(255, 255, 255, 0.12);
    border-radius: 16px;
    backdrop-filter: blur(10px);
    gap: 16px;
  }

  .empty-icon {
    font-size: 64px;
    margin-bottom: 8px;
  }

  .empty-title {
    font-size: 20px;
    font-weight: 700;
    color: #ffffff;
    margin: 0;
  }

  .empty-subtitle {
    font-size: 14px;
    color: #94a3b8;
    max-width: 320px;
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
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 24px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 170px;
    gap: 20px;
    transition: background 0.15s, border-color 0.15s, transform 0.15s, box-shadow 0.15s;
    backdrop-filter: blur(5px);
  }

  .cv-card:hover {
    background: rgba(255, 255, 255, 0.06);
    border-color: rgba(96, 165, 250, 0.35);
    transform: translateY(-3px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  }

  .cv-title {
    font-size: 18px;
    font-weight: 700;
    color: #ffffff;
    margin: 0 0 12px;
    line-height: 1.3;
    /* Truncate text after 2 lines */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .cv-meta {
    display: flex;
    gap: 16px;
    font-size: 13px;
    color: #94a3b8;
  }

  .meta-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .meta-icon {
    font-size: 14px;
  }

  .cv-date {
    font-size: 11px;
    color: #64748b;
    margin: 0;
  }

  .card-actions {
    display: flex;
    gap: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    padding-top: 16px;
  }

  .btn-action {
    flex: 1;
    border: none;
    font-size: 13px;
    font-weight: 600;
    padding: 8px 0;
    border-radius: 6px;
    cursor: pointer;
    transition: background-color 0.15s;
    text-align: center;
  }

  .btn-action.edit {
    background-color: rgba(255, 255, 255, 0.06);
    color: #e2e8f0;
  }

  .btn-action.edit:hover {
    background-color: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .btn-action.delete {
    background-color: rgba(239, 68, 68, 0.1);
    color: #fca5a5;
  }

  .btn-action.delete:hover {
    background-color: rgba(239, 68, 68, 0.2);
    color: #fee2e2;
  }
</style>
