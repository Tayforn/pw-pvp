// =========================================================
// ЛЯЛЬКА — «Проти надітого» в пікері: кандидат підставляється в копію білда,
// різниця — лише там, де число змінилось; оригінал не чіпається.
// =========================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { computeStats } from '../../core/stats';
import { buildWith, compareBuilds, deltaText, type CompareRow, type PickCandidate } from '../pickCompare';
import { calcState, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

function candOf(build: ReturnType<typeof calcState>, slot: string): PickCandidate {
  return {
    item: build.equipped[slot], refine: build.refine[slot], gems: build.gems[slot], addons: build.addons[slot],
    engrave: build.engrave[slot], wdf: build.wdf[slot], crystal: build.crystal[slot],
  };
}

describe('buildWith / compareBuilds', () => {
  it('та сама річ з тим самим станом — без змін; оригінал не змінено', () => {
    const build = calcState('typical-by');
    const before = JSON.stringify(build);
    const same = buildWith(build, 'ta', candOf(build, 'ta'));
    expect(compareBuilds(build, same)).toEqual([]);
    expect(JSON.stringify(build)).toBe(before);
    expect(same).not.toBe(build);
    expect(same.equipped).not.toBe(build.equipped);
  });

  it('порожній слот зброї — атака й ПА падають, рядки «погано»; маг. атака без змін', () => {
    const build = calcState('typical-by');
    const rows = compareBuilds(build, buildWith(build, 'ta', null));
    const atk = rows.find((r) => r.key === 'physAtk')!;
    expect(atk.delta).toBeLessThan(0);
    expect(atk.good).toBe(false);
    expect(atk.before).toBeGreaterThan(atk.after);
    // ПА зникає разом зі зброєю: +30 самої сокири Ареса, +5 її каменів (Ракшаса +3, светлого духа +2)
    // і +20 шостої деталі комплекту Сунь Цзи; маг. атаки у воїна зброя не дає
    expect(rows.find((r) => r.key === 'pa')!.delta).toBe(-55);
    expect(rows.find((r) => r.key === 'magAtk')).toBeUndefined();
  });

  it('заточка +12 на тій самій зброї — атака росте; броня без каменів — лише втрати', () => {
    const build = calcState('typical-by');
    const up = buildWith(build, 'ta', { ...candOf(build, 'ta'), refine: 12 });
    const rows = compareBuilds(build, up);
    expect(rows.find((r) => r.key === 'physAtk')!.good).toBe(true);
    // броня без каменів фікстури → щось падає, нічого не росте
    const bare = compareBuilds(build, buildWith(build, 'rv', { ...candOf(build, 'rv'), gems: [] }));
    expect(bare.length).toBeGreaterThan(0);
    expect(bare.every((r) => r.delta < 0 && !r.good)).toBe(true);
  });

  it('кандидат, що не проходить вимоги, у ядрі не активний — стати з нього не рахуються', () => {
    const build = calcState('typical-by');
    const heavy = lookup('ta', 2300)!; // «Підтв. реєстр.» — вимога 300 рівня
    const rows = compareBuilds(build, buildWith(build, 'ta', { item: heavy }));
    const atk = rows.find((r) => r.key === 'physAtk')!;
    // як і порожній слот: атака лише від атрибутів
    const empty = compareBuilds(build, buildWith(build, 'ta', null)).find((r) => r.key === 'physAtk')!;
    expect(atk.delta).toBe(empty.delta);
    // тотали кандидата справді без зброї
    expect(computeStats(buildWith(build, 'ta', { item: heavy })).t.ad || 0).toBe(computeStats(buildWith(build, 'ta', null)).t.ad || 0);
  });

  it('текст різниці: знак, розряди, знаки після коми, відсотки', () => {
    const row = (delta: number, digits = 0, unit = ''): CompareRow => ({ key: 'x', label: 'x', before: 0, after: delta, delta, digits, unit, good: delta > 0 });
    expect(deltaText(row(1387))).toBe('+' + (1387).toLocaleString('uk'));
    expect(deltaText(row(-5))).toBe('−5');
    expect(deltaText(row(-0.1, 2))).toBe('−0,10');
    expect(deltaText(row(6, 0, '%'))).toBe('+6%');
  });
});
