import { beforeAll, describe, expect, it } from 'vitest';
import { computeStats } from '../../core/stats';
import type { Item } from '../../core/types';
import { readJson } from '../../core/__tests__/testData';
import { gemOk } from '../gemOk';
import { filterPickerItems, parsePickerQuery, pickerReqLvl, pickerTypeIrs } from '../pickerFilter';
import { calcState, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const TA = readJson<Item[]>('ta');
const OB = readJson<Item[]>('ob');

describe('gemOk', () => {
  it('рівень каменя не вище речі; у броню/зброю — лише generic', () => {
    const weapon = lookup('ta', 1900)!; // hf 16
    const generic = OB.find((g) => g.pg === 'generic' && Number(g.hf) <= 16)!;
    const jewel = OB.find((g) => g.pg !== 'generic')!;
    const high = { ...generic, hf: 99 };
    expect(gemOk(generic, 'ta', weapon)).toBe(true);
    expect(gemOk(high, 'ta', weapon)).toBe(false);
    expect(gemOk(jewel, 'rv', weapon)).toBe(false);
    expect(gemOk(jewel, 'pp', weapon)).toBe(Number(jewel.hf || 0) <= 16);
  });
});

describe('filterPickerItems', () => {
  it('запит «рівень назва», типи, ліміт, дедуплікація', () => {
    expect(parsePickerQuery('101 меч')).toEqual({ lvl: 101, name: 'меч' });
    expect(parsePickerQuery('  Меч ')).toEqual({ lvl: null, name: 'меч' });
    const all = filterPickerItems(TA, '', { cls: 'by', level: 105, onlyFit: false });
    expect(all.rows.length).toBeLessThanOrEqual(400);
    expect(all.total).toBeGreaterThan(400);
    expect(all.total).toBeLessThan(TA.length); // однакові речі злиплись
    const lvl = filterPickerItems(TA, '101', { cls: 'by', level: 105, onlyFit: false, limit: 10000 });
    expect(lvl.rows.every((it) => pickerReqLvl(it) === 101)).toBe(true);
    const named = filterPickerItems(TA, 'сокира ареса', { cls: 'by', level: 105, onlyFit: false });
    expect(named.rows.some((it) => it.id === 1900)).toBe(true);
    const irs = pickerTypeIrs(TA);
    expect(irs).toContain('jh');
    const typed = filterPickerItems(TA, '', { cls: 'by', level: 105, onlyFit: false, types: new Set(['jh']), limit: 10000 });
    expect(typed.rows.every((it) => it.ir === 'jh')).toBe(true);
    const sorted = filterPickerItems(TA, '', { cls: 'by', level: 105, onlyFit: false, sort: 'lvl-desc' });
    expect(pickerReqLvl(sorted.rows[0])).toBeGreaterThanOrEqual(pickerReqLvl(sorted.rows[sorted.rows.length - 1]));
  });

  it('«лише що вдягається»: за build з gearAttr або за cls/level/attrs', () => {
    const build = calcState('typical-by');
    const { gearAttr } = computeStats(build);
    const fit = filterPickerItems(TA, '', { cls: build.cls, level: build.level, onlyFit: true, build, gearAttr, limit: 10000 });
    expect(fit.total).toBeGreaterThan(0);
    expect(fit.rows.some((it) => it.id === 1900)).toBe(true); // сокира Ареса воїну 105 підходить
    expect(fit.rows.every((it) => !it.hi || (it.hi as number[]).includes(1))).toBe(true);
    const weak = filterPickerItems(TA, '', { cls: 'by', level: 1, onlyFit: true, attrs: { str: 5, dex: 5, vit: 5, mag: 5 }, limit: 10000 });
    expect(weak.total).toBeLessThan(fit.total);
    expect(weak.rows.every((it) => (Number(it.oj) || 0) <= 1)).toBe(true);
  });

  it('пікер каменя: фільтр gemOk, типи й «вдягається» не діють', () => {
    const weapon = lookup('ta', 1900)!;
    const gems = filterPickerItems(OB, '', { cls: 'by', level: 1, onlyFit: true, gemHost: { item: weapon, cat: 'ta' }, types: new Set(['zzz']), limit: 10000 });
    expect(gems.total).toBeGreaterThan(0);
    expect(gems.rows.every((g) => gemOk(g, 'ta', weapon))).toBe(true);
  });
});
