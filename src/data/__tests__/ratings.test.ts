import { describe, expect, it, vi } from 'vitest';

// ratings.ts тягне клієнт Supabase (для fetchRatingHistory); тут тестуємо
// лише чисті функції, тому клієнт підміняємо заглушкою.
vi.mock('../../app/supabaseClient', () => ({ supabase: {} }));

import { RATING_BASE, computeBalanceReport, computeRatings, ratingOf, sortHistory, type MatchRecord } from '../ratings';
import { ratingBonus, rulesFor } from '../gearRules';

const match = (over: Partial<MatchRecord>): MatchRecord => ({
  tournamentId: 't1', tournamentName: 'Тест', eventDate: '2026-09-16', bracketSide: 'winners', round: 1, slot: 0,
  teamA: 'Команда 1', teamB: 'Команда 2', membersA: ['A1', 'A2'], membersB: ['B1', 'B2'], totalA: 400, totalB: 390, winner: 'A', ...over,
});

describe('computeRatings (командне Ело)', () => {
  it('стартує з 1000; переможці отримують +16 при рівних рейтингах, програвші −16; нік без регістру', () => {
    const r = computeRatings([match({})]);
    expect(ratingOf(r, 'a1')!.rating).toBeCloseTo(RATING_BASE + 16, 6);
    expect(ratingOf(r, 'B2')!.rating).toBeCloseTo(RATING_BASE - 16, 6);
    expect(ratingOf(r, 'A1')!.games).toBe(1);
    expect(ratingOf(r, 'A1')!.wins).toBe(1);
    expect(ratingOf(r, 'B1')!.wins).toBe(0);
    expect(ratingOf(r, 'nobody')).toBeUndefined();
  });

  it('очікувана перемога сильнішої команди дає менше, ніж несподівана', () => {
    const first = match({ round: 1 });
    const upset = match({ round: 2, membersA: ['B1', 'B2'], membersB: ['A1', 'A2'], winner: 'A' }); // програвші раунду 1 виграють у переможців
    const r = computeRatings([first, upset]);
    // після раунду 1: A = 1016, B = 984; у раунді 2 B (984) виграє в A (1016) — дельта більша за 16
    expect(ratingOf(r, 'B1')!.rating).toBeGreaterThan(RATING_BASE);
    expect(ratingOf(r, 'B1')!.rating - 984).toBeGreaterThan(16);
  });

  it('порядок відтворення: дата → сітка (winners → losers → third → final) → раунд → слот; той самий результат незалежно від порядку входу', () => {
    const h = [
      match({ eventDate: '2026-09-20', tournamentId: 't2', round: 1 }),
      match({ eventDate: '2026-09-16', bracketSide: 'final', round: 1 }),
      match({ eventDate: '2026-09-16', round: 2 }),
      match({ eventDate: '2026-09-16', round: 1, slot: 1 }),
      match({ eventDate: '2026-09-16', round: 1, slot: 0 }),
    ];
    const sorted = sortHistory(h);
    expect(sorted.map((m) => `${m.eventDate}/${m.bracketSide}/${m.round}/${m.slot}`)).toEqual([
      '2026-09-16/winners/1/0', '2026-09-16/winners/1/1', '2026-09-16/winners/2/0', '2026-09-16/final/1/0', '2026-09-20/winners/1/0',
    ]);
    const a = computeRatings(h), b = computeRatings(h.slice().reverse());
    for (const nick of ['A1', 'B1']) expect(ratingOf(a, nick)!.rating).toBeCloseTo(ratingOf(b, nick)!.rating, 9);
  });

  it('матчі без складу (порожні команди) пропускаються', () => {
    const r = computeRatings([match({ membersA: [] })]);
    expect(r.size).toBe(0);
  });
});

describe('ratingBonus', () => {
  it('5 балів за 100 Ело, стеля ±20; без рейтингу — 0', () => {
    const r = rulesFor();
    expect(ratingBonus(undefined, r)).toBe(0);
    expect(ratingBonus(1000, r)).toBe(0);
    expect(ratingBonus(1100, r)).toBe(5);
    expect(ratingBonus(1016, r)).toBe(1);
    expect(ratingBonus(900, r)).toBe(-5);
    expect(ratingBonus(1900, r)).toBe(20);
    expect(ratingBonus(100, r)).toBe(-20);
    expect(ratingBonus(1500, { ...r, ratingWeight: 0 })).toBe(0);
  });
});

describe('computeBalanceReport', () => {
  const names = new Map([['t1', { name: 'Тест', eventDate: '2026-09-16' }]]);
  const spreads = new Map([['t1', 9]]);

  it('рахує перемоги сильнішої за сумою команди, нічиї за сумою і великі різниці', () => {
    const h = [
      match({ slot: 0, totalA: 400, totalB: 390, winner: 'A' }), // сильніша перемогла (2.5 % — мала різниця)
      match({ slot: 1, totalA: 380, totalB: 420, winner: 'A' }), // слабша перемогла (10 % — велика різниця)
      match({ slot: 2, totalA: 400, totalB: 400, winner: 'B' }), // нічия за сумою
      match({ slot: 3, totalA: null, totalB: 390, winner: 'B' }), // без сум — не рахується
    ];
    const rep = computeBalanceReport(h, spreads, names);
    expect(rep.decided).toBe(2);
    expect(rep.strongerWon).toBe(1);
    expect(rep.ties).toBe(1);
    expect(rep.strongerWinRate).toBeCloseTo(0.5, 6);
    expect(rep.bigDiffDecided).toBe(1);
    expect(rep.bigDiffStrongerWon).toBe(0);
    expect(rep.tournaments).toHaveLength(1);
    expect(rep.tournaments[0]).toMatchObject({ tournamentName: 'Тест', decided: 2, strongerWon: 1, ties: 1, avgDiff: 25, spread: 9 });
  });

  it('без матчів — winRate null', () => {
    expect(computeBalanceReport([], spreads, names).strongerWinRate).toBeNull();
  });
});
