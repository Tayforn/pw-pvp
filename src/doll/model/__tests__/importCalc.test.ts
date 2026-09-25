import { beforeAll, describe, expect, it } from 'vitest';
import { computeStats, flattenItemStats } from '../../core/stats';
import type { BackpackEntry, DollState } from '../../core/types';
import { validateDoc } from '../doc';
import { CFG_MAIN, hydrate, inventoryOf, toDollState } from '../hydrate';
import { fromCalcDollState, splitAddons } from '../importCalc';
import { calcState, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

describe('fromCalcDollState', () => {
  it('typical-by: усі 16 слотів → речі + Головний, pw_id, заточка, камені', () => {
    const state = calcState('typical-by');
    const doc = fromCalcDollState(state);
    expect(validateDoc(doc).ok).toBe(true);
    expect(doc.cls).toBe('by');
    expect(doc.level).toBe(105);
    expect(doc.attrs).toEqual({ str: 300, dex: 150, vit: 85, mag: 5 });
    expect(doc.items).toHaveLength(Object.keys(state.equipped).length);
    expect(Object.keys(doc.main).sort()).toEqual(Object.keys(state.equipped).sort());
    const ta = doc.items.find((i) => i.i === doc.main.ta)!;
    expect(ta).toEqual({ i: ta.i, cat: 'ta', id: 1900, p: 28526, r: 10, g: [54, 55] });
    const pp = doc.items.find((i) => i.i === doc.main.pp)!;
    expect(pp.g).toEqual([198, 198]); // хвостові порожні гнізда не зберігаються
    expect(doc.items.find((i) => i.i === doc.main.cr)?.cat).toBe('oq');
    expect(doc.nextIid).toBe(doc.items.length + 1);
    expect(doc).not.toHaveProperty('buffs');
    expect(doc.sets).toEqual([]);
  });

  it('addons ⊇ база → x = добавка; інакше xr + повний список; порожні — нічого', () => {
    const append = fromCalcDollState(calcState('edge-addons-append'));
    const ta = append.items.find((i) => i.i === append.main.ta)!;
    expect(ta.x).toEqual([{ t: 'hp', v: 300 }, { t: 'ed', v: 2 }]);
    expect(ta.xr).toBeUndefined();
    const replace = fromCalcDollState(calcState('edge-addons-replace'));
    const ta2 = replace.items.find((i) => i.i === replace.main.ta)!;
    expect(ta2.xr).toBe(true);
    expect(ta2.x).toEqual([{ t: 'ld_min', v: 1000 }, { t: 'ld_max', v: 2000 }, { t: 'ad', v: 30 }]);
    const empty = fromCalcDollState(calcState('edge-addons-empty-list'));
    for (const it of empty.items) {
      expect(it.x).toBeUndefined();
      expect(it.xr).toBeUndefined();
    }
    const weapon = lookup('ta', 1900)!;
    expect(splitAddons(weapon, flattenItemStats(weapon))).toEqual({});
    expect(splitAddons(weapon, [])).toEqual({});
    // Коди-аліаси Хелпера (mana/oi_eq/ab_eq) лишаються як є — числа ядра ті самі, що в Хелпері.
    const alias = fromCalcDollState(calcState('edge-stat-alias'));
    expect(validateDoc(alias).ok).toBe(true);
    const codes = alias.items.flatMap((i) => [...(i.x || []), ...(i.e || [])].map((r) => r.t));
    expect(codes).toContain('mana');
    expect(computeStats(toDollState(hydrate(alias, lookup), CFG_MAIN))).toEqual(computeStats(calcState('edge-stat-alias')));
  });

  it('гравіювання, руна й кристал, титули, бафи', () => {
    const eng = fromCalcDollState(calcState('edge-engrave'));
    expect(eng.items.find((i) => i.i === eng.main.rv)?.e).toEqual([{ t: 'hp', v: 200 }, { t: 'wf', v: 100 }]);
    const wc = fromCalcDollState(calcState('edge-wdf-crystal'));
    const ta = wc.items.find((i) => i.i === wc.main.ta)!;
    expect(ta.w).toBe(2);
    expect(ta.c).toBe(25);
    const titles = fromCalcDollState(calcState('edge-titles-cap'));
    expect(Object.keys(titles.titles || {}).length).toBeGreaterThan(0);
    const buffs = fromCalcDollState(calcState('edge-buffs-extra'));
    expect(buffs.buffs?.extra.length).toBeGreaterThan(0);
    expect(Object.values(buffs.buffs?.cfg || {}).every((c) => typeof c.on === 'boolean' && c.lvl >= 1)).toBe(true);
    const nobuffs = fromCalcDollState({ ...calcState('typical-by'), buffCfg: { '5': { on: false, lvl: 3, side: '' } } });
    expect(nobuffs.buffs).toEqual({ cfg: { '5': { on: false, lvl: 3, side: '' } }, extra: [] });
  });

  it('рюкзак Хелпера → сироти в інвентарі (з правками екземпляра)', () => {
    const state = calcState('typical-by');
    const ring: BackpackEntry = {
      item: lookup('oq', 280)!, slot: 'cd', cat: 'oq', gems: [], refine: 7, addons: [], engrave: [{ type: 'sx', val: 3 }],
    };
    const helm: BackpackEntry = {
      item: lookup('ft', 83)!, slot: 'ft', cat: 'ft', gems: [lookup('ob', 198)!, null, null, null], refine: 0,
      addons: [...flattenItemStats(lookup('ft', 83)!), { type: 'hp', val: 50 }], wdf: lookup('wdf', 2), // руна не у зброї — відкидається
    };
    const withBp: DollState = { ...state, backpack: [null, ring, null, helm] };
    const doc = fromCalcDollState(withBp);
    expect(validateDoc(doc).ok).toBe(true);
    expect(doc.items).toHaveLength(Object.keys(state.equipped).length + 2);
    const model = hydrate(doc, lookup);
    const inv = inventoryOf(model, CFG_MAIN);
    expect(inv).toHaveLength(2);
    const [r, h] = inv.map((iid) => model.items.get(iid)!.inst);
    expect(r).toEqual({ i: r.i, cat: 'oq', id: 280, p: r.p, r: 7, e: [{ t: 'sx', v: 3 }] });
    expect(h).toEqual({ i: h.i, cat: 'ft', id: 83, p: h.p, g: [198], x: [{ t: 'hp', v: 50 }] });
    // Сироти не впливають на Головний.
    expect(computeStats(toDollState(model, CFG_MAIN))).toEqual(computeStats(state));
  });

  it('класи 11–14 і сміття — помилка українською', () => {
    const state = calcState('typical-by');
    for (const cls of ['uf', 'he', 'paladin', 'gunner']) expect(() => fromCalcDollState({ ...state, cls })).toThrow(/не підтримується/);
    expect(() => fromCalcDollState({ ...state, cls: 'zzz' })).toThrow(/невідомий клас/);
    expect(() => fromCalcDollState(null as unknown as DollState)).toThrow(/клас/);
    // Рівень і атрибути клампляться (атрибут не нижче базових 5), стать — дефолт m.
    const odd = fromCalcDollState({ ...state, level: 999, str: -5, gender: 'x' as 'm' });
    expect(odd.level).toBe(105);
    expect(odd.attrs.str).toBe(5);
    expect(odd.gender).toBe('m');
  });

  it('рівень бафа: 0 → 1 (як buffVal ядра), нема рівня → 10, понад 99 → 99', () => {
    const state = calcState('typical-by');
    const doc = fromCalcDollState({
      ...state,
      buffCfg: { '5': { on: true, lvl: 0, side: '' }, '40': { on: true, lvl: undefined as unknown as number, side: '' }, '22': { on: true, lvl: 150, side: '' } },
    });
    expect(doc.buffs?.cfg['5'].lvl).toBe(1);
    expect(doc.buffs?.cfg['40'].lvl).toBe(10);
    expect(doc.buffs?.cfg['22'].lvl).toBe(99);
  });

  it('понад бюджет атрибутів — не помилка імпорту: документ відкривається, а validateDoc каже, що виправити', () => {
    const state = calcState('typical-by');
    const doc = fromCalcDollState({ ...state, level: 10, str: 500 });
    expect(doc.attrs.str).toBe(500);
    const v = validateDoc(doc);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.recoverable).toBe(doc);
      expect(v.errors.join()).toMatch(/більше, ніж дає 10-й рівень/);
    }
  });
});
