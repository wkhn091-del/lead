import { describe, expect, it } from 'vitest';
import { deletedDate, IdentityIndex, LeadRegistry, mapsPlaceOf, nameKey, sharedText, siteOf, type KnownLead } from '../src/leads/identity.js';

const LISTING = 'https://www.google.com/maps/search/?api=1&query=THE%20MODERN%20MAN&query_place_id=ChIJHc2GphA_HBUR7_WQilBNvLA';

describe('mapsPlaceOf', () => {
  it('reads the place a Maps link names, however it was written', () => {
    expect(mapsPlaceOf(LISTING)).toBe('place:ChIJHc2GphA_HBUR7_WQilBNvLA');
    expect(mapsPlaceOf('https://www.google.com/maps/place/?q=place_id:ChIJHc2GphA_HBUR7_WQilBNvLA')).toBe('place:ChIJHc2GphA_HBUR7_WQilBNvLA');
    expect(mapsPlaceOf('https://maps.google.com/?cid=12719427383460364783')).toBe('cid:12719427383460364783');
    expect(
      mapsPlaceOf('https://www.google.com/maps/place/THE+MODERN+MAN/@32.79,35.53,17z/data=!4m6!3m5!1s0x151c3f10a686cd1d:0xB0BC4D508A90F5EF!8m2'),
    ).toBe('ftid:0x151c3f10a686cd1d:0xb0bc4d508a90f5ef');
    expect(mapsPlaceOf('https://maps.app.goo.gl/AbC123xyz')).toBe('link:maps.app.goo.gl/AbC123xyz');
  });

  it('names no place for a search by words or anything else', () => {
    expect(mapsPlaceOf('https://www.google.com/maps/search/?api=1&query=barber%20tiberias')).toBeNull();
    expect(mapsPlaceOf('https://arbel.co.il')).toBeNull();
    expect(mapsPlaceOf('not a link')).toBeNull();
    expect(mapsPlaceOf('')).toBeNull();
  });
});

describe('siteOf', () => {
  it('is the domain of a site of their own', () => {
    expect(siteOf('https://www.Arbel.co.il/he/contact?x=1')).toBe('arbel.co.il');
    expect(siteOf('arbel.co.il')).toBe('arbel.co.il');
  });

  it("is a business's page on a shared site", () => {
    expect(siteOf('https://www.instagram.com/TheModernMan_Barber/')).toBe('instagram.com/themodernman_barber');
    expect(siteOf('https://m.facebook.com/themodernman?ref=page')).toBe('facebook.com/themodernman');
    expect(siteOf('https://www.facebook.com/profile.php?id=100063612345678')).toBe('facebook.com/profile.php?id=100063612345678');
    expect(siteOf('https://www.facebook.com/pages/The-Modern-Man/123456789012')).toBe('facebook.com/pages/123456789012');
    expect(siteOf('https://www.linkedin.com/company/arbel-web/about')).toBe('linkedin.com/company/arbel-web');
    expect(siteOf('https://www.b144.co.il/biz/12345/the-modern-man')).toBe('b144.co.il/biz/12345/the-modern-man');
  });

  it("keeps a site builder's sites apart by their path", () => {
    expect(siteOf('https://designer.wixsite.com/barber1')).toBe('designer.wixsite.com/barber1');
    expect(siteOf('https://designer.wixsite.com/barber2/booking')).toBe('designer.wixsite.com/barber2');
    expect(siteOf('https://sites.google.com/view/modern-man/home')).toBe('sites.google.com/view/modern-man');
  });

  it("is nothing for a link that isn't one business's", () => {
    expect(siteOf('https://wa.me/972525210652')).toBeNull();
    expect(siteOf('https://www.facebook.com/sharer.php?u=x')).toBeNull();
    expect(siteOf('https://www.instagram.com/p/C1x2y3/')).toBeNull();
    expect(siteOf('https://www.instagram.com/')).toBeNull();
    expect(siteOf(LISTING)).toBeNull();
    expect(siteOf('')).toBeNull();
  });
});

describe('nameKey', () => {
  it('reads names the same whatever their case, punctuation and spacing', () => {
    expect(nameKey('THE MODERN MAN - barberia')).toBe('the modern man barberia');
    expect(nameKey('The  Modern Man Barberia')).toBe('the modern man barberia');
    expect(nameKey('מספרת  "אבי"')).toBe('מספרת אבי');
    expect(nameKey('  ')).toBe('');
  });
});

const lead = (id: string, details: Partial<KnownLead> = {}): KnownLead => ({ id, name: `עסק ${id}`, phone: '', ...details });

describe('IdentityIndex', () => {
  const index = new IdentityIndex<KnownLead>('972');
  index.add(lead('phone', { phone: '052-521-0652' }));
  index.add(lead('place', { name: 'מספרה אחת', mapsUrl: LISTING }));
  index.add(lead('site', { website: 'https://www.instagram.com/themodernman/' }));
  index.add(lead('email', { email: 'Avi@Barber.co.il' }));
  index.add(lead('named', { name: 'Barber Shop', city: 'ירושלים', phone: '050-111-1111' }));
  index.add(lead('nameOnly', { name: 'המספרה של דני', city: 'חיפה' }));

  it('finds a business by its number, however it was written', () => {
    for (const phone of ['0525210652', '+972 52-521-0652', '+972 052 521 0652', '00972525210652']) {
      expect(index.find({ name: 'שם אחר', phone }), phone).toMatchObject({ lead: { id: 'phone' }, by: 'phone' });
    }
  });

  it('finds it by its Maps place, its site or its email', () => {
    expect(index.find({ name: 'x', mapsUrl: 'https://www.google.com/maps/place/?q=place_id:ChIJHc2GphA_HBUR7_WQilBNvLA' })).toMatchObject({ lead: { id: 'place' }, by: 'place' });
    expect(index.find({ name: 'x', website: 'instagram.com/TheModernMan' })).toMatchObject({ lead: { id: 'site' }, by: 'site' });
    expect(index.find({ name: 'x', email: ' avi@barber.co.il ' })).toMatchObject({ lead: { id: 'email' }, by: 'email' });
  });

  it('finds it by name in the same city, unless something tells them apart', () => {
    expect(index.find({ name: 'BARBER-SHOP', city: 'ירושלים' })).toMatchObject({ lead: { id: 'named' }, by: 'name' });
    // No city on one of them: it could be the same one
    expect(index.find({ name: 'barber shop' })).toMatchObject({ lead: { id: 'named' }, by: 'name' });
    expect(index.find({ name: 'Barber Shop', city: 'ירושלים', phone: '050-111-1111' })).toMatchObject({ by: 'phone' });
    // Another branch: another number, or another city
    expect(index.find({ name: 'Barber Shop', city: 'ירושלים', phone: '050-222-2222' })).toBeNull();
    expect(index.find({ name: 'Barber Shop', city: 'תל אביב' })).toBeNull();
    // A lead with no number and a business with one: nothing tells them apart
    expect(index.find({ name: 'המספרה של דני', city: 'חיפה', phone: '054-999-9999' })).toMatchObject({ lead: { id: 'nameOnly' }, by: 'name' });
    expect(index.find({ name: 'המספרה של דני', city: 'קריית ים' })).toBeNull();
  });

  it('agrees on a city written longer', () => {
    const cities = new IdentityIndex<KnownLead>('972');
    cities.add(lead('ta', { name: 'Barber TLV', city: 'תל אביב-יפו' }));
    expect(cities.find({ name: 'barber tlv', city: 'תל אביב' })).toMatchObject({ lead: { id: 'ta' }, by: 'name' });
  });

  it('finds nothing new', () => {
    expect(index.find({ name: 'עסק חדש', phone: '053-000-0000', city: 'אילת' })).toBeNull();
    expect(index.find({ name: '' })).toBeNull();
  });

  it('learns what a lead was filled in with', () => {
    const filled = new IdentityIndex<KnownLead>('972');
    const old = lead('old', { phone: '052-000-0000' });
    filled.add(old);
    expect(filled.find({ name: 'x', mapsUrl: LISTING })).toBeNull();
    old.mapsUrl = LISTING;
    filled.add(old);
    expect(filled.find({ name: 'x', mapsUrl: LISTING })).toMatchObject({ lead: { id: 'old' }, by: 'place' });
  });
});

describe('LeadRegistry', () => {
  const deletedAt = new Date('2026-11-06T23:30:00Z');
  const registry = new LeadRegistry<KnownLead>(
    [
      lead('gone', { name: 'THE MODERN MAN', phone: '052-521-0652', city: 'טבריה', deletedAt }),
      lead('back', { name: 'Itzhak edri', phone: '055-883-6716', deletedAt }),
      lead('here', { name: 'Itzhak edri Barbershop', phone: '055-883-6716', archivedAt: deletedAt }),
    ],
    '972',
  );

  it('says a business was deleted', () => {
    expect(registry.find({ name: 'the modern man', phone: '0525210652' })).toMatchObject({ lead: { id: 'gone' }, by: 'phone', deleted: true });
  });

  it('prefers the lead that is there now', () => {
    expect(registry.find({ name: 'x', phone: '+972 55-883-6716' })).toMatchObject({ lead: { id: 'here' }, deleted: false });
  });

  it('says what they share, and when it was deleted', () => {
    expect(sharedText('name', { name: 'a', city: 'טבריה' }, { name: 'a', city: 'טבריה' })).toBe('אותו שם ועיר');
    expect(sharedText('name', { name: 'a' }, { name: 'a', city: 'טבריה' })).toBe('אותו שם');
    expect(sharedText('phone', { name: 'a' }, { name: 'b' })).toBe('אותו מספר טלפון');
    // In Israel it was already the 7th
    expect(deletedDate(deletedAt)).toBe('7.11.2026');
    expect(deletedDate('2026-11-06T23:30:00.000Z', 'UTC')).toBe('6.11.2026');
  });
});
