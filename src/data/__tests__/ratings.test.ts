import { describe, expect, it, vi } from 'vitest';

// ratings.ts тягне клієнт Supabase (для fetchRatingHistory); тут тестуємо
// лише чисті функції, тому клієнт підміняємо заглушкою.
vi.mock('../../app/supabaseClient', () => ({ supabase: {} }));

import { RATING_BASE, computeBalanceReport, computeRatings, ratingOf, sortHistory, spreadsOf, teamStrengthsOf, type MatchRecord, type TournamentSpreads } from '../ratings';
import { BUILTIN_BUFFS, RECOMMENDED_BUFFS_PCT, ratingBonus, rulesFor, type BalanceRules } from '../gearRules';
import type { BalanceStats, CharClass } from '../types';

const match = (over: Partial<MatchRecord>): MatchRecord => ({
  tournamentId: 't1', tournamentName: 'Тест', eventDate: '2026-09-16', bracketSide: 'winners', round: 1, slot: 0,
  teamA: 'Команда 1', teamB: 'Команда 2', membersA: ['A1', 'A2'], membersB: ['B1', 'B2'], totalA: 400, totalB: 390,
  strengthA: null, strengthB: null, winner: 'A', ...over,
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
  const spreads = new Map<string, TournamentSpreads>([['t1', { gear: 9, strength: null }]]);

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
    expect(rep.tournaments[0]).toMatchObject({ tournamentName: 'Тест', decided: 2, strongerWon: 1, ties: 1, avgDiff: 25, spread: 9, strengthSpread: null, byStrength: false });
  });

  it('коли у знімку є сила — «сильніша» за силою, а не за гіром; обидва розкиди в звіті окремо', () => {
    // за гіром сильніша A (400 > 390), за силою — B (410 < 430): бафи Танка й Приста в B
    const h = [match({ totalA: 400, totalB: 390, strengthA: 410, strengthB: 430, winner: 'B' })];
    const sp = new Map<string, TournamentSpreads>([['t1', { gear: 10, strength: 20 }]]);
    const rep = computeBalanceReport(h, sp, names);
    expect(rep.strongerWon).toBe(1);
    expect(rep.tournaments[0]).toMatchObject({ byStrength: true, spread: 10, strengthSpread: 20, avgDiff: 20 });
    // без сили той самий матч — перемога слабшої
    expect(computeBalanceReport([match({ totalA: 400, totalB: 390, winner: 'B' })], sp, names).strongerWon).toBe(0);
  });

  it('без матчів — winRate null', () => {
    expect(computeBalanceReport([], spreads, names).strongerWinRate).toBeNull();
  });
});

describe('сила зі знімка: teamStrengthsOf / spreadsOf', () => {
  // рулс із увімкненими бафами (реєстр у тестах знає лише вбудовану версію, де бафи вимкнені)
  const on: BalanceRules = { ...rulesFor().balance, buffs: { ...BUILTIN_BUFFS, enabled: true, pct: RECOMMENDED_BUFFS_PCT } };
  const m = (registrationId: string, charClass: CharClass, score: number) => ({ registrationId, nickname: registrationId, charClass, score, tier: 'B' as const });
  const stats: BalanceStats = {
    algoVersion: 'teams-ls-v5', rulesVersion: 'balance-v1.14', seed: 's', teamSize: 3, teamCount: 2, reservePolicy: 'latest', inputHash: 'h',
    players: [['a', 'archer', 250, 1, 0], ['c', 'cleric', 100, 0.2, 0.5], ['s', 'seeker', 150, 0.3, 0.1], ['w', 'wizard', 240, 1, 0], ['p', 'psychic', 160, 1, 0], ['m', 'mystic', 100, 0.2, 0.5], ['x', 'wizard', 100, 1, 0]],
    buffs: { enabled: true, source: 'party', kx: 'noKx', bySide: false },
    pairsRule: 'noSecondDd',
    formedAt: '2026-09-24T00:00:00Z', penalty: 0, bestPenalty: 0, candidates: 1,
    teams: [
      { name: 'Команда 1', total: 500, members: [m('a', 'archer', 250), m('c', 'cleric', 100), m('s', 'seeker', 150)] },
      { name: 'Команда 2', total: 500, members: [m('w', 'wizard', 240), m('p', 'psychic', 160), m('m', 'mystic', 100)] },
    ],
    reserve: [{ registrationId: 'x', nickname: 'x' }],
    substitutions: [],
  };

  it('рівний гір, різна сила: розкид гіру 0, розкид сили — з бафів (Лучник + Прист + Страж проти магів без бафера)', () => {
    const st = teamStrengthsOf(stats, on);
    expect(st.get('Команда 1')).toEqual({ total: 500, buff: 69.5, strength: 569.5 }); // те саме, що в balance.test.ts
    expect(st.get('Команда 2')!.buff).toBeCloseTo(0, 9); // Маг 1 % лише фізикам, Шаман/Містик 0 → Мага ніхто не бафає
    expect(spreadsOf(stats, on)).toEqual({ gear: 0, strength: 69.5 });
  });

  it('після заміни гравця сила зі знімка змінюється, а гір — ні (RPC 0022 оновлює склад, сила рахується при читанні)', () => {
    // Прист (100) не прийшов, замінили Магом (100) з резерву: Лучник втрачає 3 % від Приста, Страж — 16 % → 2 % від Мага
    const after: BalanceStats = { ...stats, teams: [{ ...stats.teams[0], members: [m('a', 'archer', 250), m('x', 'wizard', 100), m('s', 'seeker', 150)] }, stats.teams[1]] };
    const st = teamStrengthsOf(after, on);
    expect(st.get('Команда 1')!.total).toBe(500);
    expect(st.get('Команда 1')!.strength).toBeCloseTo(513.5, 9);
    expect(spreadsOf(after, on).strength).toBeCloseTo(13.5, 9);
    expect(spreadsOf(after, on).gear).toBe(0);
  });

  it('бафи не рахувались (стара жеребка або вимкнено) — сила null, гір як досі; без знімка — обидва null', () => {
    expect(spreadsOf({ ...stats, buffs: undefined }, on)).toEqual({ gear: 0, strength: null });
    expect(spreadsOf({ ...stats, buffs: { ...stats.buffs!, enabled: false } }, on)).toEqual({ gear: 0, strength: null });
    expect(spreadsOf(null)).toEqual({ gear: null, strength: null });
    expect(spreadsOf({ ...stats, teams: [] }, on)).toEqual({ gear: null, strength: null });
  });
});
