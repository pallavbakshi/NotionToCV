// Shared Svelte stores for AI staging state.
// Previously these were threaded as $bindable props through PolishedPane (a pure
// tunnel — it never read or wrote them) down to ChatDrawer. Stores eliminate the
// intermediate component coupling.
//
// stagedChanges is also consumed by NotionPane → BlockEditor on the left pane,
// so it's exported separately for them.

import { writable } from 'svelte/store';

export const stagedChanges = writable({});
export const stagedChatBlockIds = writable([]);
export const stagedAttachments = writable([]);
