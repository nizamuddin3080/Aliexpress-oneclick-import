/**
 * Main-World Bridge Script Helper
 * Injects a transient script into the page DOM to read main-world window.runParams
 * and posts the result back to the isolated content script world via CustomEvent.
 */

const EVENT_NAME = '__AE_IMPORTER_PAGE_DATA__';

export function requestMainWorldData(timeoutMs = 500): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    // If running in headless test environment without document.head
    if (typeof document === 'undefined' || !document.documentElement) {
      resolve(null);
      return;
    }

    let resolved = false;

    // Timeout guard
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        window.removeEventListener(EVENT_NAME, listener as EventListener);
        resolve(null);
      }
    }, timeoutMs);

    function listener(event: CustomEvent) {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        window.removeEventListener(EVENT_NAME, listener as EventListener);
        resolve(event.detail || null);
      }
    }

    window.addEventListener(EVENT_NAME, listener as EventListener);

    // Injected code executing in main page world
    const scriptCode = `
      (function() {
        try {
          var payload = null;
          if (typeof window.runParams !== 'undefined') {
            payload = window.runParams;
          } else if (typeof window._init_data_ !== 'undefined') {
            payload = window._init_data_;
          }
          window.dispatchEvent(new CustomEvent('${EVENT_NAME}', { detail: payload }));
        } catch (e) {
          window.dispatchEvent(new CustomEvent('${EVENT_NAME}', { detail: null }));
        }
      })();
    `;

    try {
      const script = document.createElement('script');
      script.textContent = scriptCode;
      (document.head || document.documentElement).appendChild(script);
      script.remove();
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
