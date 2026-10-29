import { describe, it, expect } from 'vitest';
import { sanitizeProductDescription } from '../src/content/sanitizer.js';

describe('HTML Description Sanitizer (M3-08, SN-01..SN-05)', () => {
  it('strips script tags and executable JavaScript (SN-01)', () => {
    const dirty = '<p>Great headphones</p><script>alert("hacked")</script>';
    const clean = sanitizeProductDescription(dirty);
    expect(clean).toBe('<p>Great headphones</p>');
    expect(clean).not.toContain('<script>');
  });

  it('removes inline event handlers like onerror and onload (SN-02)', () => {
    const dirty = '<img src="https://ae01.alicdn.com/img.jpg" onerror="stealCookies()">';
    const clean = sanitizeProductDescription(dirty);
    expect(clean).toContain('<img src="https://ae01.alicdn.com/img.jpg">');
    expect(clean).not.toContain('onerror');
  });

  it('removes javascript: pseudo-protocol URIs (SN-03)', () => {
    const dirty = '<a href="javascript:doEvil()">Click for discount</a>';
    const clean = sanitizeProductDescription(dirty);
    expect(clean).not.toContain('javascript:');
  });

  it('removes iframes, objects, and embed tags (SN-04)', () => {
    const dirty = '<p>Specs</p><iframe src="https://evil.com"></iframe><object data="flash"></object>';
    const clean = sanitizeProductDescription(dirty);
    expect(clean).toBe('<p>Specs</p>');
    expect(clean).not.toContain('<iframe');
    expect(clean).not.toContain('<object');
  });

  it('strips style attributes to maintain clean layout (SN-05)', () => {
    const dirty = '<p style="color: red; position: fixed;">Text</p>';
    const clean = sanitizeProductDescription(dirty);
    expect(clean).toBe('<p>Text</p>');
    expect(clean).not.toContain('style=');
  });

  it('upgrades insecure http image URLs to https', () => {
    const dirty = '<img src="http://ae01.alicdn.com/kf/S1.jpg">';
    const clean = sanitizeProductDescription(dirty);
    expect(clean).toContain('src="https://ae01.alicdn.com/kf/S1.jpg"');
  });

  it('caps description size at 50,000 characters', () => {
    const longText = '<p>' + 'A'.repeat(60000) + '</p>';
    const clean = sanitizeProductDescription(longText);
    expect(clean.length).toBeLessThanOrEqual(50000);
  });
});
