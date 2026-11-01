import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STARTER_KEYS } from '../../server/src/training/starter';
import { createLocalRepository } from '../data/repository/local';
import { createSampleData } from '../data/sampleLeads';
import { createStarterDeck } from '../data/starterDeck';
import type { Lead, NewLead } from '../types';
import { eligibleForDraw } from './daily';
import { dueCards } from './practice';
import { recordingKind, recordingProblem } from './media';
import { describeTimeline, looseMedia } from './timeline';
import { applyAction, entryAfterUndo, timelineEntryFor, wasAnswered } from './workflow';

const NOW = new Date('2026-10-22T09:00:00');
const sample = createSampleData(NOW.getTime());
const leadNamed = (name: string) => sample.leads.find((lead) => lead.name === name)!;
const timelineOf = (lead: Lead) =>
  sample.interactions.filter((entry) => entry.leadId === lead.id).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

describe('the timeline', () => {
  it('numbers phone calls as attempts and names every other entry, like the coach sees them', () => {
    const hadar = leadNamed('הדר נדל"ן');
    const titles = describeTimeline(timelineOf(hadar)).map((item) => item.title);
    expect(titles).toEqual([
      'הערה',
      'ניסיון 3: ענה',
      'הודעת וואטסאפ',
      'פגישת זום: הליד לא הגיע',
      'ניסיון 2: ענה ← פגישת זום',
      'ניסיון 1: אין מענה',
    ]);
    // The sample analysis quotes these entries by name.
    const analysis = JSON.stringify(sample.coaching.find((report) => report.leadId === hadar.id)?.analysis);
    for (const name of ['ניסיון 2', 'ניסיון 3', 'פגישת זום: הליד לא הגיע']) expect(analysis).toContain(name);
  });

  it('builds sample leads whose workflow matches their timeline', () => {
    const hadar = leadNamed('הדר נדל"ן');
    expect(hadar).toMatchObject({ stage: 'zoom', attemptCount: 2, archivedAt: null });
    expect(hadar.lastAttemptAt).toBe(timelineOf(hadar).find((entry) => entry.step === 'answered')?.at);
    const dairy = leadNamed('מחלבת משפחת לוי');
    expect(dairy).toMatchObject({ stage: 'closed', deal: { setupFee: 13500, monthlyRetainer: 600, hostingYearly: 900 } });
    expect(timelineOf(dairy).map((entry) => entry.kind)).toEqual(['note', 'zoom', 'call']);
    expect(leadNamed('מרפאת השיניים זוהר').archivedAt).not.toBeNull();
  });

  it('starts the objection deck with the common cold-call objections, the same cards the server starts with', () => {
    const deck = createStarterDeck(NOW.getTime());
    expect(deck.run).toMatchObject({ provider: 'starter', cards: STARTER_KEYS.length });
    expect(deck.cards.map((card) => card.key)).toEqual(STARTER_KEYS);
    expect(deck.cards[0]).toMatchObject({ objection: 'יש לי כבר אתר.', leadCount: 0, sources: [], practice: { box: 1 } });
    // Every card is ready to practise, with an answer, other ways to answer and a question to ask next
    expect(dueCards(deck.cards, NOW.getTime())).toHaveLength(STARTER_KEYS.length);
    for (const card of deck.cards) {
      expect(card.response.length).toBeGreaterThan(40);
      expect(card.alternatives.length).toBeGreaterThanOrEqual(2);
      expect(card.followUp).toMatch(/\?$/);
    }
  });

  it('turns a step into a call or a Zoom meeting, and keeps its notes when undone', () => {
    const lead: Lead = { ...leadNamed('סטקיית הגולן') };
    const zoom = applyAction(lead, { id: 's1', type: 'advance', from: 'cold_call' }, NOW);
    expect(timelineEntryFor(zoom.activity[0], lead.id, ' Booked for Sunday ')).toMatchObject({
      id: 's1', kind: 'call', outcome: 'answered', step: 'advanced', stage: 'cold_call', stageTo: 'zoom', body: 'Booked for Sunday',
    });
    const noShow = applyAction(zoom, { id: 's2', type: 'no_answer', from: 'zoom' }, NOW);
    expect(timelineEntryFor(noShow.activity[0], lead.id)).toMatchObject({ kind: 'zoom', outcome: 'no_show' });
    expect(timelineEntryFor(noShow.activity[0], lead.id, '', 'call')).toMatchObject({ kind: 'call', outcome: 'no_answer' });

    const entry = timelineEntryFor(zoom.activity[0], lead.id, 'Wants an online shop.');
    expect(entryAfterUndo(entry, false)).toMatchObject({ kind: 'note', step: null, outcome: null, stageTo: null, body: 'Wants an online shop.' });
    expect(entryAfterUndo({ ...entry, body: '' }, false)).toBeNull();
    expect(entryAfterUndo({ ...entry, body: '' }, true)).toMatchObject({ kind: 'note' });
  });

  it('keeps leads that picked up out of the random draw', () => {
    const lead: Lead = { ...leadNamed('סטקיית הגולן') };
    const talked = applyAction(lead, { id: 't1', type: 'answered', from: 'cold_call' }, new Date('2026-10-20T10:00:00'));
    expect(talked).toMatchObject({ stage: 'cold_call', attemptCount: 0 });
    expect(wasAnswered(talked)).toBe(true);
    expect(eligibleForDraw([lead, talked], NOW, new Set())).toEqual([lead.id]);
  });

  it('shows recordings without a timeline entry on the lead itself', () => {
    const files = [
      { id: 'm1', leadId: 'l', interactionId: 'gone', kind: 'audio', fileName: 'a.mp3', mimeType: 'audio/mpeg', size: 1, transcription: null, createdAt: '' },
      { id: 'm2', leadId: 'l', interactionId: null, kind: 'video', fileName: 'b.mp4', mimeType: 'video/mp4', size: 1, transcription: null, createdAt: '' },
      { id: 'm3', leadId: 'l', interactionId: 'kept', kind: 'audio', fileName: 'c.m4a', mimeType: 'audio/mp4', size: 1, transcription: null, createdAt: '' },
    ] as const;
    const entries = [{ ...sample.interactions[0], id: 'kept' }];
    expect(looseMedia([...files], entries).map((file) => file.id)).toEqual(['m1', 'm2']);
    expect(describeTimeline(entries, [...files])[0].media.map((file) => file.id)).toEqual(['m3']);
  });

  it('accepts call and Zoom recordings and nothing else', () => {
    const file = (name: string, type: string, size = 1000) => new File([new Uint8Array(size)], name, { type });
    expect(recordingKind(file('call.m4a', 'audio/x-m4a'))).toBe('audio');
    expect(recordingKind(file('zoom.mp4', ''))).toBe('video');
    expect(recordingKind(file('voice.opus', 'application/octet-stream'))).toBe('audio');
    expect(recordingKind(file('page.html', 'text/html'))).toBeNull();
    expect(recordingKind(file('fake.mp3', 'text/html'))).toBeNull();
    expect(recordingProblem(file('long.mp3', 'audio/mpeg', 2 * 1024 * 1024), 1)).toMatch(/גדול מ-1 MB/);
  });
});

describe('the objection deck kept in this browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('replaces the sample deck an earlier version saved with the starter deck, and keeps a deck you practised', async () => {
    const items = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => void items.set(key, value),
        removeItem: (key: string) => void items.delete(key),
      },
    });
    const old = { run: { id: 'sample-run', provider: 'sample' }, cards: [{ id: 'sample-card-0', objection: 'עשרים אלף זה הרבה בשביל אתר.' }] };
    items.set('omek-crm:training:v1', JSON.stringify(old));
    const repository = createLocalRepository();
    const deck = await repository.trainingDeck();
    expect(deck.run?.provider).toBe('starter');
    expect(deck.cards.map((card) => card.key)).toEqual(STARTER_KEYS);

    const practised = await repository.reviewCard(deck.cards[0].id, 3);
    expect(practised.practice.box).toBe(2);
    expect((await createLocalRepository().trainingDeck()).cards[0].practice.box).toBe(2);
  });
});

describe('leads kept in this browser', () => {
  let repository = createLocalRepository();
  beforeEach(() => {
    repository = createLocalRepository();
  });

  it('starts with the sample timelines and the sample analysis', async () => {
    const leads = await repository.list();
    const hadar = leads.find((lead) => lead.name === 'הדר נדל"ן')!;
    const profile = await repository.timeline(hadar.id);
    expect(profile.interactions).toHaveLength(6);
    expect(profile.coaching).toMatchObject({ provider: 'sample', analysis: { dealHealth: 'stalled' } });
  });

  it('logs steps with notes, keeps the notes when a step is undone, and deletes everything with the lead', async () => {
    const now = new Date().toISOString();
    const lead: NewLead = {
      id: 'local-1', name: 'Tiberias Bakery', contactName: '', phone: '', email: '', website: '', campaign: 'Food', approach: '',
      method: 'call', stage: 'cold_call', stageChangedAt: now, archivedAt: null, attemptCount: 0, lastAttemptAt: null,
      deal: { setupFee: 0, monthlyRetainer: 0, hostingYearly: 0 }, currency: 'ILS', activity: [], createdAt: now, updatedAt: now,
      notes: [{ id: 'n1', body: 'From the market list.', createdAt: now }],
    };
    expect(await repository.create(lead)).not.toHaveProperty('notes');
    await repository.act(lead.id, { id: 'c1', type: 'no_answer', from: 'cold_call' });
    await repository.act(lead.id, { id: 'c2', type: 'advance', from: 'cold_call' }, { body: 'Wants Shabbat pre-orders.' });
    let profile = await repository.timeline(lead.id);
    expect(describeTimeline(profile.interactions).map((item) => item.title)).toEqual([
      'ניסיון 2: ענה ← פגישת זום',
      'ניסיון 1: אין מענה',
      'הערה',
    ]);

    await repository.undo(lead.id, 'c2');
    profile = await repository.timeline(lead.id);
    expect(profile.interactions[0]).toMatchObject({ id: 'c2', kind: 'note', body: 'Wants Shabbat pre-orders.' });
    await expect(repository.removeInteraction(lead.id, 'c1')).rejects.toThrow(/צעד במשפך/);

    const media = await repository.uploadMedia(lead.id, new File([new Uint8Array(64)], 'call.mp3', { type: 'audio/mpeg' }), {
      interactionId: 'c1',
    });
    const url = await repository.mediaSource(media);
    expect(url).toMatch(/^blob:/);
    repository.releaseMediaSource(url);
    await expect(
      repository.uploadMedia(lead.id, new File(['<html>'], 'page.html', { type: 'text/html' }), { interactionId: null }),
    ).rejects.toThrow(/לא הקלטת אודיו או וידאו/);

    await repository.remove(lead.id);
    await expect(repository.timeline(lead.id)).rejects.toThrow(/כבר לא קיים/);
    await expect(repository.mediaSource(media)).rejects.toThrow(/כבר לא שמורה/);
  });
});
