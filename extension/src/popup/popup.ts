/**
 * Popup Controller (M1 Scaffold)
 * Provides UI scaffolding and basic DOM event wiring.
 */

document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('btn-connect') as HTMLButtonElement | null;
  const domainInput = document.getElementById('shop-domain-input') as HTMLInputElement | null;
  const statusBanner = document.getElementById('status-banner');
  const statusText = document.getElementById('status-text');

  if (connectBtn && domainInput) {
    connectBtn.addEventListener('click', () => {
      const rawDomain = domainInput.value.trim();
      if (!rawDomain) {
        showStatus('Please enter your Shopify store domain.', true);
        return;
      }

      const domain = rawDomain.includes('.myshopify.com')
        ? rawDomain
        : `${rawDomain}.myshopify.com`;

      showStatus(`Connecting to ${domain}... (OAuth flow will be enabled in M2)`, false);
    });
  }

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
});
