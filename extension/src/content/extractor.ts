import { extractProductData } from './orchestrator.js';

console.log('[AliExpress-Shopify-Importer] Content script active on:', window.location.href);

// Listen for extraction requests from popup or background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'EXTRACT_PRODUCT') {
    extractProductData(document, window.location.href)
      .then((result) => {
        sendResponse(result);
      })
      .catch((err: unknown) => {
        sendResponse({
          success: false,
          error: {
            code: 'UNEXPECTED_EXTRACTION_ERROR',
            message: (err as Error).message || 'An unexpected error occurred during extraction.',
          },
        });
      });

    // Return true to indicate asynchronous response
    return true;
  }

  if (message.action === 'PING') {
    sendResponse({ status: 'PONG', url: window.location.href });
    return true;
  }

  return false;
});
