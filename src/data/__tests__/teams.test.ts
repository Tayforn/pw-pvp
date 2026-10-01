// =========================================================
// teams.ts: скор заявки для жеребки/адмінки — registrationScore (бали за речі
// v2, коли є; інакше таблиця анкети), корекція адміна й Ело поверх; старий
// блок dollScore у версії шкали (скор з еталонів, прибрано) нічого не змінює.
// Плюс помічники «не перевірено» (checked) для блокування жеребки й бейджа «таблиця».
// Supabase — заглушка (клієнт потрібен лише RPC/select, яких тут не кличемо).
// =========================================================

import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('../../app/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));

import { BUILTIN_RULES_VERSION, classPointsFor, computeGearScoreWith, normalizeRules, registerRules, rulesFor } from '../gearRules';
import type { PlayerRating } from '../ratings';
import { hasItemPointsRows, isUnverifiedV2, playerScore, playersForBalance, scoreBreakdown, unverifiedForBalance } from '../teams';
import type { ItemBreakdown, PlayerGear, Registration, Tournament } from '../types';

const GEAR: PlayerGear = {
  charClass: 'archer', charLevel: 'l104', build: 'dd', weaponGrade: 'r9r2', weaponRefine: 'w12', weaponPz: true, armorSet: 'r8r', armorRefine: 'a10',
  gems: 'camp', specialSets: [], specialSetGems: {}, tract: 't6', genie: 'g100', shg: true, shgRefine: 9, voznes: true, voznesRefine: 9,
  ring1: 'silver', ring1Refine: null, ring2: 'r9', ring2Refine: null,
};
const BD: ItemBreakdown = { v: 1, ver: BUILTIN_RULES_VERSION, sum: { cls: 8, lvl: 7, genie: 10, main: 251.85, sets: 11.83, setsRaw: 31, pair: 5 }, rows: [[0, 'ta', 1927, 101.17]] };

function reg(over: Partial<Registration> = {}): Registration {
  return {
    id: 'r1', tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, status: 'confirmed', createdAt: '2026-09-25T16:23:52Z', memberNicknames: null,
    kind: 'player', teamRegistrationId: null, gear: GEAR, attackLevel: null, defenseLevel: null, scoreAdjust: 0, scoreAdjustNote: null,
    characterId: 'c1', characterRev: 3, characterSnapshot: { v: 2 }, dollConfirmedAt: null,
    dollPower: { off: 20000, def: 30000, pa: 50, pz: 40, engine: 1 },
    itemPoints: 268.68, itemBreakdown: BD,
    ...over,
  };
}
const T = { id: 't1', teamSize: 3, teamMode: 'balanced_random', balanceRulesVersion: null, balanceStats: null, ruleFlags: null } as unknown as Tournament;
const rules = rulesFor(BUILTIN_RULES_VERSION);
const V = BUILTIN_RULES_VERSION;

describe('scoreBreakdown / playerScore: гір — registrationScore', () => {
  it('заявка зі скором v2: клас (за розміром команди) + бали за речі + рівень + джин; без itemPoints — таблиця; без анкети — null', () => {
    const b = scoreBreakdown(reg(), V, undefined, 3)!;
    expect(b.gear).toBe(Math.round(classPointsFor(rules, 'archer', 3) + 268.68 + rules.level.l104 + rules.genie.g100));
    expect(b.gear).toBe(294);
    expect(b).toEqual({ gear: 294, adjust: 0, rating: 0, total: 294 });
    // таблиця — для старих заявок (і до міграції 0032, коли колонок немає)
    const table = scoreBreakdown(reg({ itemPoints: null, itemBreakdown: null }), V, undefined, 3)!;
    expect(table.gear).toBe(computeGearScoreWith(GEAR, rules, 3));
    expect(table.gear).not.toBe(294);
    expect(scoreBreakdown(reg({ gear: null }), V, undefined, 3)).toBeNull();
    expect(playerScore(reg({ gear: null }), V, undefined, 3)).toBeNull();
    // розмір команди міняє лише бали класу
    const six = normalizeRules({ classPointsBySize: { ...rules.classPointsBySize, '6': { ...rules.classPointsBySize['6'], archer: 2 } } });
    registerRules({ version: 'balance-v9.8', note: 'тест', createdAt: '2026-10-01T00:00:00Z', builtin: false }, six, false);
    expect(playerScore(reg(), 'balance-v9.8', undefined, 6)).toBe(294 - 6);
  });

  it('корекція адміна й бонус за Ело додаються поверх гіру', () => {
    const ratings = new Map<string, PlayerRating>([['tayforn', { nickname: 'Tayforn', rating: 1200, games: 5, wins: 3 } as PlayerRating]]);
    const b = scoreBreakdown(reg({ scoreAdjust: -5 }), V, ratings, 3)!;
    expect(b.gear).toBe(294);
    expect(b.adjust).toBe(-5);
    expect(b.rating).toBe(10); // +5 за кожні 100 понад 1000
    expect(b.total).toBe(299);
    expect(playerScore(reg({ scoreAdjust: -5 }), V, ratings, 3)).toBe(299);
  });

  it('стара версія шкали з блоком dollScore (режим "on", еталон класу): жеребка все одно бере registrationScore', () => {
    const on = normalizeRules({ dollScore: { mode: 'on', refs: { archer: { off: 10000, def: 20000, base: 140, label: 'еталон' } } } });
    registerRules({ version: 'balance-v9.7', note: 'тест', createdAt: '2026-10-01T00:00:00Z', builtin: false }, on, false);
    const r = reg();
    expect(r.dollPower).not.toBeNull(); // сила в заявці є, але в скор не входить
    expect(scoreBreakdown(r, 'balance-v9.7', undefined, 3)!.gear).toBe(Math.round(classPointsFor(on, 'archer', 3) + 268.68 + on.level.l104 + on.genie.g100));
    expect(scoreBreakdown(reg({ itemPoints: null }), 'balance-v9.7', undefined, 3)!.gear).toBe(computeGearScoreWith(GEAR, on, 3));
  });

  it('playersForBalance: лише підтверджені гравці з анкетою, скор — той самий підсумок', () => {
    const regs = [reg(), reg({ id: 'r2', nickname: 'B', status: 'pending' }), reg({ id: 'r3', nickname: 'C', gear: null }), reg({ id: 'r4', nickname: 'D', kind: 'team' }), reg({ id: 'r5', nickname: 'E', itemPoints: null })];
    const ps = playersForBalance(T, regs);
    expect(ps.map((p) => p.id)).toEqual(['r1', 'r5']);
    expect(ps[0].score).toBe(294);
    expect(ps[1].score).toBe(computeGearScoreWith(GEAR, rules, 3));
    expect(ps[0].cls).toBe('archer');
  });
});

describe('isUnverifiedV2 / unverifiedForBalance / hasItemPointsRows', () => {
  it('не перевірено = є itemPoints, а checked не true; перевірено — лише checked: true', () => {
    expect(isUnverifiedV2(reg())).toBe(true);
    expect(isUnverifiedV2(reg({ itemBreakdown: null }))).toBe(true);
    expect(isUnverifiedV2(reg({ itemBreakdown: { ...BD, checked: true } }))).toBe(false);
    // табличні рядки перевіряти нічого
    expect(isUnverifiedV2(reg({ itemPoints: null, itemBreakdown: null }))).toBe(false);
    expect(isUnverifiedV2(reg({ itemPoints: null, itemBreakdown: BD }))).toBe(false);
  });

  it('жеребку блокують лише підтверджені гравці з неперевіреним скором v2', () => {
    const regs = [
      reg(), // не перевірено
      reg({ id: 'r2', nickname: 'B', itemBreakdown: { ...BD, checked: true } }),
      reg({ id: 'r3', nickname: 'C', status: 'pending' }),
      reg({ id: 'r4', nickname: 'D', status: 'rejected' }),
      reg({ id: 'r5', nickname: 'E', kind: 'team', itemPoints: 1 }),
      reg({ id: 'r6', nickname: 'F', itemPoints: null, itemBreakdown: null }),
    ];
    expect(unverifiedForBalance(regs).map((r) => r.id)).toEqual(['r1']);
    expect(unverifiedForBalance(regs.slice(1))).toEqual([]);
    expect(hasItemPointsRows(regs)).toBe(true);
    expect(hasItemPointsRows([regs[5]])).toBe(false);
    expect(hasItemPointsRows([regs[4]])).toBe(false); // team-рядки не рахуються
  });
});
