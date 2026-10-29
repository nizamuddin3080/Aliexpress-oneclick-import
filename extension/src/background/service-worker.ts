/**
 * Background Service Worker (Chrome MV3)
 * Handles message orchestration and authentication state.
 * Full OAuth handoff will be implemented in Milestone M2.
 */

console.log('[AliExpress-Shopify-Importer] Service worker started.');

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'GET_EXTENSION_INFO') {
    sendResponse({
      id: chrome.runtime.id,
      version: chrome.runtime.getManifest().version,
    });
    return true;
  }
  return false;
});
