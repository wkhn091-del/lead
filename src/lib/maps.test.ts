import { describe, expect, it } from 'vitest';
import { isGoogleMapsUrl, isValidMapsUrl, mapsLink } from './maps';

const LISTING = 'https://www.google.com/maps/search/?api=1&query=THE%20MODERN%20MAN&query_place_id=ChIJHc2GphA_HBUR7_WQilBNvLA';

describe('mapsLink', () => {
  it('opens the stored listing', () => {
    expect(mapsLink({ name: 'THE MODERN MAN', city: 'טבריה', mapsUrl: LISTING })).toEqual({ href: LISTING, search: false });
    expect(mapsLink({ name: 'THE MODERN MAN', mapsUrl: ` ${LISTING} ` })).toEqual({ href: LISTING, search: false });
  });

  it('searches for the name in the city when no listing is stored', () => {
    const link = mapsLink({ name: 'המספרה אליהו', city: 'ירושלים', mapsUrl: '' });
    expect(link?.search).toBe(true);
    expect(new URL(link!.href).searchParams.get('query')).toBe('המספרה אליהו ירושלים');
  });

  it('has nothing to go on without a listing or a city', () => {
    expect(mapsLink({ name: 'המספרה אליהו' })).toBeNull();
    expect(mapsLink({ name: 'המספרה אליהו', city: '  ', mapsUrl: '' })).toBeNull();
    expect(mapsLink({ name: '', city: 'ירושלים' })).toBeNull();
  });

  it('never makes a link of anything but http(s)', () => {
    expect(mapsLink({ name: 'x', mapsUrl: 'javascript:alert(1)' })).toBeNull();
    expect(mapsLink({ name: 'x', city: 'חיפה', mapsUrl: 'javascript:alert(1)' })?.search).toBe(true);
    expect(isValidMapsUrl('https://maps.app.goo.gl/abc')).toBe(true);
    expect(isValidMapsUrl('https://maps.app.goo.gl/a b')).toBe(false);
    expect(isValidMapsUrl(`https://x.co/${'a'.repeat(500)}`)).toBe(false);
  });
});

describe('isGoogleMapsUrl', () => {
  it('knows a Maps address', () => {
    expect(isGoogleMapsUrl(LISTING)).toBe(true);
    expect(isGoogleMapsUrl('https://google.co.il/maps/place/x')).toBe(true);
    expect(isGoogleMapsUrl('https://maps.google.com/?cid=1')).toBe(true);
    expect(isGoogleMapsUrl('https://maps.app.goo.gl/abc')).toBe(true);
    expect(isGoogleMapsUrl('https://www.google.com/search?q=maps')).toBe(false);
    expect(isGoogleMapsUrl('https://arbel.co.il/maps')).toBe(false);
  });
});
