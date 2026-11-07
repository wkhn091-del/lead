import { describe, expect, it } from 'vitest';
import type { Activity, Lead } from '../types';
import { DEFAULT_TEMPLATES, fillTemplate, templateFor } from './messages';

const lead = (overrides: Partial<Lead> = {}): Lead => ({
  id: 'l1',
  name: 'מספרת אליהו',
  contactName: 'אליהו כהן',
  phone: '050-909-4047',
  email: '',
  website: '',
  campaign: 'מספרות',
  approach: '',
  method: 'call',
  stage: 'cold_call',
  stageChangedAt: '2026-11-01T08:00:00.000Z',
  archivedAt: null,
  attemptCount: 0,
  lastAttemptAt: null,
  deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
  currency: 'ILS',
  activity: [],
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
  ...overrides,
});

const step = (type: Activity['type']): Activity => ({
  id: type,
  type,
  at: '2026-11-02T08:00:00.000Z',
  from: 'cold_call',
  to: null,
  before: { stageChangedAt: '2026-11-01T08:00:00.000Z', lastAttemptAt: null, attemptCount: 0 },
});

describe('ready-made WhatsApp messages', () => {
  it('fills in the contact’s first name, the business and the niche', () => {
    expect(fillTemplate('שלום {איש_קשר}, ראיתי את {שם_העסק} ({נישה}).', lead())).toBe('שלום אליהו, ראיתי את מספרת אליהו (מספרות).');
  });

  it('leaves out what the lead doesn’t have, without a stray space', () => {
    expect(fillTemplate('שלום {איש_קשר}, כאן סטודיו עומק.', lead({ contactName: '' }))).toBe('שלום, כאן סטודיו עומק.');
    expect(fillTemplate('שלום {איש_קשר}!', lead({ contactName: ' ' }))).toBe('שלום!');
  });

  it('picks the message for where the lead stands', () => {
    expect(templateFor(lead())).toBe('intro');
    expect(templateFor(lead({ activity: [step('no_answer')] }))).toBe('missed');
    expect(templateFor(lead({ activity: [step('answered'), step('no_answer')] }))).toBe('after-call');
    expect(templateFor(lead({ activity: [step('whatsapp')] }))).toBe('follow-up');
    expect(templateFor(lead({ stage: 'zoom' }))).toBe('quote');
    expect(templateFor(lead({ stage: 'closed' }))).toBe('follow-up');
  });

  it('has a template for every status, each naming no one it shouldn’t', () => {
    expect(DEFAULT_TEMPLATES.map((template) => template.id)).toEqual(['intro', 'missed', 'after-call', 'quote', 'follow-up']);
    for (const template of DEFAULT_TEMPLATES) expect(fillTemplate(template.text, lead())).not.toMatch(/[{}]/);
  });
});
