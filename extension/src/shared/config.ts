/**
 * Extension Client Configuration
 * NOTE: Absolutely zero secrets permitted in extension client files.
 */

export const CONFIG = {
  BACKEND_URL: 'http://localhost:3456',
  API_TIMEOUT_MS: 30000,
  SUPPORTED_HOSTS: [
    'aliexpress.com',
    'aliexpress.ru',
    'aliexpress.us',
    'aliexpress.fr',
    'aliexpress.es',
    'aliexpress.it',
    'aliexpress.de',
    'aliexpress.pl',
    'aliexpress.com.br',
    'aliexpress.co.kr',
    'aliexpress.co.uk',
  ],
} as const;
