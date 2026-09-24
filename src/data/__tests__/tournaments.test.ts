import { describe, expect, it, vi } from 'vitest';

// tournaments.ts тягне клієнт Supabase; тут лише чиста функція.
vi.mock('../../app/supabaseClient', () => ({ supabase: {} }));

import { likePattern } from '../tournaments';
import { isPastTournament } from '../types';

describe('likePattern (екранування ніка для ilike)', () => {
  it('«_», «%», «\\» і «*» стають літералами, решта — без змін', () => {
    expect(likePattern('Dark_Lord')).toBe('Dark\\_Lord');
    expect(likePattern('100%')).toBe('100\\%');
    expect(likePattern('a\\b')).toBe('a\\\\b');
    expect(likePattern('*Star*')).toBe('\\*Star\\*');
    expect(likePattern('Тайфорн')).toBe('Тайфорн');
    expect(likePattern('')).toBe('');
  });
});

describe('isPastTournament (що гість бачить без входу)', () => {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const tomorrow = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

  it('завершений і скасований — минулі, хоч би й із майбутньою датою', () => {
    expect(isPastTournament({ status: 'completed', eventDate: tomorrow })).toBe(true);
    expect(isPastTournament({ status: 'cancelled', eventDate: tomorrow })).toBe(true);
  });

  it('дата минула, а статус не перевели — теж минулий; «Триває» — ні', () => {
    expect(isPastTournament({ status: 'registration_closed', eventDate: yesterday })).toBe(true);
    expect(isPastTournament({ status: 'registration_open', eventDate: yesterday })).toBe(true);
    expect(isPastTournament({ status: 'in_progress', eventDate: yesterday })).toBe(false);
  });

  it('сьогоднішній і майбутній — поточні', () => {
    expect(isPastTournament({ status: 'registration_open', eventDate: iso(today) })).toBe(false);
    expect(isPastTournament({ status: 'registration_closed', eventDate: tomorrow })).toBe(false);
  });
});
