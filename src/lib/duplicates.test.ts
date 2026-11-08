import { describe, expect, it } from 'vitest';
import type { DeletedLead, Lead } from '../types';
import { duplicateFinder } from './duplicates';

const lead = (id: string, details: Partial<Lead>) => ({ id, name: id, phone: '', email: '', website: '', archivedAt: null, ...details }) as Lead;
const gone = (id: string, details: Partial<DeletedLead>): DeletedLead => ({
  id,
  name: id,
  phone: '',
  email: '',
  website: '',
  city: '',
  mapsUrl: '',
  deletedAt: '2026-11-06T23:30:00.000Z',
  ...details,
});

describe('duplicateFinder', () => {
  const find = duplicateFinder(
    [
      lead('here', { name: 'THE MODERN MAN - barberia', phone: '052-521-0652', city: 'טבריה' }),
      lead('archived', { name: 'מספרת אבי', phone: '050-111-1111', archivedAt: '2026-10-01T09:00:00.000Z' }),
    ],
    [gone('was', { name: 'Barber Shop', phone: '054-333-3333', city: 'ירושלים' }), gone('again', { name: 'מספרת אבי', phone: '050-111-1111' })],
  );

  it('finds the lead a business already is, however its number was typed', () => {
    expect(find({ name: 'מספרה חדשה', phone: '+972 52 521 0652' })).toEqual({
      id: 'here',
      name: 'THE MODERN MAN - barberia',
      city: 'טבריה',
      phone: '052-521-0652',
      deleted: false,
      deletedAt: null,
      archived: false,
      by: 'phone',
      shared: 'אותו מספר טלפון',
    });
    expect(find({ name: 'The Modern Man Barberia', city: 'טבריה' })).toMatchObject({ id: 'here', by: 'name', shared: 'אותו שם ועיר' });
  });

  it('says a business was deleted, and when', () => {
    expect(find({ name: 'barber-shop', city: 'ירושלים' })).toMatchObject({ id: 'was', deleted: true, deletedAt: '2026-11-06T23:30:00.000Z', by: 'name' });
    expect(find({ name: 'x', phone: '0543333333' })).toMatchObject({ id: 'was', deleted: true, shared: 'אותו מספר טלפון' });
  });

  it('prefers the lead in the CRM, and says when it is marked not relevant', () => {
    expect(find({ name: 'x', phone: '050-1111111' })).toMatchObject({ id: 'archived', deleted: false, archived: true });
  });

  it('finds nothing for a new business, or for an empty form', () => {
    expect(find({ name: 'עסק חדש', phone: '053-000-0000' })).toBeNull();
    expect(find({ name: 'Barber Shop', city: 'תל אביב' })).toBeNull();
    expect(find({ name: '  ' })).toBeNull();
  });
});
