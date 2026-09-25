import { beforeAll, describe, expect, it } from 'vitest';
import { deriveIb } from '../../core/buffs';
import { computeStats, flattenItemStats } from '../../core/stats';
import { computeSummary } from '../../core/summary';
import { SLOT_KEYS, type CharacterDoc } from '../doc';
import { CFG_MAIN, dehydrate, docCats, effectiveSlots, hydrate, inventoryOf, newIid, slotKey, toDollState, whereWorn } from '../hydrate';
import { classPassives } from '../passives';
import { BY, calcState, fixtures, inst, loadRef, lookup, mkDoc, mkSet, modelFrom } from './testDoc';

beforeAll(() => loadRef());

/** Головний із усіх речей typical-by + сет із ПЗ-зброєю (копія зброї з ролом sx). */
function twoCfgDoc(): CharacterDoc {
  const items = SLOT_KEYS.map((s) => inst(s, BY[s].cat, BY[s].id));
  items.push(inst('wpz', 'ta', 1900, { x: [{ t: 'sx', v: 20 }] }));
  items.push(inst('orph', 'oq', 284)); // сирота — ніде не надіта
  const main = Object.fromEntries(SLOT_KEYS.map((s) => [s, s])) as CharacterDoc['main'];
  return mkDoc({ items, main, sets: [mkSet('set001', { ta: 'wpz' })], nextIid: 100 });
}

describe('round-trip фікстура → документ → ядро', () => {
  for (const group of ['manual', 'random'] as const) {
    it(`${group}: computeStats з toDollState(hydrate(doc)) = computeStats білда Хелпера`, () => {
      for (const fx of fixtures(group)) {
        const state = calcState(fx.name);
        const model = modelFrom(fx.name);
        const back = toDollState(model, CFG_MAIN);
        expect(computeStats(back), fx.name).toEqual(computeStats(state));
        // Речі, камені, заточка, гравіювання, руни — ті самі.
        expect(Object.keys(back.equipped).sort(), fx.name).toEqual(Object.keys(state.equipped).sort());
        for (const slot of Object.keys(state.equipped)) {
          expect(back.equipped[slot].id, `${fx.name}/${slot}`).toBe(state.equipped[slot].id);
          expect(back.gems[slot].map((g) => g?.id ?? 0), `${fx.name}/${slot}`).toEqual(state.gems[slot].map((g) => g?.id ?? 0));
          expect(back.refine[slot] || 0).toBe(state.refine[slot] || 0);
          expect(back.engrave[slot] || []).toEqual(state.engrave[slot] || []);
          expect(back.wdf[slot]?.id ?? null).toBe(state.wdf[slot]?.id ?? null);
          expect(back.crystal[slot]?.id ?? null).toBe(state.crystal[slot]?.id ?? null);
        }
        expect(back.backpack).toEqual([]);
        expect(back.server).toBe('noServer');
      }
    });
  }

  it('з бафами: deriveIb і всі 32 комірки зведення = Хелпер (рівні бафів імпортуються як у ядрі calc)', () => {
    for (const fx of [...fixtures('manual'), ...fixtures('random')]) {
      const state = calcState(fx.name);
      const back = toDollState(modelFrom(fx.name), CFG_MAIN, { buffs: true });
      // Хелпер пасивок сам не вмикає — ті, що гравець не налаштовував, лялька додає; накладаємо їх і на Хелпер.
      for (const p of classPassives(state.cls)) {
        const k = String(p.id);
        if (state.buffCfg[k]) expect(back.buffCfg[k], fx.name + ' пасивка ' + k).toEqual(state.buffCfg[k]);
        else state.buffCfg[k] = back.buffCfg[k];
      }
      const ibCalc = deriveIb(state);
      const ibPvp = deriveIb(back);
      expect(ibPvp, fx.name).toEqual(ibCalc);
      expect(computeSummary(back, computeStats(back).t, ibPvp).cells, fx.name).toEqual(computeSummary(state, computeStats(state).t, ibCalc).cells);
    }
  });

  it('dehydrate(hydrate(doc)) — той самий документ', () => {
    const doc = twoCfgDoc();
    const model = hydrate(doc, lookup);
    expect(dehydrate(model)).toBe(doc);
    expect(JSON.parse(JSON.stringify(dehydrate(model)))).toEqual(JSON.parse(JSON.stringify(doc)));
    expect(model.items.size).toBe(doc.items.length);
    expect(model.items.get('ta')?.item?.id).toBe(1900);
    expect(model.items.get('ta')?.gems).toEqual([null, null]); // зброя — 2 гнізда
    expect(model.items.get('rv')?.gems).toHaveLength(4);
    expect(model.items.get('cr')?.gems).toEqual([]);
  });

  it('невідома річ → item null, слот у DollState порожній', () => {
    const doc = mkDoc({ items: [inst('a', 'ta', 999999), inst('b', 'ft', 83, { g: [999999, 198] })], main: { ta: 'a', ft: 'b' } });
    const model = hydrate(doc, lookup);
    expect(model.items.get('a')?.item).toBeNull();
    expect(model.items.get('b')?.gems.map((g) => g?.id ?? null)).toEqual([null, 198, null, null]);
    const state = toDollState(model, CFG_MAIN);
    expect(state.equipped.ta).toBeUndefined();
    expect(state.equipped.ft?.id).toBe(83);
  });

  it('docCats: категорії речей + завжди ob/wdf/crystal', () => {
    expect(docCats(mkDoc())).toEqual(['crystal', 'ob', 'wdf']);
    expect(docCats(mkDoc({ items: [inst('a', 'ta', 1), inst('b', 'oq', 2), inst('c', 'ta', 3)] }))).toEqual(['crystal', 'ob', 'oq', 'ta', 'wdf']);
  });
});

describe('effectiveSlots / toDollState по конфігураціях', () => {
  it('сет: власні слоти + решта з Головного; без fillFromMain — лише власні + джинн/політ', () => {
    const model = hydrate(twoCfgDoc(), lookup);
    const full = effectiveSlots(model, 'set001');
    expect(full.ta).toBe('wpz');
    expect(full.rv).toBe('rv');
    expect(full.pk).toBe('pk');
    expect(full.ic).toBe('ic');
    expect(Object.keys(full)).toHaveLength(17);
    const own = effectiveSlots(model, 'set001', { fillFromMain: false });
    expect(own).toEqual({ ta: 'wpz', pk: 'pk', ic: 'ic' });
    expect(effectiveSlots(model, CFG_MAIN)).toEqual(model.doc.main);
    expect(effectiveSlots(model, 'nope')).toEqual({});
  });

  it('кільця — пулом: кільце Головного, надіте в сеті на іншу руку, не «зʼїдає» друге', () => {
    const two = (slots: Record<string, string>) =>
      mkDoc({ items: [inst('a', 'oq', 284), inst('b', 'oq', 280), inst('x', 'oq', 281)], main: { cr: 'a', cd: 'b' }, sets: [mkSet('set001', slots)] });
    // b з правої руки Головного — у сеті на лівій: права рука бере a, а не лишається порожньою.
    expect(effectiveSlots(hydrate(two({ cr: 'b' }), lookup), 'set001')).toEqual({ cr: 'b', cd: 'a' });
    expect(effectiveSlots(hydrate(two({ cd: 'a' }), lookup), 'set001')).toEqual({ cr: 'b', cd: 'a' });
    // Своє кільце на лівій — права бере кільце Головного з тієї ж руки (b), як і раніше.
    expect(effectiveSlots(hydrate(two({ cr: 'x' }), lookup), 'set001')).toEqual({ cr: 'x', cd: 'b' });
    // Обидві руки свої — з Головного нічого.
    expect(effectiveSlots(hydrate(two({ cr: 'x', cd: 'a' }), lookup), 'set001')).toEqual({ cr: 'x', cd: 'a' });
    // Кільце Головного в сеті двічі не опиняється.
    const eff = effectiveSlots(hydrate(two({ cd: 'b' }), lookup), 'set001');
    expect(eff).toEqual({ cr: 'a', cd: 'b' });
  });

  it('toDollState: addons = база ++ x; xr — x замінює базу; без x — порожньо (база ядра)', () => {
    const doc = mkDoc({
      attrs: { str: 500, dex: 500, vit: 500, mag: 500 }, // щоб зброя проходила вимоги й давала стати
      items: [inst('a', 'ta', 1900, { x: [{ t: 'sx', v: 20 }] }), inst('b', 'ta', 1900, { xr: true, x: [{ t: 'ld_min', v: 1 }] }), inst('c', 'ta', 1900)],
      main: { ta: 'a' },
      sets: [mkSet('set001', { ta: 'b' }), mkSet('set002', { ta: 'c' })],
    });
    const model = hydrate(doc, lookup);
    const weapon = lookup('ta', 1900)!;
    expect(toDollState(model, CFG_MAIN).addons.ta).toEqual([...flattenItemStats(weapon), { type: 'sx', val: 20 }]);
    expect(toDollState(model, 'set001').addons.ta).toEqual([{ type: 'ld_min', val: 1 }]);
    expect(toDollState(model, 'set002').addons.ta).toEqual([]);
    const t = computeStats(toDollState(model, CFG_MAIN)).t;
    expect(t.sx).toBe(20 + (computeStats(toDollState(model, 'set002')).t.sx || 0));
  });

  it('бафи — лише при opts.buffs; титули — лише додатні', () => {
    const doc = mkDoc({ buffs: { cfg: { '12': { on: true, lvl: 5, side: 'rs' } }, extra: [12] }, titles: { hp: 100, ld: 0 } });
    const model = hydrate(doc, lookup);
    // Без бафів лишаються пасивки класу (Воїн — 4 техніки бою, 10 рівень без шляху).
    const passive = { on: true, lvl: 10, side: '' };
    expect(toDollState(model, CFG_MAIN).buffCfg).toEqual({ '17': passive, '18': passive, '19': passive, '20': passive });
    expect(toDollState(model, CFG_MAIN).extraBuffs).toEqual([]);
    const withBuffs = toDollState(model, CFG_MAIN, { buffs: true });
    expect(withBuffs.buffCfg).toEqual({ '12': { on: true, lvl: 5, side: 'rs' }, '17': passive, '18': passive, '19': passive, '20': passive });
    expect(withBuffs.extraBuffs).toEqual([12]);
    expect(withBuffs.titles).toEqual({ hp: 100 });
    expect(withBuffs.cls).toBe('by');
    expect(withBuffs.level).toBe(105);
  });
});

describe('inventoryOf / whereWorn / slotKey / newIid', () => {
  it('інвентар = не надіте в конфігурації, у порядку пулу', () => {
    const model = hydrate(twoCfgDoc(), lookup);
    expect(inventoryOf(model, CFG_MAIN)).toEqual(['wpz', 'orph']);
    const inv = inventoryOf(model, 'set001');
    expect(inv).not.toContain('wpz');
    expect(inv).not.toContain('pk'); // джинн Головного у сет не покласти — він не в інвентарі сету
    expect(inv).not.toContain('ic');
    expect(inv).toContain('ta');
    expect(inv).toContain('orph');
    expect(inv.indexOf('ta')).toBeLessThan(inv.indexOf('orph'));
  });

  it('whereWorn: Головний і сети', () => {
    const model = hydrate(twoCfgDoc(), lookup);
    expect(whereWorn(model, 'ta')).toEqual([{ cfgId: 'main', slot: 'ta' }]);
    expect(whereWorn(model, 'wpz')).toEqual([{ cfgId: 'set001', slot: 'ta' }]);
    expect(whereWorn(model, 'orph')).toEqual([]);
    expect(whereWorn(model.doc, 'ta')).toEqual([{ cfgId: 'main', slot: 'ta' }]);
  });

  it('slotKey: однаковий вміст → однаковий ключ; порядок ролів і каменів не важить', () => {
    const doc = mkDoc({
      items: [
        inst('a', 'ta', 1900, { r: 5, g: [54, 55], x: [{ t: 'sx', v: 1 }, { t: 'ad', v: 2 }] }),
        inst('b', 'ta', 1900, { r: 5, g: [55, 54], x: [{ t: 'ad', v: 2 }, { t: 'sx', v: 1 }] }),
        inst('c', 'ta', 1900, { r: 6, g: [54, 55], x: [{ t: 'sx', v: 1 }, { t: 'ad', v: 2 }] }),
        inst('d', 'ta', 1900, { r: 5, g: [54, 55], xr: true, x: [{ t: 'sx', v: 1 }, { t: 'ad', v: 2 }] }),
        inst('e', 'ta', 1900, { r: 5, g: [54, 55], x: [{ t: 'sx', v: 1 }, { t: 'ad', v: 2 }], w: 2 }),
      ],
    });
    const m = hydrate(doc, lookup);
    const k = (i: string) => slotKey(m.items.get(i)!);
    expect(k('a')).toBe(k('b'));
    expect(k('a')).not.toBe(k('c'));
    expect(k('a')).not.toBe(k('d'));
    expect(k('a')).not.toBe(k('e'));
  });

  it('newIid: base36 з лічильника, оминає зайняті', () => {
    const doc = mkDoc({ items: [inst('1', 'oq', 284), inst('2', 'oq', 284)], nextIid: 1 });
    const r = newIid(doc);
    expect(r.iid).toBe('3');
    expect(r.doc.nextIid).toBe(4);
    expect(doc.nextIid).toBe(1); // вихідний не змінено
    expect(newIid({ ...doc, nextIid: 36 }).iid).toBe('10');
  });
});
