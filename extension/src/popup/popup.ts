import { CONFIG } from '../shared/config.js';

interface StatusResponse {
  connected: boolean;
  shop_domain?: string;
  store_name?: string;
  store_currency?: string;
  error?: {
    code: string;
    message: string;
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  const stateDisconnected = document.getElementById('state-disconnected');
  const stateConnected = document.getElementById('state-connected');
  const storeBadge = document.getElementById('store-badge');
  const badgeText = document.getElementById('badge-text');

  const connectBtn = document.getElementById('btn-connect') as HTMLButtonElement | null;
  const disconnectBtn = document.getElementById('btn-disconnect') as HTMLButtonElement | null;
  const domainInput = document.getElementById('shop-domain-input') as HTMLInputElement | null;

  const infoShopDomain = document.getElementById('info-shop-domain');
  const infoStoreCurrency = document.getElementById('info-store-currency');
  const connectedStoreInfo = document.getElementById('connected-store-info');

  const statusBanner = document.getElementById('status-banner');
  const statusText = document.getElementById('status-text');

  function showStatus(message: string, isError = false): void {
    if (!statusBanner || !statusText) return;
    statusText.textContent = message;
    statusBanner.classList.remove('hidden');
    if (isError) {
      statusBanner.style.backgroundColor = '#fed3d1';
      statusBanner.style.color = '#d72c0d';
      statusBanner.style.borderColor = '#fac0be';
    } else {
      statusBanner.style.backgroundColor = '#e4f8f0';
      statusBanner.style.color = '#008060';
      statusBanner.style.borderColor = '#b7ecd7';
    }
  }

  function hideStatus(): void {
    if (statusBanner) statusBanner.classList.add('hidden');
  }

  function renderConnected(shopDomain: string, storeName: string, currency: string): void {
    hideStatus();
    if (stateDisconnected) stateDisconnected.classList.add('hidden');
    if (stateConnected) stateConnected.classList.remove('hidden');

    if (storeBadge) {
      storeBadge.classList.remove('store-badge--disconnected');
      storeBadge.classList.add('store-badge--connected');
    }
    if (badgeText) {
      badgeText.textContent = `${storeName} (${currency})`;
    }
    if (connectedStoreInfo) {
      connectedStoreInfo.textContent = `Connected to ${storeName}`;
    }
    if (infoShopDomain) {
      infoShopDomain.textContent = shopDomain;
    }
    if (infoStoreCurrency) {
      infoStoreCurrency.textContent = currency;
    }
  }

  function renderDisconnected(): void {
    if (stateConnected) stateConnected.classList.add('hidden');
    if (stateDisconnected) stateDisconnected.classList.remove('hidden');

    if (storeBadge) {
      storeBadge.classList.remove('store-badge--connected');
      storeBadge.classList.add('store-badge--disconnected');
    }
    if (badgeText) {
      badgeText.textContent = 'Not Connected';
    }
  }

  // 1. Check local session storage on popup open
  async function checkSession(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      return;
    }

    const { shopify_jwt } = await chrome.storage.local.get(['shopify_jwt']);

    if (!shopify_jwt) {
      renderDisconnected();
      return;
    }

    try {
      const res = await fetch(`${CONFIG.BACKEND_URL}/api/status`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${shopify_jwt}`,
        },
      });

      if (res.status === 401) {
        // Session expired or revoked
        await chrome.storage.local.remove([
          'shopify_jwt',
          'shopify_store_name',
          'shopify_store_currency',
          'shopify_shop_domain',
        ]);
        renderDisconnected();
        showStatus('Your previous session expired. Please reconnect.', true);
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as StatusResponse;
        if (data.connected && data.shop_domain) {
          renderConnected(
            data.shop_domain,
            data.store_name || data.shop_domain,
            data.store_currency || 'USD'
          );
        }
      } else {
        renderDisconnected();
      }
    } catch {
      // Offline or backend unreachable
      showStatus('Unable to reach backend server. Ensure backend is running.', true);
    }
  }

  await checkSession();

  // 2. Connect Button Handler
  if (connectBtn && domainInput) {
    connectBtn.addEventListener('click', () => {
      const raw = domainInput.value.trim().toLowerCase();
      if (!raw) {
        showStatus('Please enter your Shopify store domain.', true);
        return;
      }

      const domain = raw.endsWith('.myshopify.com') ? raw : `${raw}.myshopify.com`;

      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/;
      if (!domainRegex.test(domain)) {
        showStatus('Invalid store domain format. Example: my-store.myshopify.com', true);
        return;
      }

      hideStatus();
      const authUrl = `${CONFIG.BACKEND_URL}/auth/shopify?shop=${encodeURIComponent(domain)}`;

      if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
        chrome.tabs.create({ url: authUrl });
      } else {
        window.open(authUrl, '_blank');
      }
    });
  }

  // 3. Disconnect Button Handler
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        return;
      }

      const { shopify_jwt } = await chrome.storage.local.get(['shopify_jwt']);

      if (shopify_jwt) {
        try {
          await fetch(`${CONFIG.BACKEND_URL}/api/disconnect`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${shopify_jwt}`,
            },
          });
        } catch {
          // Ignore network errors during disconnect
        }
      }

      await chrome.storage.local.remove([
        'shopify_jwt',
        'shopify_store_name',
        'shopify_store_currency',
        'shopify_shop_domain',
      ]);

      renderDisconnected();
      showStatus('Store disconnected successfully.', false);
    });
  }
});
