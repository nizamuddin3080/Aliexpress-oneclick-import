/**
 * OAuth Callback Handler (M1 Scaffold)
 * Extracts the single-use authorization code from query parameters.
 * Full exchange with backend is implemented in M2.
 */

document.addEventListener('DOMContentLoaded', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const msgEl = document.getElementById('msg');

  if (!code) {
    if (msgEl) msgEl.textContent = 'Error: Missing authorization code.';
    return;
  }

  if (msgEl) {
    msgEl.textContent = 'Authorization code received. (Exchange logic enabled in M2)';
  }
});
