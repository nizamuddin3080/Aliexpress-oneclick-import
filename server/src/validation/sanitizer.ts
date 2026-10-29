import sanitizeHtml from 'sanitize-html';

const MAX_DESCRIPTION_LENGTH = 50_000;

const SANITIZER_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'table', 'thead', 'tbody', 'tr', 'td', 'th', 'span', 'div',
    'blockquote', 'hr'
  ],
  allowedAttributes: {
    '*': ['title', 'class'],
    'td': ['colspan', 'rowspan', 'align'],
    'th': ['colspan', 'rowspan', 'align'],
  },
  allowedSchemes: ['http', 'https'],
  disallowedTagsMode: 'discard',
};

/**
 * Defense-in-depth HTML sanitizer for product descriptions.
 * Strips script tags, iframes, inline event handlers, embedded styles,
 * tracking pixels, and caps total length to 50KB.
 */
export function sanitizeDescriptionHtml(rawHtml: string | null | undefined): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return '';
  }

  // Pre-truncate if absurdly oversized before parsing
  const truncated = rawHtml.slice(0, MAX_DESCRIPTION_LENGTH * 2);

  const clean = sanitizeHtml(truncated, SANITIZER_OPTIONS);

  if (clean.length > MAX_DESCRIPTION_LENGTH) {
    return clean.slice(0, MAX_DESCRIPTION_LENGTH);
  }

  return clean.trim();
}
