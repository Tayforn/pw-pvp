import { describe, expect, it } from 'vitest';
import {
  BUILTIN_RULES_VERSION, CLASS_ORDER, SIZE_BUCKETS, computeGearScore, computeGearScoreWith, currentRulesVersion, gearSummary, hasRulesVersion, maxGearScore,
  nextRulesVersion, normalizeRules, registerRules, rulesFor, sameForAllSizes, serializeRules, shgVoznesScore, sizeBucket, specialSetGemsScore, specialSetsScore, tierFor, weaponGradeScore,
} from '../gearRules';
import type { CharClass, PlayerGear } from '../types';

/** Скор для паті з 3 (бали за клас залежать від розміру; у вбудованій версії однакові). */
const score = (g: PlayerGear, version?: string | null) => computeGearScore(g, version, 3);

const base: PlayerGear = {
  charClass: 'cleric', weaponGrade: 'nirvana', weaponRefine: 'w0_5', weaponPz: false,
  armorSet: 'nirvana', armorRefine: 'a5', gems: 'g0_9', specialSets: [], specialSetGems: {}, tract: 't1_3', genie: 'g60',
  shg: false, shgRefine: null, voznes: false, voznesRefine: null,
};
const gear = (over: Partial<PlayerGear>): PlayerGear => ({ ...base, ...over });

describe('balance-v1.0: шкала', () => {
  it('максимум 339 (285 + ШГ/Вознєс 54), реалістичний (без R9-броні) 326', () => {
    expect(maxGearScore()).toBe(339);
    const r = rulesFor();
    expect(maxGearScore() - (r.armorSet.r9 - r.armorSet.r8r)).toBe(326);
  });

  it('архетипи з документа (§3.1) — ті самі, що в адмінському редакторі (з балами класу)', () => {
    expect(score(gear({ charClass: 'assassin', weaponGrade: 'r9r2', weaponRefine: 'w12', armorSet: 'r8r', armorRefine: 'a12', gems: 'camp', specialSets: ['pz', 'pa', 'aspd'], specialSetGems: { pz: 'camp', pa: 'camp', aspd: 'camp' }, tract: 'emperor', genie: 'g100' }))).toBe(257);
    expect(score(gear({ charClass: 'archer', weaponGrade: 'r9r1', weaponRefine: 'w11', armorSet: 'r8r', armorRefine: 'a10', gems: 'pa', specialSets: ['pz', 'pa'], specialSetGems: { pz: 'pa', pa: 'pa' }, tract: 't8', genie: 'g100' }))).toBe(216);
    expect(score(gear({ charClass: 'wizard', weaponGrade: 'cgd', weaponRefine: 'w10', armorSet: 'r8r', armorRefine: 'a10', gems: 'xuan', specialSets: ['pa'], specialSetGems: { pa: 'xuan' }, tract: 't7' }))).toBe(134);
    expect(score(gear({ weaponGrade: 'r8r', weaponRefine: 'w10', weaponPz: true, armorSet: 'nirvana_r8_mix', armorRefine: 'a8', gems: 'g10', specialSets: ['aspd'], specialSetGems: { aspd: 'g10' }, tract: 't6' }))).toBe(94);
    expect(score(gear({ charClass: 'barbarian', weaponGrade: 'nirvana', weaponRefine: 'w8_9', weaponPz: true, armorSet: 'nirvana', armorRefine: 'a7', tract: 't4_5' }))).toBe(52);
    expect(score(base)).toBe(20); // 13 за гір + 7 за клас (прист)
  });

  it('бали за клас: додаються до скору; нулі вимикають; старий формат classPoints розкладається на всі розміри', () => {
    const r = rulesFor();
    expect(r.classPointsBySize['3'].assassin).toBe(10);
    expect(score(gear({ charClass: 'assassin' })) - score(gear({ charClass: 'blademaster' }))).toBe(5);
    const zeros = Object.fromEntries(CLASS_ORDER.map((c) => [c, 0])) as Record<CharClass, number>;
    const off = normalizeRules({ ...serializeRules(r) as object, classPointsBySize: sameForAllSizes(zeros) });
    expect(computeGearScoreWith(base, off, 3)).toBe(13);
    // легасі-версія з БД: один ряд classPoints без матриці → однаково для всіх розмірів
    const legacy = { ...(serializeRules(r) as Record<string, unknown>) };
    delete legacy.classPointsBySize;
    const ones = Object.fromEntries(CLASS_ORDER.map((c) => [c, 1]));
    const lg = normalizeRules({ ...legacy, classPoints: ones });
    for (const s of SIZE_BUCKETS) expect(lg.classPointsBySize[s]).toEqual(ones);
  });

  it('бали за клас залежать від розміру паті: колонка = розмір команди, ≤ 1 → «2», ≥ 6 → «6+»', () => {
    expect(sizeBucket(1)).toBe('2');
    expect(sizeBucket(undefined)).toBe('2');
    expect(sizeBucket(4)).toBe('4');
    expect(sizeBucket(6)).toBe('6');
    expect(sizeBucket(10)).toBe('6');
    const r = rulesFor();
    const m = normalizeRules({ ...serializeRules(r) as object, classPointsBySize: { ...r.classPointsBySize, '6': { ...r.classPointsBySize['6'], assassin: 4 } } });
    const sin = gear({ charClass: 'assassin' });
    expect(computeGearScoreWith(sin, m, 3) - computeGearScoreWith(sin, m, 6)).toBe(6);
    expect(computeGearScoreWith(sin, m, 10)).toBe(computeGearScoreWith(sin, m, 6));
    expect(computeGearScoreWith(sin, m, 2)).toBe(computeGearScoreWith(sin, m, 3)); // у вбудованій колонки 2 і 3 однакові
  });

  it('зброя за класами: у фізиків R9R1 > РЦГД, у інтовиків навпаки; ЦГД/РЦГД/R9R2 однакові', () => {
    const r = rulesFor();
    expect(weaponGradeScore('archer', 'r9r1', r)).toBe(50);
    expect(weaponGradeScore('archer', 'rcgd', r)).toBe(45);
    expect(weaponGradeScore('wizard', 'r9r1', r)).toBe(38);
    expect(weaponGradeScore('wizard', 'rcgd', r)).toBe(45);
    expect(weaponGradeScore('archer', 'cgd', r)).toBe(weaponGradeScore('wizard', 'cgd', r));
    expect(weaponGradeScore('assassin', 'r9r2', r)).toBe(60);
    // 12 за зброю (50 − 38) + 1 за клас (лук 8 − маг 7)
    expect(score(gear({ charClass: 'archer', weaponGrade: 'r9r1' })) - score(gear({ charClass: 'wizard', weaponGrade: 'r9r1' }))).toBe(13);
  });

  it('ПЗ-зброя (запасна зброя для свапу) дає +15 незалежно від грейду основної', () => {
    expect(score(gear({ weaponGrade: 'nirvana', weaponPz: true })) - score(gear({ weaponGrade: 'nirvana' }))).toBe(15);
    expect(score(gear({ weaponGrade: 'cgd', weaponPz: true })) - score(gear({ weaponGrade: 'cgd' }))).toBe(15);
    expect(score(gear({ weaponGrade: 'r9r2', weaponPz: true })) - score(gear({ weaponGrade: 'r9r2' }))).toBe(15);
  });

  it('камені: монотонно за вартістю, Лагеря (48 ПЗ) = 40', () => {
    const g = rulesFor().gems;
    expect(g.g0_9).toBe(0);
    expect(g.camp).toBe(40);
    const order = ['g0_9', 'g10', 'g11', 'xuan', 'xuan_pa', 'pa', 'xuan_camp', 'camp'] as const;
    for (let i = 1; i < order.length; i++) expect(g[order[i]]).toBeGreaterThan(g[order[i - 1]]);
    expect(score(gear({ gems: 'camp' })) - score(base)).toBe(40);
  });

  it('камені у свап-сетах: 50 % таблиці за кожен сет, стеля 20; сет без запису = 0–9', () => {
    const r = rulesFor();
    expect(specialSetGemsScore({ specialSets: [], specialSetGems: {} }, r)).toBe(0);
    expect(specialSetGemsScore({ specialSets: ['pz'], specialSetGems: {} }, r)).toBe(0);
    expect(specialSetGemsScore({ specialSets: ['pz'], specialSetGems: { pz: 'pa' } }, r)).toBe(13);
    expect(specialSetGemsScore({ specialSets: ['pz', 'pa'], specialSetGems: { pz: 'pa', pa: 'pa' } }, r)).toBe(20);
    expect(specialSetGemsScore({ specialSets: ['pz', 'pa', 'aspd'], specialSetGems: { pz: 'camp', pa: 'camp', aspd: 'camp' } }, r)).toBe(20);
    // «сет, затиканий бурштинками» проти «сет із фул ПЗ-камінням»
    const amber = score(gear({ specialSets: ['pz'], specialSetGems: { pz: 'g0_9' } }));
    const full = score(gear({ specialSets: ['pz'], specialSetGems: { pz: 'camp' } }));
    expect(full - amber).toBe(20);
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

  it('джин за рівнем: 0 / 2 / 4 / 6 / 8 / 10', () => {
    const g = rulesFor().genie;
    expect([g.g60, g.g61_70, g.g71_80, g.g81_90, g.g91_99, g.g100]).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it('tier: S ≥ 225 · A 175 · B 130 · C 85 · D', () => {
    expect(tierFor(257)).toBe('S');
    expect(tierFor(225)).toBe('S');
    expect(tierFor(224)).toBe('A');
    expect(tierFor(175)).toBe('A');
    expect(tierFor(134)).toBe('B');
    expect(tierFor(94)).toBe('C');
    expect(tierFor(52)).toBe('D');
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
    const r = normalizeRules({ weaponGrade: { r9r2: 99, bogus: 1 }, gems: 'oops', tiers: [{ tier: 'S', min: 10 }], balance: { epsilon: 7 }, weaponGradeByClass: { wizard: { r9r1: 1, bogus: 5 }, nope: { r9: 3 } } });
    expect(r.weaponGrade.r9r2).toBe(99);
    expect(r.weaponGrade.cgd).toBe(rulesFor(BUILTIN_RULES_VERSION).weaponGrade.cgd);
    expect(r.gems).toEqual(rulesFor(BUILTIN_RULES_VERSION).gems);
    expect(r.tiers).toEqual(rulesFor(BUILTIN_RULES_VERSION).tiers); // неповні пороги → вбудовані
    expect(r.balance.epsilon).toBe(7);
    expect(r.balance.T0).toBe(rulesFor(BUILTIN_RULES_VERSION).balance.T0);
    expect(r.weaponGradeByClass.wizard).toEqual({ r9r1: 1 });
    expect(r.weaponGradeByClass.archer).toEqual({}); // передано об'єкт без archer → без перевизначень
    expect(computeGearScoreWith(gear({ weaponGrade: 'r9r2' }), r, 3)).toBe(20 - 5 + 99);
  });

  it('реєстр версій: нова версія стає поточною, старі турніри рахуються по-старому; nextRulesVersion інкрементує мінор', () => {
    expect(nextRulesVersion()).toBe('balance-v1.1');
    const v11 = normalizeRules({ ...serializeRules(rulesFor(BUILTIN_RULES_VERSION)) as object, weaponPz: 30 });
    registerRules({ version: 'balance-v1.1', note: 'тест', createdAt: '2026-09-09T00:00:00Z', builtin: false }, v11, true);
    expect(currentRulesVersion()).toBe('balance-v1.1');
    expect(nextRulesVersion()).toBe('balance-v1.2');
    expect(score(gear({ weaponPz: true }), 'balance-v1.0')).toBe(35);
    expect(score(gear({ weaponPz: true }), 'balance-v1.1')).toBe(50);
    expect(score(gear({ weaponPz: true }))).toBe(50); // без версії — поточна
    // повертаємо вбудовану як поточну, щоб не впливати на інші тести
    registerRules({ version: BUILTIN_RULES_VERSION, note: null, createdAt: null, builtin: true }, rulesFor(BUILTIN_RULES_VERSION), true);
  });

  it('gearSummary — компактний рядок українською, з камінням у сетах', () => {
    expect(gearSummary(gear({ weaponGrade: 'cgd', weaponRefine: 'w10', armorSet: 'r8r', armorRefine: 'a8', gems: 'pa', specialSets: ['pz'], specialSetGems: { pz: 'camp' }, tract: 't8', genie: 'g100' })))
      .toBe('ЦГД +10 · R8R +8 · Камні ПА · ПЗ-сет (Лагеря) · Тракт 8 · Джин 100/100');
    expect(gearSummary(gear({ weaponPz: true, gems: 'xuan_camp' }))).toBe('Нірвана +0–5 + ПЗ-зброя · Нірвана +5 · Камні Сюаньки / Лагеря · Тракт 1–3 · Джин до 60');
  });
});

describe('ШГ і Вознєс', () => {
  it('наявність 15 / 10, +1 за рівень точки кожної, +5 за обидві', () => {
    const r = rulesFor();
    expect(shgVoznesScore(base, r)).toBe(0);
    expect(shgVoznesScore(gear({ shg: true, shgRefine: 0 }), r)).toBe(15);
    expect(shgVoznesScore(gear({ shg: true, shgRefine: 7 }), r)).toBe(22);
    expect(shgVoznesScore(gear({ voznes: true, voznesRefine: 5 }), r)).toBe(15);
    expect(shgVoznesScore(gear({ shg: true, shgRefine: 7, voznes: true, voznesRefine: 5 }), r)).toBe(42); // 22 + 15 + 5
    expect(shgVoznesScore(gear({ shg: true, shgRefine: 12, voznes: true, voznesRefine: 12 }), r)).toBe(54);
    // точка без шмотки не рахується; поза 0–12 обрізається
    expect(shgVoznesScore(gear({ shg: false, shgRefine: 9 }), r)).toBe(0);
    expect(shgVoznesScore(gear({ shg: true, shgRefine: 99 }), r)).toBe(27);
  });

  it('входить у гір-скор', () => {
    expect(score(gear({ shg: true, shgRefine: 7, voznes: true, voznesRefine: 5 })) - score(base)).toBe(42);
  });

  it('версія, збережена до появи полів, бере значення вбудованої; збережені значення поважаються', () => {
    const legacy = serializeRules(rulesFor(BUILTIN_RULES_VERSION)) as Record<string, unknown>;
    for (const k of ['shg', 'voznes', 'shgVoznesBonus', 'shgRefinePerLevel', 'voznesRefinePerLevel']) delete legacy[k];
    const old = normalizeRules(legacy);
    expect(old.shg).toBe(15);
    expect(old.voznes).toBe(10);
    expect(computeGearScoreWith(base, old, 3)).toBe(score(base)); // анкети без шмоток — той самий скор
    const custom = normalizeRules({ ...legacy, shg: 20, shgVoznesBonus: 0, shgRefinePerLevel: 2 });
    expect(shgVoznesScore(gear({ shg: true, shgRefine: 3, voznes: true, voznesRefine: 0 }), custom)).toBe(20 + 6 + 10);
  });

  it('підсумок анкети', () => {
    expect(gearSummary(gear({ shg: true, shgRefine: 7, voznes: true, voznesRefine: 5 }))).toContain('ШГ +7, Вознєс +5');
    expect(gearSummary(base)).not.toContain('ШГ');
  });
});
