import { CONFIG } from '../shared/config.js';

interface ExchangeResponse {
  success: boolean;
  token?: string;
  store_name?: string;
  store_currency?: string;
  shop_domain?: string;
  error?: {
    code: string;
    message: string;
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const msgEl = document.getElementById('msg');

  if (!code) {
    if (msgEl) {
      msgEl.textContent = 'Error: Authorization code is missing from callback URL.';
      msgEl.style.color = '#d72c0d';
    }
    return;
  }

  if (msgEl) {
    msgEl.textContent = 'Exchanging authorization code for secure session...';
  }

  try {
    const response = await fetch(`${CONFIG.BACKEND_URL}/auth/exchange`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });

    const data = (await response.json()) as ExchangeResponse;

    if (!response.ok || !data.success || !data.token) {
      const errMessage = data.error?.message || 'Authentication exchange failed.';
      if (msgEl) {
        msgEl.textContent = `Error: ${errMessage}`;
        msgEl.style.color = '#d72c0d';
      }
      return;
    }

    // Securely store JWT and store metadata in Chrome storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({
        shopify_jwt: data.token,
        shopify_store_name: data.store_name || data.shop_domain,
        shopify_store_currency: data.store_currency || 'USD',
        shopify_shop_domain: data.shop_domain,
      });
    }

    if (msgEl) {
      msgEl.textContent = `Connected to ${data.store_name || data.shop_domain}! You may close this tab.`;
      msgEl.style.color = '#008060';
    }

    // Auto-close tab after 2.5 seconds if opened as popup/tab
    setTimeout(() => {
      window.close();
    }, 2500);
  } catch (err: unknown) {
    if (msgEl) {
      msgEl.textContent = `Network error: ${(err as Error).message}`;
      msgEl.style.color = '#d72c0d';
    }
  }
});
