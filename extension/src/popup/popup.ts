import { CONFIG } from '../shared/config.js';
import { calculatePriceRange } from '../shared/pricing.js';
import { isAllowedAliExpressHost } from '../content/url-parser.js';
import type { ExtractedProduct, ImportApiResponse, StoreStatusResponse } from '../shared/types.js';

export type PopupState =
  | 'disconnected'
  | 'non-aliexpress'
  | 'extracting'
  | 'preview'
  | 'currency-mismatch'
  | 'unsupported-options'
  | 'extraction-error'
  | 'importing'
  | 'success'
  | 'partial-image-success'
  | 'duplicate'
  | 'uncertain-outcome';

interface ExtractionMessageResponse {
  success: boolean;
  product?: ExtractedProduct;
  error?: {
    code: string;
    message: string;
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const stateViews = {
    'disconnected': document.getElementById('state-disconnected'),
    'non-aliexpress': document.getElementById('state-non-aliexpress'),
    'extracting': document.getElementById('state-extracting'),
    'preview': document.getElementById('state-preview'),
    'currency-mismatch': document.getElementById('state-currency-mismatch'),
    'unsupported-options': document.getElementById('state-unsupported-options'),
    'extraction-error': document.getElementById('state-extraction-error'),
    'importing': document.getElementById('state-importing'),
    'success': document.getElementById('state-success'),
    'partial-image-success': document.getElementById('state-partial-image-success'),
    'duplicate': document.getElementById('state-duplicate'),
    'uncertain-outcome': document.getElementById('state-uncertain-outcome'),
  };

  const storeBadge = document.getElementById('store-badge');
  const badgeText = document.getElementById('badge-text');

  // Disconnected view elements
  const connectBtn = document.getElementById('btn-connect') as HTMLButtonElement | null;
  const domainInput = document.getElementById('shop-domain-input') as HTMLInputElement | null;
  const disconnectNonAeBtn = document.getElementById('btn-disconnect-non-ae') as HTMLButtonElement | null;

  // Preview view elements
  const previewThumb = document.getElementById('preview-thumbnail') as HTMLImageElement | null;
  const previewTitle = document.getElementById('preview-title');
  const previewVariantsBadge = document.getElementById('preview-variants-badge');
  const previewImagesBadge = document.getElementById('preview-images-badge');
  const previewSourcePrice = document.getElementById('preview-source-price');
  const previewShippingInput = document.getElementById('preview-shipping-input') as HTMLInputElement | null;
  const previewShippingCurrency = document.getElementById('preview-shipping-currency');
  const previewTotalCost = document.getElementById('preview-total-cost');
  const previewMarkupInput = document.getElementById('preview-markup-input') as HTMLInputElement | null;
  const previewSellingPrice = document.getElementById('preview-selling-price');
  const importBtn = document.getElementById('btn-import') as HTMLButtonElement | null;

  // Error & Mismatch elements
  const mismatchSourceCur = document.getElementById('mismatch-source-cur');
  const mismatchStoreCur = document.getElementById('mismatch-store-cur');
  const mismatchTargetCur = document.getElementById('mismatch-target-cur');
  const mismatchRetryBtn = document.getElementById('btn-mismatch-retry');

  const unsupportedReason = document.getElementById('unsupported-reason');
  const extractionErrorMsg = document.getElementById('extraction-error-message');
  const extractionRetryBtn = document.getElementById('btn-extraction-retry');

  // Success view elements
  const successProductTitle = document.getElementById('success-product-title');
  const successVariantsCount = document.getElementById('success-variants-count');
  const successImagesCount = document.getElementById('success-images-count');
  const viewShopifyAdminBtn = document.getElementById('btn-view-shopify-admin') as HTMLAnchorElement | null;
  const importAnotherBtn = document.getElementById('btn-import-another');

  // Partial image success elements
  const partialProductTitle = document.getElementById('partial-product-title');
  const partialWarningText = document.getElementById('partial-warning-text');
  const viewPartialAdminBtn = document.getElementById('btn-view-partial-admin') as HTMLAnchorElement | null;
  const partialDoneBtn = document.getElementById('btn-partial-done');

  // Duplicate view elements
  const viewDuplicateAdminBtn = document.getElementById('btn-view-duplicate-admin') as HTMLAnchorElement | null;
  const reimportBtn = document.getElementById('btn-reimport') as HTMLButtonElement | null;

  // Uncertain outcome elements
  const checkAdminProductsBtn = document.getElementById('btn-check-admin-products') as HTMLAnchorElement | null;

  // Status banner
  const statusBanner = document.getElementById('status-banner');
  const statusText = document.getElementById('status-text');

  // Application State
  let currentJwt: string | null = null;
  let activeStoreDomain: string | null = null;
  let activeStoreName: string | null = null;
  let activeStoreCurrency: string = 'USD';
  let currentProduct: ExtractedProduct | null = null;

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

  function setPopupState(state: PopupState): void {
    hideStatus();
    for (const [key, el] of Object.entries(stateViews)) {
      if (el) {
        if (key === state) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
    }
  }

  function updateBadgeConnected(name: string, currency: string): void {
    if (storeBadge) {
      storeBadge.classList.remove('store-badge--disconnected');
      storeBadge.classList.add('store-badge--connected');
    }
    if (badgeText) {
      badgeText.textContent = `${name} (${currency})`;
    }
  }

  function updateBadgeDisconnected(): void {
    if (storeBadge) {
      storeBadge.classList.remove('store-badge--connected');
      storeBadge.classList.add('store-badge--disconnected');
    }
    if (badgeText) {
      badgeText.textContent = 'Not Connected';
    }
  }

  function updateCalculatedPrice(): void {
    if (!currentProduct || !previewSellingPrice || !previewMarkupInput) return;

    const markup = parseFloat(previewMarkupInput.value) || 0;
    const shipping = previewShippingInput ? parseFloat(previewShippingInput.value) || 0 : 0;
    const range = calculatePriceRange(currentProduct.variants, markup, shipping);

    if (previewTotalCost) {
      previewTotalCost.textContent = range.isCostRange
        ? `$${range.minTotalCost} – $${range.maxTotalCost} ${currentProduct.source_currency}`
        : `$${range.minTotalCost} ${currentProduct.source_currency}`;
    }

    if (range.isRange) {
      previewSellingPrice.textContent = `$${range.minPrice} – $${range.maxPrice} ${currentProduct.source_currency}`;
    } else {
      previewSellingPrice.textContent = `$${range.minPrice} ${currentProduct.source_currency}`;
    }
  }

  // 1. Session Verification
  async function initializeApp(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      setPopupState('disconnected');
      return;
    }

    const stored = await chrome.storage.local.get([
      'shopify_jwt',
      'shopify_store_name',
      'shopify_store_currency',
      'shopify_shop_domain',
    ]);

    if (!stored.shopify_jwt) {
      updateBadgeDisconnected();
      setPopupState('disconnected');
      return;
    }

    currentJwt = stored.shopify_jwt;
    activeStoreDomain = stored.shopify_shop_domain;
    activeStoreName = stored.shopify_store_name || stored.shopify_shop_domain;
    activeStoreCurrency = stored.shopify_store_currency || 'USD';

    // Verify session with backend
    try {
      const res = await fetch(`${CONFIG.BACKEND_URL}/api/status`, {
        headers: { Authorization: `Bearer ${currentJwt}` },
      });

      if (res.status === 401) {
        // Expired or revoked
        await chrome.storage.local.remove([
          'shopify_jwt',
          'shopify_store_name',
          'shopify_store_currency',
          'shopify_shop_domain',
        ]);
        currentJwt = null;
        updateBadgeDisconnected();
        setPopupState('disconnected');
        showStatus('Previous store session has expired. Please reconnect.', true);
        return;
      }

      if (res.ok) {
        const data = (await res.json()) as StoreStatusResponse;
        if (data.connected && data.shop_domain) {
          activeStoreDomain = data.shop_domain;
          activeStoreName = data.store_name || data.shop_domain;
          activeStoreCurrency = data.store_currency || 'USD';
          updateBadgeConnected(activeStoreName, activeStoreCurrency);
          await checkCurrentTabAndExtract();
        }
      } else {
        updateBadgeDisconnected();
        setPopupState('disconnected');
      }
    } catch {
      // Backend unreachable: still show connected badge with cached data, warn user
      updateBadgeConnected(activeStoreName || 'Store', activeStoreCurrency);
      showStatus('Cannot reach backend server. Please verify backend is running.', true);
      await checkCurrentTabAndExtract();
    }
  }

  // 2. Tab Inspection & Extraction Trigger
  async function checkCurrentTabAndExtract(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.query) {
      setPopupState('non-aliexpress');
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const activeTab = tabs[0];

    if (!activeTab || !activeTab.id || !activeTab.url) {
      setPopupState('non-aliexpress');
      return;
    }

    let urlObj: URL;
    try {
      urlObj = new URL(activeTab.url);
    } catch {
      setPopupState('non-aliexpress');
      return;
    }

    // Check if on an AliExpress domain with an item path
    if (!isAllowedAliExpressHost(urlObj.hostname) || !urlObj.pathname.includes('/item/')) {
      setPopupState('non-aliexpress');
      return;
    }

    // Start extraction
    setPopupState('extracting');

    try {
      // 1. Query the MAIN world of the active tab for window.runParams / _runParams_ / etc.
      let mainWorldPayload: Record<string, unknown> | null = null;
      if (
        typeof chrome !== 'undefined' &&
        chrome.scripting &&
        chrome.scripting.executeScript &&
        activeTab.id
      ) {
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            world: 'MAIN',
            func: () => {
              const win = window as unknown as Record<string, unknown>;
              const p =
                win.runParams ||
                win._runParams_ ||
                (win._dida_config_ as Record<string, unknown> | undefined)?._init_data_ ||
                win.__INITIAL_DATA__ ||
                win.__INITIAL_STATE__ ||
                win._init_data_ ||
                win.pageData ||
                win.__PAGE_DATA__;
              try {
                return p ? JSON.parse(JSON.stringify(p)) : null;
              } catch {
                return null;
              }
            },
          });
          if (results && results[0] && results[0].result) {
            mainWorldPayload = results[0].result as Record<string, unknown>;
          }
        } catch (scriptErr) {
          console.warn('[Popup] Main world script execution fallback:', scriptErr);
        }
      }

      chrome.tabs.sendMessage(
        activeTab.id,
        { action: 'EXTRACT_PRODUCT', mainWorldPayload },
        (response: ExtractionMessageResponse) => {
          if (chrome.runtime.lastError) {
            setPopupState('extraction-error');
            if (extractionErrorMsg) {
              extractionErrorMsg.textContent =
                'Could not communicate with AliExpress page. Please refresh the AliExpress tab and reopen the extension.';
            }
            return;
          }

          handleExtractionResponse(response);
        }
      );
    } catch {
      setPopupState('extraction-error');
      if (extractionErrorMsg) {
        extractionErrorMsg.textContent = 'Failed to execute extraction on this page.';
      }
    }
  }

  // 3. Handle Extraction Result
  function handleExtractionResponse(response: ExtractionMessageResponse): void {
    if (!response || !response.success || !response.product) {
      const errCode = response?.error?.code || 'UNKNOWN';
      const errMsg = response?.error?.message || 'Could not extract product information.';

      if (errCode === 'UNSUPPORTED_PRODUCT_OPTIONS') {
        if (unsupportedReason) unsupportedReason.textContent = errMsg;
        setPopupState('unsupported-options');
        return;
      }

      if (extractionErrorMsg) extractionErrorMsg.textContent = errMsg;
      setPopupState('extraction-error');
      return;
    }

    currentProduct = response.product;

    // Currency verification: strictly compare source currency with store currency (F-02)
    if (currentProduct.source_currency !== activeStoreCurrency) {
      if (mismatchSourceCur) mismatchSourceCur.textContent = currentProduct.source_currency;
      if (mismatchStoreCur) mismatchStoreCur.textContent = activeStoreCurrency;
      if (mismatchTargetCur) mismatchTargetCur.textContent = activeStoreCurrency;
      setPopupState('currency-mismatch');
      return;
    }

    // Check 3-option limit (F-04)
    if (currentProduct.options.length > 3) {
      if (unsupportedReason) {
        unsupportedReason.textContent = `This product has ${currentProduct.options.length} options (${currentProduct.options.map((o) => o.name).join(', ')}). Shopify supports a maximum of 3 options.`;
      }
      setPopupState('unsupported-options');
      return;
    }

    // Populate preview state
    if (previewThumb) {
      previewThumb.src = currentProduct.images[0]?.url || '';
      previewThumb.alt = currentProduct.title;
    }
    if (previewTitle) {
      previewTitle.textContent = currentProduct.title;
      previewTitle.title = currentProduct.title;
    }
    if (previewVariantsBadge) {
      const count = currentProduct.variants.length;
      const opts = currentProduct.options.map((o) => o.name).join(', ');
      previewVariantsBadge.textContent = opts ? `${count} variants (${opts})` : `${count} variant`;
    }
    if (previewImagesBadge) {
      previewImagesBadge.textContent = `${currentProduct.images.length} images`;
    }

    // Populate price breakdown
    const rawRange = calculatePriceRange(currentProduct.variants, 0);
    if (previewSourcePrice) {
      previewSourcePrice.textContent = rawRange.isRange
        ? `$${rawRange.minPrice} – $${rawRange.maxPrice} ${currentProduct.source_currency}`
        : `$${rawRange.minPrice} ${currentProduct.source_currency}`;
    }

    if (previewShippingInput) {
      previewShippingInput.value = currentProduct.shipping_cost || '0.00';
    }
    if (previewShippingCurrency) {
      previewShippingCurrency.textContent = currentProduct.source_currency;
    }

    updateCalculatedPrice();
    setPopupState('preview');
  }

  // 4. Markup & Shipping Input Change Listeners (Real-Time Recalculation)
  if (previewMarkupInput) {
    previewMarkupInput.addEventListener('input', () => {
      updateCalculatedPrice();
    });
  }

  if (previewShippingInput) {
    previewShippingInput.addEventListener('input', () => {
      updateCalculatedPrice();
    });
  }

  // 5. Import Button Handler & Re-import Handler
  async function executeImportRequest(forceReimport = false): Promise<void> {
    if (!currentProduct || !currentJwt) {
      showStatus('Missing product data or authentication token.', true);
      return;
    }

    setPopupState('importing');

    const markup = previewMarkupInput ? parseFloat(previewMarkupInput.value) || 0 : 30;
    const shipping = previewShippingInput ? parseFloat(previewShippingInput.value) || 0 : 0;

    const payload = {
      source_product_id: currentProduct.source_product_id,
      source_url: currentProduct.source_url,
      source_currency: currentProduct.source_currency,
      title: currentProduct.title,
      description_html: currentProduct.description_html,
      images: currentProduct.images,
      options: currentProduct.options,
      variants: currentProduct.variants,
      markup_percentage: markup,
      shipping_cost: shipping,
      force_reimport: forceReimport,
    };

    try {
      const res = await fetch(`${CONFIG.BACKEND_URL}/api/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentJwt}`,
        },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as ImportApiResponse;

      if (res.status === 201 && data.success) {
        if (data.outcome === 'completed_partial_images') {
          // Partial image success
          if (partialProductTitle) partialProductTitle.textContent = data.title;
          if (partialWarningText) {
            partialWarningText.textContent = `Product created as Draft, but ${data.images_failed} of ${data.images_requested} images could not be imported.`;
          }
          if (viewPartialAdminBtn) viewPartialAdminBtn.href = data.shopify_admin_url;
          setPopupState('partial-image-success');
        } else {
          // Full success
          if (successProductTitle) successProductTitle.textContent = data.title;
          if (successVariantsCount) successVariantsCount.textContent = String(data.variants_created);
          if (successImagesCount) successImagesCount.textContent = `${data.images_succeeded} of ${data.images_requested}`;
          if (viewShopifyAdminBtn) viewShopifyAdminBtn.href = data.shopify_admin_url;
          setPopupState('success');
        }
        return;
      }

      if (res.status === 409) {
        const duplicateUrl = (data as { shopify_admin_url?: string }).shopify_admin_url;
        if (duplicateUrl && viewDuplicateAdminBtn) {
          viewDuplicateAdminBtn.href = duplicateUrl;
        }
        setPopupState('duplicate');
        return;
      }

      if (res.status === 502 || res.status === 504) {
        const errCode = (data as { error?: { code?: string } }).error?.code;
        if (errCode === 'UNKNOWN_OUTCOME') {
          if (checkAdminProductsBtn) {
            checkAdminProductsBtn.href = `https://admin.shopify.com/store/${activeStoreDomain?.replace('.myshopify.com', '')}/products`;
          }
          setPopupState('uncertain-outcome');
          return;
        }
      }

      // Generic error
      const msg = (data as { error?: { message?: string } }).error?.message || 'Import failed.';
      if (extractionErrorMsg) extractionErrorMsg.textContent = msg;
      setPopupState('extraction-error');
    } catch (err: unknown) {
      if (extractionErrorMsg) {
        extractionErrorMsg.textContent = `Network error: ${(err as Error).message}`;
      }
      setPopupState('extraction-error');
    }
  }

  if (importBtn) {
    importBtn.addEventListener('click', () => {
      executeImportRequest(false);
    });
  }

  if (reimportBtn) {
    reimportBtn.addEventListener('click', () => {
      executeImportRequest(true);
    });
  }

  // 6. Connect Button
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

  // 7. Navigation & Retry Buttons
  if (mismatchRetryBtn) {
    mismatchRetryBtn.addEventListener('click', () => {
      checkCurrentTabAndExtract();
    });
  }

  if (extractionRetryBtn) {
    extractionRetryBtn.addEventListener('click', () => {
      checkCurrentTabAndExtract();
    });
  }

  if (importAnotherBtn) {
    importAnotherBtn.addEventListener('click', () => {
      checkCurrentTabAndExtract();
    });
  }

  if (partialDoneBtn) {
    partialDoneBtn.addEventListener('click', () => {
      checkCurrentTabAndExtract();
    });
  }

  if (disconnectNonAeBtn) {
    disconnectNonAeBtn.addEventListener('click', async () => {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.remove([
          'shopify_jwt',
          'shopify_store_name',
          'shopify_store_currency',
          'shopify_shop_domain',
        ]);
      }
      currentJwt = null;
      updateBadgeDisconnected();
      setPopupState('disconnected');
    });
  }

  // Initialize
  await initializeApp();
});
