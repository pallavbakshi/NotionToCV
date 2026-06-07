// Agentic Resume SDK — public entry point.
//
// The SDK is environment-agnostic: it imports no Svelte, no browser globals,
// and no fetch. All host-specific capabilities (LLM transport, screenshots)
// are injected as providers conforming to the interfaces in types.js.

export { ResumeAgentEngine } from './engine.js';

// Re-export browser provider implementations for host convenience.
// Node providers (nodeModelProvider, nodeScreenshotProvider) are intentionally
// NOT re-exported here — doing so would pull @anthropic-ai/sdk and puppeteer
// into the browser bundle. Node hosts import from './providers/node.js' directly.
export { browserModelProvider, browserScreenshotProvider } from './providers/browser.js';

// Re-export tool utilities for hosts that need direct access
export { runAgentTool, runLayoutDesignerTool, AGENT_TOOLS, LAYOUT_DESIGNER_TOOLS, getAgentSystemPrompt, getSystemPromptOutline, getLayoutDesignerPrompt, htmlToInlineNodes, initSdkDomParser } from './tools.js';
