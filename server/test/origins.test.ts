import { describe, expect, it } from 'vitest';
import { parseOrigins, toOrigin } from '../src/lib/origins.js';

describe('CORS_ORIGINS', () => {
  it('reads an address however it was typed', () => {
    for (const typed of ['https://omek-leads.vercel.app', 'https://omek-leads.vercel.app/', ' omek-leads.vercel.app ', 'HTTPS://Omek-Leads.Vercel.app/login']) {
      expect(toOrigin(typed)).toBe('https://omek-leads.vercel.app');
    }
    expect(toOrigin('http://localhost:5173/')).toBe('http://localhost:5173');
    expect(toOrigin('ftp://files.example')).toBeNull();
    expect(toOrigin('')).toBeNull();
  });

  it('takes a list, without repeats or empty entries', () => {
    expect(parseOrigins('omek-leads.vercel.app, https://crm.omek.co.il/,,https://omek-leads.vercel.app')).toEqual([
      'https://omek-leads.vercel.app',
      'https://crm.omek.co.il',
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins('')).toEqual([]);
  });
});
