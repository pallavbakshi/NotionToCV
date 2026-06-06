// Agentic Resume SDK — public entry point.
//
// The SDK is environment-agnostic: it imports no Svelte, no browser globals,
// and no fetch. All host-specific capabilities (LLM transport, screenshots)
// are injected as providers conforming to the interfaces in types.js.

export { ResumeAgentEngine } from './engine.js';

// Re-export provider implementations for host convenience
export { browserModelProvider, browserScreenshotProvider } from './providers/browser.js';

// Re-export tool utilities for hosts that need direct access
export { runAgentTool, AGENT_TOOLS, getAgentSystemPrompt, getSystemPromptOutline, htmlToInlineNodes, initSdkDomParser } from './tools.js';
