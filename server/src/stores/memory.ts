import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  freshPractice,
  newLeadState,
  notesAsInteractions,
  splitById,
  type CoachingRecord,
  type InteractionRecord,
  type LatestEntries,
  type LeadRecord,
  type MediaRecord,
  type NewInteraction,
  type ObjectionCardRecord,
  type ObjectionVariantRecord,
  type Stores,
  type TrainingRunRecord,
  type WhatsAppChatRecord,
} from './types.js';
import type { ProspectRecord, ProspectSearchRecord } from '../prospector/types.js';
import { sameWording, wordingOf } from '../training/starter.js';

const newestFirst = (a: { createdAt: Date }, b: { createdAt: Date }) => b.createdAt.getTime() - a.createdAt.getTime();

/** Never returns the same updatedAt twice, like a database write would. */
let lastStamp = 0;
function stamp(): Date {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp);
}

/** In-memory stores that behave like the Prisma ones. Used by the tests and by STORAGE=memory for local development. */
export function createMemoryStores(): Stores {
  const leads = new Map<string, LeadRecord>();
  const interactions = new Map<string, InteractionRecord>();
  const media = new Map<string, MediaRecord>();
  const reports: CoachingRecord[] = [];
  const sessions = new Map<string, { id: string; expiresAt: Date }>();
  const queues = new Map<string, { leadIds: string[]; version: number }>();
  const chats = new Map<string, WhatsAppChatRecord>();
  const auth = new Map<string, string>();
  const cards = new Map<string, ObjectionCardRecord>();
  const runs: TrainingRunRecord[] = [];
  const variants = new Map<string, ObjectionVariantRecord>();
  const searches = new Map<string, ProspectSearchRecord>();
  const prospects = new Map<string, ProspectRecord>();

  const copy = <T>(value: T): T => structuredClone(value);
  const save = (lead: LeadRecord) => {
    const next = { ...lead, updatedAt: stamp() };
    leads.set(lead.id, next);
    return copy(next);
  };
  const addInteraction = (record: NewInteraction) => {
    const existing = interactions.get(record.id);
    if (existing) return copy(existing);
    const next: InteractionRecord = { ...record, source: record.source ?? null, chat: record.chat ?? [], updatedAt: stamp() };
    interactions.set(record.id, next);
    return copy(next);
  };
  const byLeadCountThenMentions = (a: ObjectionCardRecord, b: ObjectionCardRecord) =>
    b.leadCount - a.leadCount || b.mentions - a.mentions || a.createdAt.getTime() - b.createdAt.getTime();

  return {
    leads: {
      async list() {
        return [...leads.values()].sort(newestFirst).map(copy);
      },
      async get(id) {
        const lead = leads.get(id);
        return lead ? copy(lead) : null;
      },
      async create(input) {
        if (leads.has(input.id)) throw new ConflictError('כבר קיים ליד עם המזהה הזה.');
        notesAsInteractions(input).forEach(addInteraction);
        return save({ ...newLeadState(input, new Date()), updatedAt: new Date() });
      },
      async createMany(inputs) {
        const { fresh, skippedIds } = splitById(inputs, new Set(leads.keys()));
        const now = new Date();
        const created = fresh.map((input) => {
          notesAsInteractions(input).forEach(addInteraction);
          return save({ ...newLeadState(input, now), updatedAt: now });
        });
        return { created: created.sort(newestFirst), skippedIds };
      },
      async update(id, patch) {
        const lead = leads.get(id);
        return lead ? save({ ...lead, ...patch }) : null;
      },
      async saveWorkflow(id, expectedUpdatedAt, state) {
        const lead = leads.get(id);
        if (!lead || lead.updatedAt.getTime() !== expectedUpdatedAt.getTime()) return null;
        return save({ ...lead, ...state });
      },
      async removeMany(ids) {
        for (const id of ids) leads.delete(id);
      },
      async poolCandidates() {
        return [...leads.values()]
          .filter((lead) => lead.stage === 'cold_call')
          .map(({ id, archivedAt, lastAttemptAt, activity }) => ({
            id,
            archivedAt,
            lastAttemptAt,
            answered: activity.some((entry) => entry.type === 'answered'),
          }));
      },
      async ping() {},
    },
    interactions: {
      async list(leadId) {
        // Newest first; entries logged at the same moment keep the later one first, like the Prisma store.
        return [...interactions.values()]
          .filter((item) => item.leadId === leadId)
          .reverse()
          .sort((a, b) => b.at.getTime() - a.at.getTime())
          .map(copy);
      },
      async create(record) {
        return addInteraction(record);
      },
      async createMany(records) {
        records.forEach(addInteraction);
      },
      async get(leadId, id) {
        const item = interactions.get(id);
        return item && item.leadId === leadId ? copy(item) : null;
      },
      async update(leadId, id, change, expectedUpdatedAt) {
        const item = interactions.get(id);
        if (!item || item.leadId !== leadId) return null;
        if (expectedUpdatedAt && item.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
          throw new ConflictError('הרשומה השתנתה בזמן שערכת אותה.');
        }
        const next = { ...item, ...change, updatedAt: stamp() };
        interactions.set(id, next);
        return copy(next);
      },
      async appendBody(leadId, id, text) {
        const item = interactions.get(id);
        if (!item || item.leadId !== leadId) return null;
        if (item.body.includes(text)) return copy(item);
        const body = item.body.trim() ? `${item.body.trimEnd()}\n\n${text}` : text;
        const next = { ...item, body, updatedAt: stamp() };
        interactions.set(id, next);
        return copy(next);
      },
      async remove(leadId, id) {
        if (interactions.get(id)?.leadId === leadId) interactions.delete(id);
      },
      async removeForLeads(leadIds) {
        for (const [id, item] of interactions) if (leadIds.includes(item.leadId)) interactions.delete(id);
      },
      async writeChat(leadId, id, change) {
        const found = interactions.get(id);
        const current = found && found.leadId === leadId ? copy(found) : null;
        const next = change(current);
        if (!next) return current;
        const record: InteractionRecord = current
          ? { ...current, chat: copy(next.chat), body: next.body, at: next.at, updatedAt: stamp() }
          : { ...next.create, source: 'whatsapp', chat: copy(next.chat), body: next.body, at: next.at, updatedAt: stamp() };
        interactions.set(id, record);
        return copy(record);
      },
      async findChatEntry(leadId, messageId) {
        for (const item of interactions.values()) {
          if (item.leadId === leadId && item.chat.some((line) => line.id === messageId)) return copy(item);
        }
        return null;
      },
      async oldestChat(leadId) {
        const found = [...interactions.values()]
          .filter((item) => item.leadId === leadId && item.source === 'whatsapp')
          .sort((a, b) => a.at.getTime() - b.at.getTime())[0];
        return found ? copy(found) : null;
      },
      async latestByLead(leadIds) {
        const wanted = new Set(leadIds);
        const found = new Map<string, LatestEntries>();
        for (const item of [...interactions.values()].sort((a, b) => b.at.getTime() - a.at.getTime())) {
          if (!wanted.has(item.leadId)) continue;
          const known = found.get(item.leadId);
          if (!known) found.set(item.leadId, { last: { at: item.at, kind: item.kind, outcome: item.outcome }, zoom: item.kind === 'zoom' ? { at: item.at, outcome: item.outcome } : null });
          else if (!known.zoom && item.kind === 'zoom') known.zoom = { at: item.at, outcome: item.outcome };
        }
        return found;
      },
    },
    media: {
      async list(leadId) {
        return [...media.values()].filter((item) => item.leadId === leadId).sort(newestFirst).map(copy);
      },
      async get(id) {
        const item = media.get(id);
        return item ? copy(item) : null;
      },
      async create(record) {
        const item = { ...record, createdAt: new Date() };
        media.set(record.id, item);
        return copy(item);
      },
      async detach(interactionId) {
        for (const item of media.values()) if (item.interactionId === interactionId) item.interactionId = null;
      },
      async attach(id, interactionId) {
        const item = media.get(id);
        if (item) item.interactionId = interactionId;
      },
      async setTranscription(id, transcription) {
        const item = media.get(id);
        if (!item) return null;
        item.transcription = transcription ? copy(transcription) : null;
        return copy(item);
      },
      async pendingTranscriptions() {
        return [...media.values()]
          .filter((item) => item.transcription?.status === 'queued' || item.transcription?.status === 'running')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(copy);
      },
      async remove(id) {
        media.delete(id);
      },
      async removeForLeads(leadIds) {
        const removed = [...media.values()].filter((item) => leadIds.includes(item.leadId));
        for (const item of removed) media.delete(item.id);
        return removed;
      },
    },
    coaching: {
      async latest(leadId) {
        const found = reports.filter((report) => report.leadId === leadId).sort(newestFirst)[0];
        return found ? copy(found) : null;
      },
      async latestForLeads(leadIds) {
        const wanted = new Set(leadIds);
        const found = new Map<string, CoachingRecord>();
        for (const report of [...reports].sort(newestFirst)) {
          if (wanted.has(report.leadId) && !found.has(report.leadId)) found.set(report.leadId, copy(report));
        }
        return found;
      },
      async create(record) {
        const report = { ...record, id: randomUUID(), createdAt: stamp() };
        reports.push(report);
        return copy(report);
      },
      async removeForLeads(leadIds) {
        for (let i = reports.length - 1; i >= 0; i--) if (leadIds.includes(reports[i].leadId)) reports.splice(i, 1);
      },
    },
    daily: {
      async find(date) {
        const queue = queues.get(date);
        return queue ? copy(queue) : null;
      },
      async create(date, leadIds) {
        if (queues.has(date)) return false;
        queues.set(date, { leadIds: [...leadIds], version: 0 });
        return true;
      },
      async extend(date, version, leadIds) {
        const queue = queues.get(date);
        if (!queue || queue.version !== version) return false;
        queues.set(date, { leadIds: [...leadIds], version: version + 1 });
        return true;
      },
    },
    whatsapp: {
      async saveChats(list) {
        for (const chat of list) {
          const seen = chats.get(chat.jid);
          if (!seen || seen.lastAt < chat.lastAt) chats.set(chat.jid, { ...chat, phone: chat.phone ?? seen?.phone ?? null });
          else if (chat.phone && !seen.phone) seen.phone = chat.phone;
        }
      },
      async findChatsByPhone(phones) {
        return [...chats.values()]
          .filter((chat) => chat.phone !== null && phones.includes(chat.phone))
          .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())
          .map(copy);
      },
      async readAuth(ids) {
        return new Map(ids.filter((id) => auth.has(id)).map((id) => [id, auth.get(id)!]));
      },
      async writeAuth(entries) {
        for (const { id, value } of entries) {
          if (value === null) auth.delete(id);
          else auth.set(id, value);
        }
      },
      async clearAuth() {
        auth.clear();
      },
    },
    training: {
      async cards() {
        return [...cards.values()].sort(byLeadCountThenMentions).map(copy);
      },
      async card(id) {
        const card = cards.get(id);
        return card ? copy(card) : null;
      },
      async saveRun(drafts, run, now) {
        const byKey = new Map([...cards.values()].map((card) => [card.key, card]));
        for (const draft of drafts) {
          const old = byKey.get(draft.key);
          const card: ObjectionCardRecord = old
            ? { ...old, ...copy(draft), retired: false, updatedAt: stamp() }
            : { id: randomUUID(), ...copy(draft), myResponse: '', practice: freshPractice(now), retired: false, createdAt: now, updatedAt: stamp() };
          cards.set(card.id, card);
        }
        const keys = new Set(drafts.map((draft) => draft.key));
        for (const card of cards.values()) if (!keys.has(card.key) && !card.retired) cards.set(card.id, { ...card, retired: true, updatedAt: stamp() });
        const record = { ...run, id: randomUUID(), createdAt: stamp() };
        runs.push(record);
        return copy(record);
      },
      async latestRun() {
        const run = runs.at(-1);
        return run ? copy(run) : null;
      },
      async updateCard(id, change) {
        const card = cards.get(id);
        if (!card) return null;
        const next = { ...card, ...copy(change), updatedAt: stamp() };
        cards.set(id, next);
        return copy(next);
      },
      async removeLeadSources(leadIds) {
        for (const card of cards.values()) {
          const sources = card.sources.filter((source) => !leadIds.includes(source.leadId));
          if (sources.length === card.sources.length) continue;
          cards.set(card.id, { ...card, sources, leadCount: new Set(sources.map((source) => source.leadId)).size, mentions: sources.length });
        }
      },
      async rewordCommon(common) {
        const byKey = new Map(common.map((card) => [card.key, card]));
        const reworded: string[] = [];
        for (const card of cards.values()) {
          const starter = byKey.get(card.key);
          if (!starter || card.leadCount > 0 || sameWording(card, starter)) continue;
          cards.set(card.id, { ...card, ...wordingOf(starter), updatedAt: stamp() });
          reworded.push(card.key);
        }
        for (const [id, variant] of variants) if (reworded.includes(variant.cardKey)) variants.delete(id);
        return reworded;
      },
      async variants(niche) {
        return [...variants.values()].filter((variant) => variant.niche === niche).map(copy);
      },
      async saveVariants(niche, drafts, by) {
        for (const [id, variant] of variants) if (variant.niche === niche.key) variants.delete(id);
        const now = stamp();
        const saved = drafts.map((draft): ObjectionVariantRecord => ({
          id: randomUUID(),
          niche: niche.key,
          label: niche.label,
          ...copy(draft),
          ...by,
          createdAt: now,
          updatedAt: now,
        }));
        for (const variant of saved) variants.set(variant.id, variant);
        return saved.map(copy);
      },
      async tailoredNiches() {
        const found = new Map<string, { niche: string; label: string; cards: number; updatedAt: Date }>();
        for (const variant of variants.values()) {
          const known = found.get(variant.niche);
          if (!known) found.set(variant.niche, { niche: variant.niche, label: variant.label, cards: 1, updatedAt: variant.updatedAt });
          else {
            known.cards += 1;
            if (variant.updatedAt > known.updatedAt) known.updatedAt = variant.updatedAt;
          }
        }
        return [...found.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map(copy);
      },
    },
    prospector: {
      async createSearch(record) {
        const now = stamp();
        const search = { ...copy(record), createdAt: now, updatedAt: now };
        searches.set(search.id, search);
        return copy(search);
      },
      async getSearch(id) {
        const search = searches.get(id);
        return search ? copy(search) : null;
      },
      async listSearches(limit) {
        return [...searches.values()].sort(newestFirst).slice(0, limit).map(copy);
      },
      async updateSearch(id, change) {
        const search = searches.get(id);
        if (!search) return null;
        const next = { ...search, ...copy(change), updatedAt: stamp() };
        searches.set(id, next);
        return copy(next);
      },
      async unfinishedSearches() {
        return [...searches.values()]
          .filter((search) => search.status === 'discovering' || search.status === 'analyzing')
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(copy);
      },
      async searchesBefore(before) {
        return [...searches.values()]
          .filter((search) => search.createdAt < before)
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
          .map(copy);
      },
      async removeSearch(id) {
        searches.delete(id);
        const keys: string[] = [];
        for (const prospect of [...prospects.values()]) {
          if (prospect.searchId !== id) continue;
          if (prospect.analysis.screenshotKey) keys.push(prospect.analysis.screenshotKey);
          prospects.delete(prospect.id);
        }
        return keys;
      },
      async addProspects(records) {
        const taken = new Set([...prospects.values()].map((prospect) => `${prospect.searchId}:${prospect.placeId}`));
        for (const record of records) {
          const key = `${record.searchId}:${record.placeId}`;
          if (taken.has(key)) continue;
          taken.add(key);
          const now = stamp();
          prospects.set(record.id, { ...copy(record), createdAt: now, updatedAt: now });
        }
      },
      async listProspects(searchId) {
        return [...prospects.values()].filter((prospect) => prospect.searchId === searchId).sort((a, b) => a.position - b.position).map(copy);
      },
      async getProspect(id) {
        const prospect = prospects.get(id);
        return prospect ? copy(prospect) : null;
      },
      async getProspects(ids) {
        return ids.flatMap((id) => {
          const prospect = prospects.get(id);
          return prospect ? [copy(prospect)] : [];
        });
      },
      async setAnalysis(id, analysis) {
        const prospect = prospects.get(id);
        if (!prospect) return null;
        const next = { ...prospect, analysis: copy(analysis), updatedAt: stamp() };
        prospects.set(id, next);
        return copy(next);
      },
      async setExistingLead(id, leadId) {
        const prospect = prospects.get(id);
        if (prospect) prospects.set(id, { ...prospect, existingLeadId: leadId, updatedAt: stamp() });
      },
      async markImported(id, leadId, at) {
        const prospect = prospects.get(id);
        if (prospect) prospects.set(id, { ...prospect, importedLeadId: leadId, importedAt: at, updatedAt: stamp() });
      },
      async recentAnalysis(domain, since, excludeId) {
        const found = [...prospects.values()]
          .filter(
            (prospect) =>
              prospect.id !== excludeId &&
              prospect.domain === domain &&
              prospect.analysis.status === 'done' &&
              prospect.analysis.analyzedAt !== null &&
              prospect.analysis.analyzedAt >= since,
          )
          .sort((a, b) => (b.analysis.analyzedAt?.getTime() ?? 0) - (a.analysis.analyzedAt?.getTime() ?? 0));
        return found[0] ? copy(found[0]) : null;
      },
    },
    sessions: {
      async create(session) {
        sessions.set(session.tokenHash, { id: randomUUID(), expiresAt: session.expiresAt });
      },
      async findByTokenHash(tokenHash) {
        const session = sessions.get(tokenHash);
        return session ? { ...session } : null;
      },
      async extend(id, expiresAt) {
        for (const session of sessions.values()) if (session.id === id) session.expiresAt = expiresAt;
      },
      async deleteByTokenHash(tokenHash) {
        sessions.delete(tokenHash);
      },
      async deleteExpired(now) {
        for (const [tokenHash, session] of sessions) if (session.expiresAt < now) sessions.delete(tokenHash);
      },
    },
  };
}
