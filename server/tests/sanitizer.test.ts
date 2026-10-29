import { describe, it, expect } from 'vitest';
import { sanitizeDescriptionHtml } from '../src/validation/sanitizer.js';

describe('Server HTML Sanitizer', () => {
  it('strips script tags and inline executable code', () => {
    const raw = '<p>Great product!</p><script>alert("hacked")</script>';
    const clean = sanitizeDescriptionHtml(raw);
    expect(clean).toBe('<p>Great product!</p>');
    expect(clean).not.toContain('script');
    expect(clean).not.toContain('alert');
  });

  it('strips iframes and objects', () => {
    const raw = '<p>Info</p><iframe src="https://malicious.com"></iframe><object data="evil.swf"></object>';
    const clean = sanitizeDescriptionHtml(raw);
    expect(clean).toBe('<p>Info</p>');
    expect(clean).not.toContain('iframe');
    expect(clean).not.toContain('object');
  });

  it('strips inline on* event handlers', () => {
    const raw = '<p onclick="stealCookies()" onmouseover="evil()">Click me</p>';
    const clean = sanitizeDescriptionHtml(raw);
    expect(clean).toBe('<p>Click me</p>');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('stealCookies');
  });

  it('preserves safe formatting tags such as p, b, strong, ul, li, table', () => {
    const raw = `
      <p>Features:</p>
      <ul>
        <li><strong>Durable</strong> alloy construction</li>
        <li>Battery life: 10 hours</li>
      </ul>
      <table>
        <tbody>
          <tr><td>Weight</td><td>120g</td></tr>
        </tbody>
      </table>
    `;
    const clean = sanitizeDescriptionHtml(raw);
    expect(clean).toContain('<strong>Durable</strong>');
    expect(clean).toContain('<ul>');
    expect(clean).toContain('<li>');
    expect(clean).toContain('<table>');
    expect(clean).toContain('<td>Weight</td>');
  });

  it('caps oversized description at 50,000 characters', () => {
    const hugeHtml = '<p>' + 'A'.repeat(60_000) + '</p>';
    const clean = sanitizeDescriptionHtml(hugeHtml);
    expect(clean.length).toBeLessThanOrEqual(50_000);
  });

  it('handles null, undefined, or empty string gracefully', () => {
    expect(sanitizeDescriptionHtml(null)).toBe('');
    expect(sanitizeDescriptionHtml(undefined)).toBe('');
    expect(sanitizeDescriptionHtml('')).toBe('');
  });
});
