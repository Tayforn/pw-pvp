// Джин: формули калькулятора (порт pw-calc genieCalc.ts), причини блокування,
// попередження, бали за удачею і нормалізатор знімка заявки.

import { describe, expect, it } from 'vitest';
import {
  GENIE_MAX_LEVEL, GENIE_MAX_SKILLS, GENIE_SKILLS, INITIAL_REFS, affPointsAtLevel, affRequirements, clsBit, genieBucket, genieFromSnapshot,
  genieScoreLuck, genieSkill, genieWarnings, maxLuckAtLevel, minGenieLevel, neededLucky, whyBlocked, type GenieCfg,
} from '../genie';

const cfg = (level: number, luck: number, skills: number[] = []): GenieCfg => ({ level, luck, skills });
// Дешеві вміння 1-го рівня: початкове «Жало» і по одному очку спорідненості.
const CHEAP = [10001, 9681, 9751, 9791, 9941, 9601, 9581, 9741];
const BY = clsBit('by');

describe('формули калькулятора', () => {
  it('очки спорідненості: +1 за 5 рівнів, після 100 — +1 за рівень (до +4)', () => {
    expect(affPointsAtLevel(1)).toBe(1);
    expect(affPointsAtLevel(60)).toBe(13);
    expect(affPointsAtLevel(100)).toBe(21);
    expect(affPointsAtLevel(103)).toBe(24);
    expect(affPointsAtLevel(105)).toBe(26);
  });

  it('вимоги спорідненості — максимум по стихіях; рівень за сумою очок', () => {
    // «Шипи гніву» [6,0,7,0,0] + «Полумʼя дракона» [0,0,0,6,7] → 26 очок = рівень 105.
    expect(affRequirements([10401, 10411])).toEqual([6, 0, 7, 6, 7]);
    expect(minGenieLevel([10401, 10411])).toBe(105);
    // Одне «Займання» [0,0,7,0,6]: 13 очок → (13 − 1)·5 = 60, і саме вміння — від 60.
    expect(minGenieLevel([10461])).toBe(60);
    expect(minGenieLevel([])).toBe(1);
    // Невідомий ref вимог не має, але слот займає.
    expect(affRequirements([123])).toEqual([0, 0, 0, 0, 0]);
  });

  it('кількість вмінь: 5/6/7/8 → рівень від 60/80/90/100, удача від 51/71/81/91', () => {
    expect(minGenieLevel(CHEAP.slice(0, 4))).toBeLessThan(60);
    expect(minGenieLevel(CHEAP.slice(0, 5))).toBe(60);
    expect(minGenieLevel(CHEAP.slice(0, 6))).toBe(80);
    expect(minGenieLevel(CHEAP.slice(0, 7))).toBe(90);
    expect(minGenieLevel(CHEAP)).toBe(100);
    expect(neededLucky(1, 4)).toBe(0);
    expect(neededLucky(60, 5)).toBe(51);
    expect(neededLucky(80, 6)).toBe(71);
    expect(neededLucky(90, 7)).toBe(81);
    expect(neededLucky(100, 8)).toBe(91);
    expect(neededLucky(100, 9)).toBe(1000);
    // Удача не нижча за рівень/10.
    expect(neededLucky(105, 0)).toBe(10);
  });

  it('8 вмінь — рівень ≥ 100 і удача ≥ 91 для будь-якого набору', () => {
    const land = GENIE_SKILLS.filter((s) => !INITIAL_REFS.has(s.ref));
    for (let k = 0; k + 8 <= land.length; k += 8) {
      const refs = land.slice(k, k + 8).map((s) => s.ref);
      expect(minGenieLevel(refs)).toBeGreaterThanOrEqual(100);
      expect(neededLucky(minGenieLevel(refs), refs.length)).toBeGreaterThanOrEqual(91);
    }
  });

  it('межі й підказка «макс.» удачі за рівнем', () => {
    expect(GENIE_MAX_LEVEL).toBe(105);
    expect(GENIE_MAX_SKILLS).toBe(8);
    expect(maxLuckAtLevel(105)).toBe(100);
    expect(maxLuckAtLevel(95)).toBe(90);
    expect(maxLuckAtLevel(9)).toBe(0);
  });

  it('біт класу: коди ляльки й класи сайту; невідоме → 0', () => {
    expect([clsBit('by'), clsBit('ga'), clsBit('js'), clsBit('ij'), clsBit('ya')]).toEqual([0x10, 0x20, 0x1, 0x2, 0x4]);
    expect([clsBit('rl'), clsBit('fx'), clsBit('sj'), clsBit('ej'), clsBit('rg')]).toEqual([0x8, 0x40, 0x80, 0x100, 0x200]);
    expect(clsBit('blademaster')).toBe(clsBit('by'));
    expect(clsBit('barbarian')).toBe(clsBit('ya'));
    expect(clsBit('venomancer')).toBe(clsBit('rl'));
    expect(clsBit('mystic')).toBe(clsBit('rg'));
    expect(clsBit('uf')).toBe(0);
    expect(clsBit('toString')).toBe(0);
    expect(clsBit('__proto__')).toBe(0);
  });
});

describe('whyBlocked: чому вміння не додати', () => {
  it('можна додати — null; уже в наборі — null (клік прибирає)', () => {
    expect(whyBlocked(9681, cfg(1, 0), BY)).toBeNull();
    expect(whyBlocked(10461, cfg(1, 0, [10461]), BY)).toBeNull();
  });

  it('full: уже 8 вмінь', () => {
    expect(whyBlocked(9931, cfg(105, 100, CHEAP), BY)).toEqual({ code: 'full', need: 8, have: 8 });
  });

  it('initial: друге початкове', () => {
    expect(whyBlocked(10151, cfg(105, 100, [10001]), BY)).toEqual({ code: 'initial' });
    expect(whyBlocked(10151, cfg(105, 100, [9681]), BY)).toBeNull();
  });

  it('class: вміння не для класу персонажа; без класу (біт 0) не перевіряється', () => {
    // «Хаос душі» — лише друїд (0x8).
    expect(whyBlocked(10451, cfg(105, 100), BY)).toEqual({ code: 'class' });
    expect(whyBlocked(10451, cfg(105, 100), clsBit('rl'))).toBeNull();
    expect(whyBlocked(10451, cfg(105, 100), 0)).toBeNull();
    // «Кульова блискавка» (0x3f7): усім, крім друїда.
    expect(whyBlocked(9661, cfg(105, 100), clsBit('ya'))).toBeNull();
    expect(whyBlocked(9661, cfg(105, 100), clsBit('rl'))).toEqual({ code: 'class' });
  });

  it('level: замалий рівень — скільки треба й скільки є', () => {
    expect(whyBlocked(10461, cfg(1, 100), BY)).toEqual({ code: 'level', need: 60, have: 1 });
    expect(whyBlocked(CHEAP[4], cfg(59, 100, CHEAP.slice(0, 4)), BY)).toEqual({ code: 'level', need: 60, have: 59 });
  });

  it('luck: замала удача для кількості вмінь або для рівня', () => {
    expect(whyBlocked(CHEAP[4], cfg(60, 0, CHEAP.slice(0, 4)), BY)).toEqual({ code: 'luck', need: 51, have: 0 });
    expect(whyBlocked(CHEAP[4], cfg(60, 51, CHEAP.slice(0, 4)), BY)).toBeNull();
    expect(whyBlocked(9681, cfg(105, 5), BY)).toEqual({ code: 'luck', need: 10, have: 5 });
  });

  it('порядок причин: повно → початкове → клас → рівень → удача', () => {
    expect(whyBlocked(10451, cfg(1, 0, CHEAP), BY)?.code).toBe('full');
    expect(whyBlocked(10151, cfg(1, 0, [10001]), BY)?.code).toBe('initial');
    expect(whyBlocked(10451, cfg(1, 0), BY)?.code).toBe('class');
    expect(whyBlocked(10461, cfg(1, 0), BY)?.code).toBe('level');
  });

  it('ref поза таблицею не додається', () => {
    expect(whyBlocked(123, cfg(105, 100), BY)).toEqual({ code: 'unknown' });
  });
});

describe('genieWarnings: порушення вже зібраного набору', () => {
  it('усе гаразд — порожньо', () => {
    expect(genieWarnings(cfg(105, 100), BY)).toEqual([]);
    expect(genieWarnings(cfg(100, 91, CHEAP), BY)).toEqual([]);
  });

  it('кожне порушення — людським рядком', () => {
    const w = (c: GenieCfg, bit = BY) => genieWarnings(c, bit).join(' | ');
    expect(w(cfg(60, 51, [10001, 10151]))).toMatch(/лише одне початкове/);
    expect(w(cfg(105, 100, [10451]))).toMatch(/«Хаос душі» не для цього класу/);
    expect(w(cfg(105, 100, [10451]), 0)).toBe('');
    expect(w(cfg(30, 100, [10461]))).toMatch(/від 60 рівня \(зараз 30\)/);
    expect(w(cfg(60, 10, CHEAP.slice(0, 5)))).toMatch(/для 5 вмінь потрібна удача від 51 \(зараз 10\)/);
    expect(w(cfg(105, 5))).toMatch(/не буває нижчою за 10/);
    expect(w(cfg(50, 100))).toMatch(/удача 100 вища, ніж буває на 50 рівні \(макс\. 50\)/);
    expect(w(cfg(105, 100, [123]))).toMatch(/невідомих вмінь джина: 1/);
    expect(w(cfg(105, 100, [...CHEAP, 9931]))).toMatch(/не більше 8 вмінь \(зараз 9\)/);
  });
});

describe('бали за удачею', () => {
  it('межі діапазонів', () => {
    const at = (l: number) => genieBucket(l);
    expect([at(0), at(60), at(61), at(70), at(71), at(80)]).toEqual(['g60', 'g60', 'g61_70', 'g61_70', 'g71_80', 'g71_80']);
    expect([at(81), at(90), at(91), at(99), at(100)]).toEqual(['g81_90', 'g81_90', 'g91_99', 'g91_99', 'g100']);
  });

  it('удача для балів не нижча за ту, без якої стільки вмінь не буває', () => {
    expect(genieScoreLuck(cfg(100, 0, CHEAP))).toBe(91);
    expect(genieScoreLuck(cfg(105, 100, CHEAP))).toBe(100);
    expect(genieScoreLuck(cfg(60, 10, CHEAP.slice(0, 5)))).toBe(51);
    expect(genieScoreLuck(cfg(80, 75, CHEAP.slice(0, 6)))).toBe(75);
    expect(genieScoreLuck(cfg(50, 30, CHEAP.slice(0, 4)))).toBe(30);
    expect(genieScoreLuck(cfg(50, 0, [...CHEAP, 9931]))).toBe(91);
    expect(genieBucket(genieScoreLuck(cfg(100, 0, CHEAP)))).toBe('g91_99');
  });
});

describe('genieFromSnapshot: недовірений знімок заявки', () => {
  it('немає знімка чи джина — null', () => {
    for (const raw of [null, undefined, 5, 'x', [], {}, { genie: null }, { genie: [] }, { genie: 'x' }, { genie: 7 }]) {
      expect(genieFromSnapshot(raw)).toBeNull();
    }
  });

  it('межі, лише відомі ref без повторів, перші 8', () => {
    expect(genieFromSnapshot({ genie: { level: 100, luck: 95, skills: [9681, 9751] } })).toEqual(cfg(100, 95, [9681, 9751]));
    expect(genieFromSnapshot({ genie: { level: 500, luck: -3, skills: 'x' } })).toEqual(cfg(105, 0, []));
    expect(genieFromSnapshot({ genie: { level: '90', luck: null } })).toEqual(cfg(1, 0, []));
    expect(genieFromSnapshot({ genie: { level: 50.7, luck: Infinity, skills: [] } })).toEqual(cfg(50, 0, []));
    const junk = [9681, 9681, 123, '9751', 9751.5, null, { r: 1 }, ...GENIE_SKILLS.slice(10, 30).map((s) => s.ref)];
    const got = genieFromSnapshot({ genie: { level: 105, luck: 100, skills: junk, extra: '<b>' } });
    expect(got?.skills).toHaveLength(8);
    expect(got?.skills[0]).toBe(9681);
    expect(new Set(got?.skills).size).toBe(8);
    expect(got?.skills.every((r) => !!genieSkill(r))).toBe(true);
    expect(got).not.toHaveProperty('extra');
  });
});
