import { describe, expect, it } from 'vitest';
import { leadDeal } from '../src/stores/prisma.js';

describe('deal terms in the database', () => {
  it('reads a lead stored before deal terms: its one amount becomes the setup fee', () => {
    expect(leadDeal({ deal: null, legacyValue: 13500, stage: 'closed' })).toEqual({ setupFee: 13500, monthlyRetainer: 0, hostingYearly: 0 });
    expect(leadDeal({ deal: null, legacyValue: null, stage: 'closed' })).toEqual({ setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 });
    // Only a closed deal has amounts
    expect(leadDeal({ deal: null, legacyValue: 13500, stage: 'zoom' })).toEqual({ setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 });
  });

  it('prefers the deal terms once they are written', () => {
    const deal = { setupFee: 12000, monthlyRetainer: 450, hostingYearly: 900 };
    expect(leadDeal({ deal, legacyValue: 13500, stage: 'closed' })).toEqual(deal);
  });
});
