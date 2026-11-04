import { describe, expect, it } from 'vitest';
import { formatRelative } from './format';

const NOW = new Date('2026-11-04T10:00:00').getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;

describe('relative times', () => {
  it('reads like Hebrew, without a count in brackets after the word', () => {
    expect(formatRelative(ago(20_000), NOW)).toBe('עכשיו');
    expect(formatRelative(ago(MINUTE), NOW)).toBe('לפני דקה');
    expect(formatRelative(ago(12 * MINUTE), NOW)).toMatch(/^לפני 12 דק/);
    expect(formatRelative(ago(60 * MINUTE), NOW)).toBe('לפני שעה');
    expect(formatRelative(ago(120 * MINUTE), NOW)).toBe('לפני שעתיים');
    expect(formatRelative(ago(5 * 60 * MINUTE), NOW)).not.toMatch(/\(/);
    expect(formatRelative(ago(24 * 60 * MINUTE), NOW)).toBe('אתמול');
  });
});
