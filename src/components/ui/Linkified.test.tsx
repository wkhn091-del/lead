import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Linkified, shortUrl } from './Linkified';

/** The parts Linkified renders: text as it is, and each link as [its label, its address] */
function parts(text: string): (string | [string, string])[] {
  const fragment = Linkified({ text }) as ReactElement<{ children: ReactNode[] }>;
  return fragment.props.children.map((part) => {
    if (typeof part === 'string') return part;
    if (!isValidElement<{ children: ReactElement<{ href: string; children: string }> }>(part)) throw new Error('unexpected part');
    const anchor = part.props.children;
    return [anchor.props.children, anchor.props.href];
  });
}

describe('Linkified', () => {
  it('makes the addresses in a note into links, and leaves the rest as it was', () => {
    const maps = 'https://www.google.com/maps/search/?api=1&query=THE%20MODERN%20MAN&query_place_id=ChIJHc2GphA_HBUR7_WQilBNvLA';
    expect(parts(`כתובת: הגליל 2, טבריה\nקישור: ${maps}\nאתר: https://arbel.co.il/contact/.`)).toEqual([
      'כתובת: הגליל 2, טבריה\nקישור: ',
      ['פתיחה במפות', maps],
      '\nאתר: ',
      ['arbel.co.il/contact', 'https://arbel.co.il/contact/'],
      '.',
    ]);
  });

  it('leaves text without an address alone', () => {
    expect(parts('התקשר מחר בבוקר')).toEqual(['התקשר מחר בבוקר']);
    expect(parts('javascript:alert(1) www.example.com')).toEqual(['javascript:alert(1) www.example.com']);
  });
});

describe('shortUrl', () => {
  it('reads as the site and the start of the path', () => {
    expect(shortUrl('https://www.arbel.co.il/')).toBe('arbel.co.il');
    expect(shortUrl('https://arbel.co.il/a?b=1')).toBe('arbel.co.il/a…');
    expect(shortUrl(`https://arbel.co.il/${'x'.repeat(60)}`)).toBe(`arbel.co.il/${'x'.repeat(28)}…`);
    expect(shortUrl('https://maps.app.goo.gl/abc')).toBe('פתיחה במפות');
  });
});
