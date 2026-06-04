<!-- BlockRenderer.svelte -->
<script>
  let { content = [] } = $props();

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
</style>
