import { describe, expect, it } from 'vitest';
import { createDemoSearch } from '../data/sampleProspector';
import type { Prospect } from '../types';
import { canImport, isChecking, leadFromProspect, legacyLabel, siteFacts, targetCount, visibleProspects } from './prospects';

const { search, prospects } = createDemoSearch(Date.parse('2026-10-26T10:00:00Z'));
const named = (name: string) => prospects.find((item) => item.name === name)!;
const withScore = (prospect: Prospect, score: number | null, status: Prospect['analysis']['status'] = 'done'): Prospect => ({
  ...prospect,
  analysis: { ...prospect.analysis, score, status },
});

describe('the Prospector results', () => {
  it('shows the 4s and 5s first, then everything in score or Google order', () => {
    const targets = visibleProspects(prospects, 'targets', 'score');
    expect(targets.map((item) => item.analysis.score)).toEqual([5, 5, 5, 5, 4, 4, 4]);
    expect(targets).toHaveLength(targetCount(search));
    // Within a score, Google's order
    expect(targets.slice(0, 4).map((item) => item.position)).toEqual([0, 1, 2, 3]);

    const all = visibleProspects(prospects, 'all', 'google');
    expect(all.map((item) => item.position)).toEqual(prospects.map((_, index) => index));
    // Businesses without a score go last when sorted by score
    expect(visibleProspects(prospects, 'all', 'score').slice(-2).map((item) => item.analysis.score)).toEqual([null, null]);
  });

  it('knows what is still being checked and what can still be imported', () => {
    expect(isChecking(withScore(prospects[0], null, 'pending'))).toBe(true);
    expect(isChecking(withScore(prospects[0], null, 'scoring'))).toBe(true);
    expect(isChecking(named('מוסך שלום ובניו'))).toBe(false); // failed
    expect(canImport(prospects[0])).toBe(true);
    expect(canImport({ ...prospects[0], existingLeadId: 'lead-1' })).toBe(false);
    expect(canImport({ ...prospects[0], importedLeadId: 'lead-2' })).toBe(false);
  });

  it('turns what the check found into short facts, in Hebrew', () => {
    const old = named('מרכז שירות אלון').analysis.signals!;
    const facts = siteFacts(old, new Date('2026-10-26'));
    expect(facts.filter((fact) => fact.good === false).map((fact) => fact.label)).toEqual([
      'לא מותאם לנייד',
      'בלי HTTPS',
      'נטען ב-6.2 שניות',
      '© 2014',
      'אין כפתור חיוג או וואטסאפ',
      'אין הצהרת נגישות',
      'עימוד בטבלאות',
      'jQuery 1.8',
    ]);
    const modern = siteFacts(named('עפולה מוטורס').analysis.signals!, new Date('2026-10-26'));
    expect(modern.every((fact) => fact.good !== false)).toBe(true);
    expect(legacyLabel('legacy encoding (windows-1255)')).toBe('קידוד ישן (windows-1255)');
    expect(legacyLabel('WordPress 4.9')).toBe('WordPress 4.9');
  });

  it('makes a Cold Call lead with the analysis as its first note, the way the server does', () => {
    const lead = leadFromProspect(named('מרכז שירות אלון'), search, new Date('2026-10-26T12:00:00Z'));
    expect(lead).toMatchObject({
      name: 'מרכז שירות אלון',
      phone: '050-000-0805',
      website: 'alon-service.example',
      campaign: 'מוסכים · עפולה',
      stage: 'cold_call',
      method: 'call',
      attemptCount: 0,
      deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 },
    });
    expect(lead.approach.split('\n')[0]).toBe('ציון צורך 4/5: אתר מ-2014 שלא מותאם לנייד');
    const note = lead.notes[0].body.split('\n');
    expect(note[0]).toMatch(/^נמצא במאתר הלידים: מוסכים · עפולה \(\d+\.\d+\.2026\)$/);
    expect(note[1]).toBe('ציון צורך: 4/5 (מיושן מאוד) · אתר מ-2014 שלא מותאם לנייד');
    expect(note).toContain('• אין הצהרת נגישות');
    expect(note).toContain('אתר: alon-service.example (jQuery 1.8)');
    expect(note).toContain('בגוגל: ★4.4 · 64 ביקורות · מוסך');
    expect(leadFromProspect(named('מוסך האחים לוי'), search).notes[0].body).toContain('אתר: אין');
  });
});
