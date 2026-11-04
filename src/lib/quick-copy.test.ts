import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSampleLeads } from '../data/sampleLeads';
import type { Lead } from '../types';
import { forgetQuickCopy, readQuickCopy, saveQuickCopy } from './quick-copy';

describe('the quick copy of the leads', () => {
  let items: Map<string, string>;
  let full = false;
  beforeEach(() => {
    items = new Map();
    full = false;
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (full) throw new DOMException('full', 'QuotaExceededError');
          items.set(key, value);
        },
        removeItem: (key: string) => void items.delete(key),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const leads = createSampleLeads(Date.parse('2026-11-04T10:00:00'));

  it('keeps the leads with their latest steps, and reads them back', () => {
    const busy: Lead = { ...leads[0], activity: Array.from({ length: 30 }, (_, i) => ({ ...leads[0].activity[0]!, id: `s${i}` })) };
    const withSteps = leads.filter((lead) => lead.activity.length > 0);
    expect(withSteps.length).toBeGreaterThan(0);
    expect(saveQuickCopy({ savedAt: 1, leads: [busy, ...leads.slice(1)], daily: null })).toBe(true);
    const copy = readQuickCopy();
    expect(copy?.savedAt).toBe(1);
    expect(copy?.leads).toHaveLength(leads.length);
    expect(copy?.leads[0].activity.map((step) => step.id)).toEqual(Array.from({ length: 12 }, (_, i) => `s${i}`));
    expect(copy?.leads.slice(1)).toEqual(leads.slice(1).map((lead) => ({ ...lead, activity: lead.activity.slice(0, 12) })));
    forgetQuickCopy();
    expect(readQuickCopy()).toBeNull();
  });

  it('keeps no copy rather than an old one when the storage is full, or the copy too big', () => {
    saveQuickCopy({ savedAt: 1, leads, daily: null });
    full = true;
    expect(saveQuickCopy({ savedAt: 2, leads, daily: null })).toBe(false);
    expect(readQuickCopy()).toBeNull();
    full = false;
    const huge = Array.from({ length: 3000 }, (_, i) => ({ ...leads[0], id: `lead-${i}`, approach: 'א'.repeat(500) }));
    expect(saveQuickCopy({ savedAt: 3, leads: huge, daily: null })).toBe(false);
    expect(readQuickCopy()).toBeNull();
  });

  it('reads nothing from a copy that is not one', () => {
    items.set('omek-crm:quick:v1', '{ broken');
    expect(readQuickCopy()).toBeNull();
    items.set('omek-crm:quick:v1', JSON.stringify({ leads: 'no' }));
    expect(readQuickCopy()).toBeNull();
  });
});
