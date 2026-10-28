import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalRepository } from '../data/repository/local';
import { createSampleData } from '../data/sampleLeads';
import type { Lead } from '../types';
import { dealAmounts, dealFromStored, dealPhrase, firstYearValue, hasDealTerms, justClosed, NO_DEAL, recurringYearly } from './deal';
import { fromCount, NOUNS } from './hebrew';
import { filterLeads, funnelMetrics, patchLead, patchRevert } from './leads';

const NOW = new Date('2026-10-22T09:00:00');
const sample = createSampleData(NOW.getTime());
const leadNamed = (name: string) => sample.leads.find((lead) => lead.name === name)!;

describe('deal terms', () => {
  it('adds up what a deal brings in over its first year, and every year after', () => {
    const deal = { setupFee: 13_500, monthlyRetainer: 600, hostingYearly: 900 };
    expect(recurringYearly(deal)).toBe(600 * 12 + 900);
    expect(firstYearValue(deal)).toBe(13_500 + 600 * 12 + 900);
    expect(hasDealTerms(NO_DEAL)).toBe(false);
    expect(hasDealTerms({ ...NO_DEAL, hostingYearly: 750 })).toBe(true);
  });

  it('says the amounts with how often they come in, as one Hebrew list', () => {
    // Intl marks money with right-to-left marks and a no-break space; compare the words
    const plain = (text: string | null) => text?.replace(/\u200f/g, '').replace(/\u00a0/g, ' ') ?? null;
    const deal = { setupFee: 13_500, monthlyRetainer: 600, hostingYearly: 900 };
    expect(plain(dealPhrase(deal, 'ILS'))).toBe('13,500 ₪, 600 ₪ לחודש ו-900 ₪ לשנה');
    expect(plain(dealPhrase({ ...deal, monthlyRetainer: 0 }, 'ILS'))).toBe('13,500 ₪ ו-900 ₪ לשנה');
    expect(plain(dealPhrase({ ...NO_DEAL, monthlyRetainer: 450 }, 'USD'))).toBe('450 $ לחודש');
    expect(dealPhrase(NO_DEAL, 'ILS')).toBeNull();
    expect(dealAmounts({ ...deal, setupFee: 0 }, 'ILS').map(plain)).toEqual(['600 ₪ לחודש', '900 ₪ לשנה']);
    expect([fromCount(1, NOUNS.client), fromCount(3, NOUNS.client), fromCount(2, NOUNS.day)]).toEqual(['מלקוח אחד', 'מ-3 לקוחות', 'מיומיים']);
  });

  it('asks for the amounts of a deal that closed a moment ago', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    const closed = { stage: 'closed' as const, stageChangedAt: '2026-10-26T11:59:20Z', deal: { ...NO_DEAL } };
    expect(justClosed(closed, now)).toBe(true);
    expect(justClosed({ ...closed, stageChangedAt: '2026-10-26T11:50:00Z' }, now)).toBe(false);
    expect(justClosed({ ...closed, deal: { ...NO_DEAL, setupFee: 9_000 } }, now)).toBe(false);
    expect(justClosed({ ...closed, stage: 'zoom' }, now)).toBe(false);
  });

  it('changes one amount at a time and can put back exactly what it changed', () => {
    const dairy = leadNamed('מחלבת משפחת לוי');
    const edited = patchLead(dairy, { deal: { monthlyRetainer: 800 } });
    expect(edited.deal).toEqual({ setupFee: 13_500, monthlyRetainer: 800, hostingYearly: 900 });
    expect(edited.name).toBe(dairy.name);

    const revert = patchRevert(dairy, { deal: { monthlyRetainer: 800 }, currency: 'USD' });
    expect(revert).toEqual({ deal: { monthlyRetainer: 600 }, currency: 'ILS' });
    // A later edit to another amount survives putting this one back
    const later = patchLead(edited, { deal: { hostingYearly: 1_200 } });
    expect(patchLead(later, revert).deal).toEqual({ setupFee: 13_500, monthlyRetainer: 600, hostingYearly: 1_200 });
  });

  it('keeps the income of each currency apart', () => {
    const hotel = leadNamed('מלון בוטיק שמש');
    const inDollars: Lead = { ...hotel, stage: 'closed', currency: 'USD', deal: { setupFee: 24_000, monthlyRetainer: 750, hostingYearly: 0 } };
    const { income } = funnelMetrics(sample.leads.map((lead) => (lead.id === hotel.id ? inDollars : lead)));
    expect(income.setup).toEqual({ totals: { ILS: 25_000, USD: 24_000 }, deals: { ILS: 2, USD: 1 } });
    expect(income.monthly).toEqual({ totals: { ILS: 600, USD: 750 }, deals: { ILS: 1, USD: 1 } });
    expect(income.yearly).toEqual({ totals: { ILS: 1_650 }, deals: { ILS: 2 } });
  });

  it('sorts deals by what they bring in over the first year', () => {
    const query = { query: '', stage: 'closed' as const, campaign: '', sort: 'value' as const };
    // The kayak deal has the smaller setup fee and no retainer
    expect(filterLeads(sample.leads, query).map((lead) => lead.name)).toEqual(['מחלבת משפחת לוי', 'קיאקים בירדן']);
    const kayak = patchLead(leadNamed('קיאקים בירדן'), { deal: { monthlyRetainer: 900 } });
    const leads = sample.leads.map((lead) => (lead.id === kayak.id ? kayak : lead));
    expect(filterLeads(leads, query).map((lead) => lead.name)).toEqual(['קיאקים בירדן', 'מחלבת משפחת לוי']);
  });

  it('reads the single amount older leads had as the setup fee of a closed deal', () => {
    expect(dealFromStored({ value: 9_000, stage: 'closed' })).toEqual({ setupFee: 9_000, monthlyRetainer: 0, hostingYearly: 0 });
    expect(dealFromStored({ value: 9_000, stage: 'zoom' })).toEqual(NO_DEAL);
    expect(dealFromStored({ stage: 'cold_call' })).toEqual(NO_DEAL);
    const deal = { setupFee: 1, monthlyRetainer: 2, hostingYearly: 3 };
    expect(dealFromStored({ deal, value: 9_000, stage: 'closed' })).toEqual(deal);
  });
});

describe('deal terms kept in this browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const storage = (entries: Record<string, unknown>) => {
    const items = new Map(Object.entries(entries).map(([key, value]) => [key, JSON.stringify(value)]));
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      },
    });
    return items;
  };

  it('upgrades leads saved with one deal value', async () => {
    const stored = sample.leads.map(({ deal, ...lead }) => ({ ...lead, value: deal.setupFee }));
    // A lead from before the funnel, saved with a status
    const won = { id: 'old-1', name: 'Old Deal', status: 'won', value: 7_000, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };
    const items = storage({ 'omek-crm:leads:v1': [...stored, won], 'omek-crm:timeline:v1': [] });
    const leads = await createLocalRepository().list();
    expect(leads.find((lead) => lead.name === 'מחלבת משפחת לוי')?.deal).toEqual({ setupFee: 13_500, monthlyRetainer: 0, hostingYearly: 0 });
    expect(leads.find((lead) => lead.id === 'old-1')).toMatchObject({ stage: 'closed', deal: { setupFee: 7_000, monthlyRetainer: 0, hostingYearly: 0 } });
    expect(leads.every((lead) => !('value' in lead))).toBe(true);
    expect(leads.filter((lead) => lead.stage !== 'closed').every((lead) => !hasDealTerms(lead.deal))).toBe(true);
    expect(items.get('omek-crm:leads:v1')).toContain('"value"'); // stored as it was until something is saved
  });

  it('takes amounts only once the deal is closed, one at a time', async () => {
    storage({});
    const repository = createLocalRepository();
    const leads = await repository.list();
    const open = leads.find((lead) => lead.stage === 'zoom') as Lead;
    await expect(repository.update(open.id, { deal: { setupFee: 5_000 } })).rejects.toThrow(/רק אחרי שהעסקה נסגרה/);
    await expect(repository.update(open.id, { currency: 'USD' })).rejects.toThrow(/רק אחרי שהעסקה נסגרה/);

    const kayak = leads.find((lead) => lead.name === 'קיאקים בירדן') as Lead;
    const saved = await repository.update(kayak.id, { deal: { monthlyRetainer: 350 } });
    expect(saved.deal).toEqual({ setupFee: 11_500, monthlyRetainer: 350, hostingYearly: 750 });
    expect((await repository.list()).find((lead) => lead.id === kayak.id)?.deal.monthlyRetainer).toBe(350);
  });
});
