<!-- ThemeDrawer.svelte — Color/font picker sidebar for the polished view. -->
<script>
  import ColorPicker from 'svelte-awesome-color-picker';

  let {
    isDrawerOpen = $bindable(false),
    themeColors = $bindable()
  } = $props();

  let activePicker = $state(null);
  let originalStyle = null;

  const colorPresets = [
    {
      name: 'Corporate Navy',
      h1Color: '#0a2463',
      h2Color: '#0a2463',
      h3Color: '#1e293b',
      h4Color: '#475569',
      textColor: '#1e1b18',
      backgroundColor: '#ffffff',
      h1Font: 'Inter',
      h2Font: 'Inter',
      h3Font: 'Inter',
      h4Font: 'Inter',
      textFont: 'Inter'
    },
    {
      name: 'Minimalist Gray',
      h1Color: '#1e293b',
      h2Color: '#334155',
      h3Color: '#475569',
      h4Color: '#6b7280',
      textColor: '#1e1b18',
      backgroundColor: '#ffffff',
      h1Font: 'Inter',
      h2Font: 'Inter',
      h3Font: 'Inter',
      h4Font: 'Inter',
      textFont: 'Inter'
    },
    {
      name: 'Warm Charcoal',
      h1Color: '#3e2723',
      h2Color: '#4e342e',
      h3Color: '#5d4037',
      h4Color: '#6d4c41',
      textColor: '#1e1b18',
      backgroundColor: '#ffffff',
      h1Font: 'Lora',
      h2Font: 'Lora',
      h3Font: 'Lora',
      h4Font: 'Inter',
      textFont: 'Inter'
    },
    {
      name: 'Classic Elegant',
      h1Color: '#0f172a',
      h2Color: '#1e293b',
      h3Color: '#334155',
      h4Color: '#4b5563',
      textColor: '#374151',
      backgroundColor: '#f8fafc',
      h1Font: 'Playfair Display',
      h2Font: 'Playfair Display',
      h3Font: 'Playfair Display',
      h4Font: 'Lora',
      textFont: 'Lora'
    },
    {
      name: 'Classic Ink',
      h1Color: '#1b1b1b',
      h2Color: '#1b1b1b',
      h3Color: '#3f3f3f',
      h4Color: '#5a5a5a',
      textColor: '#3f3f3f',
      backgroundColor: '#ffffff',
      h1Font: 'Inter',
      h2Font: 'Inter',
      h3Font: 'Inter',
      h4Font: 'Inter',
      textFont: 'Inter'
    }
  ];

  export function openStyleDrawer() {
    originalStyle = JSON.parse(JSON.stringify(themeColors));
    isDrawerOpen = true;
    activePicker = null;
  }

  function saveStyle() {
    originalStyle = null;
    isDrawerOpen = false;
  }

  function discardStyle() {
    if (originalStyle) Object.assign(themeColors, originalStyle);
    originalStyle = null;
    isDrawerOpen = false;
  }
</script>

{#if isDrawerOpen}
  <div class="theme-drawer" onclick={(e) => e.stopPropagation()}>
    <div class="drawer-header">
      <h3>🎨 Style Settings</h3>
      <button type="button" class="btn-close-drawer" onclick={discardStyle}>✕</button>
    </div>

    <div class="drawer-content">
      <div class="drawer-section">
        <h4>Presets</h4>
        <div class="presets-grid">
          {#each colorPresets as preset}
            <button
              type="button"
              class="preset-card"
              onclick={() => {
                themeColors.h1Color = preset.h1Color;
                themeColors.h2Color = preset.h2Color;
                themeColors.h3Color = preset.h3Color;
                themeColors.h4Color = preset.h4Color;
                themeColors.textColor = preset.textColor;
                themeColors.backgroundColor = preset.backgroundColor;
                themeColors.h1Font = preset.h1Font;
                themeColors.h2Font = preset.h2Font;
                themeColors.h3Font = preset.h3Font;
                themeColors.h4Font = preset.h4Font;
                themeColors.textFont = preset.textFont;
              }}
            >
              <span class="preset-name">{preset.name}</span>
              <div class="preset-swatches">
                <span class="swatch" style="background-color: {preset.h1Color}; border: 1px solid rgba(0,0,0,0.1);" title="H1 Title"></span>
                <span class="swatch" style="background-color: {preset.h2Color}; border: 1px solid rgba(0,0,0,0.1);" title="H2 Header"></span>
                <span class="swatch" style="background-color: {preset.h3Color}; border: 1px solid rgba(0,0,0,0.1);" title="H3 Role"></span>
                <span class="swatch" style="background-color: {preset.h4Color}; border: 1px solid rgba(0,0,0,0.1);" title="H4 Subtitle"></span>
                <span class="swatch" style="background-color: {preset.textColor}; border: 1px solid rgba(0,0,0,0.1);" title="Text"></span>
                <span class="swatch" style="background-color: {preset.backgroundColor}; border: 1px solid rgba(0,0,0,0.1);" title="Background"></span>
              </div>
            </button>
          {/each}
        </div>
      </div>

      <div class="drawer-section">
        <h4>Custom Colors</h4>

        <!-- H1 Title -->
        <div class="picker-group">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="picker-summary" onclick={() => activePicker = (activePicker === 'h1' ? null : 'h1')}>
            <span>Name / H1 Title</span>
            <div class="swatch-preview-wrapper">
              <span class="swatch-preview" style="background-color: {themeColors.h1Color}"></span>
              <span class="swatch-hex">{themeColors.h1Color}</span>
            </div>
          </div>
          {#if activePicker === 'h1'}
            <div class="inline-picker-container">
              <div class="inline-color-wrapper">
                <ColorPicker bind:hex={themeColors.h1Color} isAlpha={false} isDialog={false} />
              </div>
            </div>
          {/if}
        </div>

        <!-- H2 Headers -->
        <div class="picker-group">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="picker-summary" onclick={() => activePicker = (activePicker === 'h2' ? null : 'h2')}>
            <span>Section Header / H2</span>
            <div class="swatch-preview-wrapper">
              <span class="swatch-preview" style="background-color: {themeColors.h2Color}"></span>
              <span class="swatch-hex">{themeColors.h2Color}</span>
            </div>
          </div>
          {#if activePicker === 'h2'}
            <div class="inline-picker-container">
              <div class="inline-color-wrapper">
                <ColorPicker bind:hex={themeColors.h2Color} isAlpha={false} isDialog={false} />
              </div>
            </div>
          {/if}
        </div>

        <!-- H3 Sub-headers -->
        <div class="picker-group">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="picker-summary" onclick={() => activePicker = (activePicker === 'h3' ? null : 'h3')}>
            <span>Role Title / H3</span>
            <div class="swatch-preview-wrapper">
              <span class="swatch-preview" style="background-color: {themeColors.h3Color}"></span>
              <span class="swatch-hex">{themeColors.h3Color}</span>
            </div>
          </div>
          {#if activePicker === 'h3'}
            <div class="inline-picker-container">
              <div class="inline-color-wrapper">
                <ColorPicker bind:hex={themeColors.h3Color} isAlpha={false} isDialog={false} />
              </div>
            </div>
          {/if}
        </div>

        <!-- H4 Subtitles -->
        <div class="picker-group">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="picker-summary" onclick={() => activePicker = (activePicker === 'h4' ? null : 'h4')}>
            <span>Subtitle / H4</span>
            <div class="swatch-preview-wrapper">
              <span class="swatch-preview" style="background-color: {themeColors.h4Color}"></span>
              <span class="swatch-hex">{themeColors.h4Color}</span>
            </div>
          </div>
          {#if activePicker === 'h4'}
            <div class="inline-picker-container">
              <div class="inline-color-wrapper">
                <ColorPicker bind:hex={themeColors.h4Color} isAlpha={false} isDialog={false} />
              </div>
            </div>
          {/if}
        </div>

        <!-- Body Text -->
        <div class="picker-group">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="picker-summary" onclick={() => activePicker = (activePicker === 'text' ? null : 'text')}>
            <span>Body Text</span>
            <div class="swatch-preview-wrapper">
              <span class="swatch-preview" style="background-color: {themeColors.textColor}"></span>
              <span class="swatch-hex">{themeColors.textColor}</span>
            </div>
          </div>
          {#if activePicker === 'text'}
            <div class="inline-picker-container">
              <div class="inline-color-wrapper">
                <ColorPicker bind:hex={themeColors.textColor} isAlpha={false} isDialog={false} />
              </div>
            </div>
          {/if}
        </div>

        <!-- Background -->
        <div class="picker-group">
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="picker-summary" onclick={() => activePicker = (activePicker === 'bg' ? null : 'bg')}>
            <span>Paper Background</span>
            <div class="swatch-preview-wrapper">
              <span class="swatch-preview" style="background-color: {themeColors.backgroundColor}"></span>
              <span class="swatch-hex">{themeColors.backgroundColor}</span>
            </div>
          </div>
          {#if activePicker === 'bg'}
            <div class="inline-picker-container">
              <div class="inline-color-wrapper">
                <ColorPicker bind:hex={themeColors.backgroundColor} isAlpha={false} isDialog={false} />
              </div>
            </div>
          {/if}
        </div>
      </div>

      <div class="drawer-section">
        <h4>Custom Fonts</h4>

        {#each [
          { key: 'h1Font', label: 'Name / H1 Title' },
          { key: 'h2Font', label: 'Section Header / H2' },
          { key: 'h3Font', label: 'Role Title / H3' },
          { key: 'h4Font', label: 'Subtitle / H4' },
          { key: 'textFont', label: 'Body Text' }
        ] as font}
          <div class="font-group">
            <span class="font-label">{font.label}</span>
            <select bind:value={themeColors[font.key]} class="font-select-input">
              <option value="Inter">Inter</option>
              <option value="Lora">Lora</option>
              <option value="Playfair Display">Playfair Display</option>
              <option value="Space Grotesk">Space Grotesk</option>
              <option value="Fira Code">Fira Code</option>
              <option value="Outfit">Outfit</option>
            </select>
          </div>
        {/each}
      </div>
    </div>

    <div class="drawer-actions">
      <button type="button" class="btn-save-style" onclick={saveStyle}>Save & Apply</button>
      <button type="button" class="btn-discard-style" onclick={discardStyle}>Discard</button>
    </div>
  </div>
{/if}

<style>
  .theme-drawer {
    position: absolute;
    top: 44px;
    right: 0;
    bottom: 0;
    width: 280px;
    background: rgba(255, 255, 255, 0.85);
    backdrop-filter: blur(16px) saturate(180%);
    -webkit-backdrop-filter: blur(16px) saturate(180%);
    border-left: 1px solid rgba(55, 53, 47, 0.12);
    box-shadow: -4px 0 24px rgba(10, 36, 99, 0.08);
    display: flex;
    flex-direction: column;
    padding: 20px;
    z-index: 500;
    font-family: var(--font-sans, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif);
    animation: slide-in 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    box-sizing: border-box;
  }

  @keyframes slide-in {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }

  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(55, 53, 47, 0.08);
    padding-bottom: 10px;
    flex-shrink: 0;
  }

  .drawer-header h3 {
    font-size: 15px;
    font-weight: 700;
    color: #0a2463;
    margin: 0;
  }

  .btn-close-drawer {
    background: transparent;
    border: none;
    font-size: 14px;
    color: #878682;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: background-color 0.15s;
  }

  .btn-close-drawer:hover {
    background-color: rgba(55, 53, 47, 0.06);
    color: #1e1b18;
  }

  .drawer-content {
    flex-grow: 1;
    overflow-y: auto;
    margin-bottom: 16px;
    padding-right: 4px;
    box-sizing: border-box;
  }

  .drawer-content::-webkit-scrollbar { width: 4px; }
  .drawer-content::-webkit-scrollbar-track { background: transparent; }
  .drawer-content::-webkit-scrollbar-thumb { background: rgba(55, 53, 47, 0.15); border-radius: 2px; }
  .drawer-content::-webkit-scrollbar-thumb:hover { background: rgba(55, 53, 47, 0.3); }

  .drawer-section { margin-bottom: 24px; }

  .drawer-section h4 {
    font-size: 11px;
    font-weight: 600;
    color: #878682;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    margin: 0 0 12px;
  }

  .presets-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

  .preset-card {
    background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12);
    border-radius: 6px;
    padding: 8px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s, box-shadow 0.15s;
    box-sizing: border-box;
  }

  .preset-card:hover { border-color: #2383e2; box-shadow: 0 2px 8px rgba(10, 36, 99, 0.06); }

  .preset-name { font-size: 11px; font-weight: 600; color: #1e1b18; }

  .preset-swatches { display: flex; gap: 4px; }

  .swatch { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }

  .picker-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }

  .picker-summary {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 10px; background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12); border-radius: 6px;
    cursor: pointer; transition: border-color 0.15s, background-color 0.15s;
    user-select: none; box-sizing: border-box;
  }

  .picker-summary:hover { border-color: #2383e2; background-color: rgba(35, 131, 226, 0.02); }

  .picker-summary span { font-size: 12px; font-weight: 500; color: #4b5563; cursor: pointer; }

  .swatch-preview-wrapper { display: flex; align-items: center; gap: 8px; }

  .swatch-preview { width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.15); display: inline-block; }

  .swatch-hex { font-family: monospace; font-size: 11px; color: #6b7280; }

  .inline-picker-container {
    margin-top: 6px; padding: 10px; background: #ffffff;
    border: 1px solid rgba(55, 53, 47, 0.12); border-radius: 6px;
    display: flex; justify-content: center;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.04); box-sizing: border-box;
  }

  .inline-color-wrapper { display: flex; justify-content: center; width: 100%; }

  .font-group { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }

  .font-label { font-size: 11px; font-weight: 600; color: #4b5563; }

  .font-select-input {
    width: 100%; padding: 6px 8px; font-size: 12px; color: #1e1b18;
    background-color: #ffffff; border: 1px solid rgba(55, 53, 47, 0.16);
    border-radius: 5px; outline: none; cursor: pointer; box-sizing: border-box;
    font-family: var(--font-sans);
  }

  .font-select-input:hover { border-color: #2383e2; }
  .font-select-input:focus { border-color: #2383e2; box-shadow: 0 0 0 2px rgba(35, 131, 226, 0.15); }

  .inline-picker-container :global(.kl-color-picker) {
    margin: 0 auto; max-width: 100%; box-shadow: none !important;
    border: none !important; background: transparent !important;
  }

  .drawer-actions {
    margin-top: auto; display: flex; gap: 10px;
    border-top: 1px solid rgba(55, 53, 47, 0.08); padding-top: 16px; flex-shrink: 0;
  }

  .btn-save-style {
    flex: 1; background-color: #2383e2; color: #ffffff; border: none;
    border-radius: 6px; padding: 8px 12px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: background-color 0.15s; text-align: center;
  }

  .btn-save-style:hover { background-color: #1a6fc2; }

  .btn-discard-style {
    background-color: transparent; color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px;
    padding: 8px 12px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.15s; text-align: center;
  }

  .btn-discard-style:hover { background-color: rgba(239, 68, 68, 0.05); border-color: #ef4444; }
</style>
