/**
 * AliExpress Product Page Content Script Entry Point (M1 Scaffold)
 * Full extraction logic will be implemented in Milestone M3.
 */

// Diagnostic message to confirm content script injection on AliExpress pages
console.log('[AliExpress-Shopify-Importer] Content script initialized on:', window.location.href);

// Minimal listener to acknowledge ping from service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'PING') {
    sendResponse({ status: 'PONG', url: window.location.href });
    return true;
  }
  return false;
});
