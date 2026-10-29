import DOMPurify from 'dompurify';

const MAX_DESCRIPTION_LENGTH = 50000;

const ALLOWED_TAGS = [
  'p', 'br', 'b', 'strong', 'i', 'em', 'u',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'span', 'div',
];

const ALLOWED_ATTR = [
  'src', 'alt', 'title', 'width', 'height', 'align',
];

/**
 * Sanitizes product HTML descriptions client-side using DOMPurify.
 * Enforces tag/attribute allowlists, strips scripts and event handlers, and bounds payload size.
 */
export function sanitizeProductDescription(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }

  // Pre-configure DOMPurify hook to ensure all images use HTTPS
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'IMG') {
      const src = node.getAttribute('src');
      if (src && src.startsWith('http://')) {
        node.setAttribute('src', src.replace('http://', 'https://'));
      }
      if (src && src.startsWith('//')) {
        node.setAttribute('src', `https:${src}`);
      }
    }
  });

  const clean = DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'style'],
    ALLOW_DATA_ATTR: false,
  });

  DOMPurify.removeAllHooks();

  // Enforce max length constraint
  if (clean.length > MAX_DESCRIPTION_LENGTH) {
    return clean.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return clean.trim();
}
