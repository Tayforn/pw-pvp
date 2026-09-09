import { describe, expect, it } from 'vitest';
import {
  BUILTIN_RULES_VERSION, computeGearScore, computeGearScoreWith, currentRulesVersion, gearSummary, hasRulesVersion, maxGearScore,
  nextRulesVersion, normalizeRules, registerRules, rulesFor, serializeRules, specialSetsScore, tierFor,
} from '../gearRules';
import type { PlayerGear } from '../types';

const base: PlayerGear = {
  charClass: 'cleric', weaponGrade: 'nirvana', weaponRefine: 'w0_5', weaponPz: false,
  armorSet: 'nirvana', armorRefine: 'a5', gems: 'g0_9', specialSets: [], tract: 't1_3', genie: 'lower',
};
const gear = (over: Partial<PlayerGear>): PlayerGear => ({ ...base, ...over });

describe('balance-v1.0: шкала', () => {
  it('максимум 255, реалістичний (без R9-броні) 242', () => {
    expect(maxGearScore()).toBe(255);
    const r = rulesFor();
    expect(maxGearScore() - (r.armorSet.r9 - r.armorSet.r8r)).toBe(242);
  });

  it('архетипи з документа (§3.1)', () => {
    expect(computeGearScore(gear({ weaponGrade: 'r9r2', weaponRefine: 'w12', armorSet: 'r8r', armorRefine: 'a12', gems: 'camp', specialSets: ['pz', 'pa', 'aspd'], tract: 'emperor', genie: 'top' }))).toBe(227);
    expect(computeGearScore(gear({ weaponGrade: 'r9r1', weaponRefine: 'w11', armorSet: 'r8r', armorRefine: 'a10', gems: 'pa', specialSets: ['pz', 'pa'], tract: 't8', genie: 'top' }))).toBe(178);
    expect(computeGearScore(gear({ weaponGrade: 'cgd', weaponRefine: 'w10', armorSet: 'r8r', armorRefine: 'a10', gems: 'xuan', specialSets: ['pa'], tract: 't7' }))).toBe(120);
    expect(computeGearScore(gear({ weaponGrade: 'r8r', weaponRefine: 'w10', weaponPz: true, armorSet: 'r8', armorRefine: 'a8', gems: 'g10', specialSets: ['aspd'], tract: 't6' }))).toBe(86);
    expect(computeGearScore(gear({ weaponGrade: 'nirvana', weaponRefine: 'w8_9', weaponPz: true, armorSet: 'nirvana', armorRefine: 'a7', tract: 't4_5' }))).toBe(46);
    expect(computeGearScore(base)).toBe(13);
  });

  it('ПЗ-зброя (запасна зброя для свапу) дає +15 незалежно від грейду основної', () => {
    expect(computeGearScore(gear({ weaponGrade: 'nirvana', weaponPz: true })) - computeGearScore(gear({ weaponGrade: 'nirvana' }))).toBe(15);
    expect(computeGearScore(gear({ weaponGrade: 'cgd', weaponPz: true })) - computeGearScore(gear({ weaponGrade: 'cgd' }))).toBe(15);
    expect(computeGearScore(gear({ weaponGrade: 'r9r2', weaponPz: true })) - computeGearScore(gear({ weaponGrade: 'r9r2' }))).toBe(15);
  });

  it('камені: монотонно за вартістю, Лагеря (48 ПЗ) = 40', () => {
    const g = rulesFor().gems;
    expect(g.g0_9).toBe(0);
    expect(g.camp).toBe(40);
    const order = ['g0_9', 'g10', 'g11', 'xuan', 'xuan_pa', 'pa', 'xuan_camp', 'camp'] as const;
    for (let i = 1; i < order.length; i++) expect(g[order[i]]).toBeGreaterThan(g[order[i - 1]]);
    expect(computeGearScore(gear({ gems: 'camp' })) - computeGearScore(base)).toBe(40);
  });

  it('спецсети: min(20, max + 5·(n−1))', () => {
    const r = rulesFor();
    expect(specialSetsScore([], r)).toBe(0);
    expect(specialSetsScore(['aspd'], r)).toBe(8);
    expect(specialSetsScore(['pa'], r)).toBe(12);
    expect(specialSetsScore(['pz'], r)).toBe(15);
    expect(specialSetsScore(['pa', 'aspd'], r)).toBe(17);
    expect(specialSetsScore(['pz', 'aspd'], r)).toBe(20);
    expect(specialSetsScore(['pz', 'pa'], r)).toBe(20);
    expect(specialSetsScore(['pz', 'pa', 'aspd'], r)).toBe(20);
    expect(specialSetsScore(['pz', 'pz'], r)).toBe(15); // дубль не рахується двічі
  });

  it('tier: S ≥ 200 · A 160 · B 115 · C 75 · D', () => {
    expect(tierFor(227)).toBe('S');
    expect(tierFor(200)).toBe('S');
    expect(tierFor(199)).toBe('A');
    expect(tierFor(160)).toBe('A');
    expect(tierFor(120)).toBe('B');
    expect(tierFor(86)).toBe('C');
    expect(tierFor(46)).toBe('D');
    expect(tierFor(0)).toBe('D');
  });

  it('грейди зброї: монотонні, з великими розривами R8R → ЦГД і РЦГД → R9R2 (рідкісна зброя)', () => {
    const w = rulesFor().weaponGrade;
    expect(w.other).toBeLessThan(w.nirvana);
    expect(w.nirvana).toBeLessThan(w.r8r);
    expect(w.r8r).toBeLessThan(w.cgd);
    expect(w.cgd).toBeLessThan(w.r9);
    expect(w.r9).toBeLessThan(w.r9r1);
    expect(w.r9r1).toBeLessThan(w.rcgd);
    expect(w.rcgd).toBeLessThan(w.r9r2);
    expect(w.cgd - w.r8r).toBeGreaterThanOrEqual(15);
    expect(w.r9r2 - w.rcgd).toBeGreaterThanOrEqual(15);
  });

  it('невідома версія → поточна; вбудована версія існує', () => {
    expect(hasRulesVersion(BUILTIN_RULES_VERSION)).toBe(true);
    expect(currentRulesVersion()).toBe(BUILTIN_RULES_VERSION);
    expect(rulesFor('balance-v9.9')).toBe(rulesFor(BUILTIN_RULES_VERSION));
    expect(rulesFor(null)).toBe(rulesFor(BUILTIN_RULES_VERSION));
  });

  it('serialize → normalize: без втрат, tier D з min null у JSON', () => {
    const r = rulesFor(BUILTIN_RULES_VERSION);
    const json = JSON.parse(JSON.stringify(serializeRules(r)));
    expect(json.tiers[4]).toEqual({ tier: 'D', min: null });
    const back = normalizeRules(json);
    expect(back).toEqual(r);
  });

  it('normalizeRules: зламані/неповні поля беруться з вбудованої', () => {
    const r = normalizeRules({ weaponGrade: { r9r2: 99, bogus: 1 }, gems: 'oops', tiers: [{ tier: 'S', min: 10 }], balance: { epsilon: 7 } });
    expect(r.weaponGrade.r9r2).toBe(99);
    expect(r.weaponGrade.cgd).toBe(rulesFor(BUILTIN_RULES_VERSION).weaponGrade.cgd);
    expect(r.gems).toEqual(rulesFor(BUILTIN_RULES_VERSION).gems);
    expect(r.tiers).toEqual(rulesFor(BUILTIN_RULES_VERSION).tiers); // неповні пороги → вбудовані
    expect(r.balance.epsilon).toBe(7);
    expect(r.balance.T0).toBe(rulesFor(BUILTIN_RULES_VERSION).balance.T0);
    expect(computeGearScoreWith(gear({ weaponGrade: 'r9r2' }), r)).toBe(13 - 5 + 99);
  });

  it('реєстр версій: нова версія стає поточною, старі турніри рахуються по-старому; nextRulesVersion інкрементує мінор', () => {
    expect(nextRulesVersion()).toBe('balance-v1.1');
    const v11 = normalizeRules({ ...serializeRules(rulesFor(BUILTIN_RULES_VERSION)) as object, weaponPz: 30 });
    registerRules({ version: 'balance-v1.1', note: 'тест', createdAt: '2026-09-09T00:00:00Z', builtin: false }, v11, true);
    expect(currentRulesVersion()).toBe('balance-v1.1');
    expect(nextRulesVersion()).toBe('balance-v1.2');
    expect(computeGearScore(gear({ weaponPz: true }), 'balance-v1.0')).toBe(28);
    expect(computeGearScore(gear({ weaponPz: true }), 'balance-v1.1')).toBe(43);
    expect(computeGearScore(gear({ weaponPz: true }))).toBe(43); // без версії — поточна
    // повертаємо вбудовану як поточну, щоб не впливати на інші тести
    registerRules({ version: BUILTIN_RULES_VERSION, note: null, createdAt: null, builtin: true }, rulesFor(BUILTIN_RULES_VERSION), true);
  });

  it('gearSummary — компактний рядок українською', () => {
    expect(gearSummary(gear({ weaponGrade: 'cgd', weaponRefine: 'w10', armorSet: 'r8r', armorRefine: 'a8', gems: 'pa', specialSets: ['pz'], tract: 't8', genie: 'top' })))
      .toBe('ЦГД +10 · R8R +8 · Камні ПА · ПЗ-сет · Тракт 8 · Джин 100/100');
    expect(gearSummary(gear({ weaponPz: true, gems: 'xuan_camp' }))).toBe('Нірвана +0–5 + ПЗ-зброя · Нірвана +5 · Камні Сюаньки / Лагеря · Тракт 1–3 · Джин 100−');
  });
});
