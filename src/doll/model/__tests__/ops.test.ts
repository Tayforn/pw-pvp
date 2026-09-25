import { beforeAll, describe, expect, it } from 'vitest';
import { buffMaxLevel } from '../../core/constants';
import { getBuffById, getBuffs } from '../../core/refdata';
import { DOC_LIMITS, rollRowCount, validateDoc, type CharacterDoc, type StatRow } from '../doc';
import { CFG_MAIN, hydrate, inventoryOf, whereWorn } from '../hydrate';
import {
  addExtraBuff, addFromCatalog, createSet, defaultSetName, deleteInstance, deleteSet, duplicateInstance, equip, equipAuto,
  fillEmptyFromMain, isPlainInst, normalizeInst, pickFromCatalog, removeExtraBuff, renameSet, setAttr, setBuffLvl, setBuffSide, setCls,
  setLevel, setName, setOrphans, setPath, setSetKind, setTitle, toggleBuff, unequip, unequipAll, updateInstance,
} from '../ops';
import { inst, loadRef, lookup, mkDoc, mkSet } from './testDoc';

beforeAll(() => loadRef());

const valid = (doc: CharacterDoc): CharacterDoc => {
  const v = validateDoc(doc);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return doc;
};

describe('персонаж', () => {
  it('поля з клампами; без змін — те саме посилання', () => {
    const d = mkDoc();
    expect(setName(d, '')).toBe(d);
    expect(setName(d, 'x'.repeat(40)).name).toHaveLength(32);
    expect(setCls(d, 'by')).toBe(d);
    expect(setCls(d, 'rg').cls).toBe('rg');
    expect(setLevel(d, 500).level).toBe(105);
    expect(setLevel(d, -3).level).toBe(1);
    expect(setAttr(d, 'str', 300.7).attrs).toEqual({ str: 300, dex: 5, vit: 5, mag: 5 });
    expect(setAttr(setAttr(d, 'str', 300), 'str', 0).attrs.str).toBe(5); // нижче базових 5 у грі не буває
    // Рівень атрибутів не чіпає: набір «105» проходить через 1 і 10.
    const spent = setAttr(d, 'str', 300);
    expect(setLevel(setLevel(spent, 1), 105).attrs).toEqual(spent.attrs);
    // Імʼя: без керівних символів, різ не рве емодзі навпіл.
    expect(setName(d, 'Тай\tфорн\u0000').name).toBe('Тайфорн');
    expect(setName(d, 'x'.repeat(31) + '\u{1F600}').name).toBe('x'.repeat(31));
    expect(setName(d, 'x'.repeat(30) + '\u{1F600}').name).toBe('x'.repeat(30) + '\u{1F600}');
    expect(setTitle(d, 'hp', 100).titles).toEqual({ hp: 100 });
    expect(setTitle(setTitle(d, 'hp', 100), 'hp', 0)).not.toHaveProperty('titles');
    expect(setPath(d, 'rs').path).toBe('rs');
    expect(setPath(setPath(d, 'rs'), null)).not.toHaveProperty('path');
    expect(setPath(d, null)).toBe(d);
    // клас не знімає надіті речі
    const worn = mkDoc({ items: [inst('a', 'ta', 1900)], main: { ta: 'a' } });
    expect(setCls(worn, 'ga').main).toEqual({ ta: 'a' });
  });
});

describe('сети', () => {
  it('createSet: порожній, назва за замовчуванням, два одного виду, ліміт 5', () => {
    let d = mkDoc();
    const r1 = createSet(d, 'pz');
    expect(r1.setId).toMatch(/^[a-z0-9]{6,12}$/);
    d = r1.doc;
    expect(d.sets).toHaveLength(1);
    expect(d.sets[0]).toEqual({ id: r1.setId, name: 'ПЗ', kind: 'pz', slots: {} });
    const r2 = createSet(d, 'pz');
    d = r2.doc;
    expect(d.sets[1].name).toBe('ПЗ 2');
    expect(r2.setId).not.toBe(r1.setId);
    expect(defaultSetName(d, 'pz')).toBe('ПЗ 3');
    expect(defaultSetName(d, 'aspd')).toBe('Спів'); // аспд-сету немає — у всіх класів «Спів»
    expect(defaultSetName({ ...d, cls: 'ga' }, 'aspd')).toBe('Спів'); // маг — час співу
    d = createSet(d, 'pa', '  Моя ПА  ').doc;
    expect(d.sets[2].name).toBe('Моя ПА');
    d = createSet(d, 'aspd').doc;
    d = createSet(d, 'pz').doc;
    expect(d.sets).toHaveLength(DOC_LIMITS.sets);
    const over = createSet(d, 'pz');
    expect(over.setId).toBeNull();
    expect(over.doc).toBe(d);
    valid(d);
  });

  it('renameSet / setSetKind / deleteSet з сиротами й без', () => {
    let d = mkDoc({
      items: [inst('a', 'ta', 1900), inst('b', 'ta', 1900), inst('c', 'rv', 391), inst('d', 'oq', 284)],
      main: { ta: 'a', rv: 'c' },
      sets: [mkSet('set001', { ta: 'b', rv: 'c', cr: 'd' }), mkSet('set002', { cr: 'd' }, 'pa', 'ПА')],
    });
    expect(renameSet(d, 'set001', '   ')).toBe(d);
    expect(renameSet(d, 'set001', '\tПЗ\n2').sets[0].name).toBe('ПЗ2');
    expect(renameSet(d, 'set001', 'Проти магів').sets[0].name).toBe('Проти магів');
    expect(setSetKind(d, 'set001', 'aspd').sets[0].kind).toBe('aspd');
    expect(setSetKind(d, 'nope', 'aspd')).toBe(d);
    // b — лише в set001 → сирота після видалення; c — і в Головному; d — ще в set002.
    expect(setOrphans(d, 'set001')).toEqual(['b']);
    const keep = deleteSet(d, 'set001');
    expect(keep.sets.map((s) => s.id)).toEqual(['set002']);
    expect(keep.items.map((i) => i.i)).toEqual(['a', 'b', 'c', 'd']);
    expect(inventoryOf(hydrate(keep, lookup), CFG_MAIN)).toEqual(['b', 'd']);
    const purge = deleteSet(d, 'set001', true);
    expect(purge.items.map((i) => i.i)).toEqual(['a', 'c', 'd']);
    expect(deleteSet(d, 'nope')).toBe(d);
    d = purge;
    valid(d);
  });
});

describe('слоти', () => {
  const base = () =>
    mkDoc({
      items: [inst('a', 'ta', 1900), inst('r1', 'oq', 284), inst('r2', 'oq', 280), inst('h', 'ft', 83), inst('g', 'pk', 1)],
      main: { ta: 'a', cr: 'r1' },
      sets: [mkSet('set001', {})],
    });

  it('equip: категорія має відповідати слоту, інакше doc без змін', () => {
    const d = base();
    expect(equip(d, CFG_MAIN, 'ft', 'a')).toBe(d);
    expect(equip(d, CFG_MAIN, 'ta', 'zz')).toBe(d);
    expect(equip(d, 'nope', 'ta', 'a')).toBe(d);
    expect(equip(d, CFG_MAIN, 'ta', 'a')).toBe(d); // уже там
    expect(equip(d, CFG_MAIN, 'ft', 'h').main).toEqual({ ta: 'a', cr: 'r1', ft: 'h' });
    expect(equip(d, 'set001', 'pk' as never, 'g')).toBe(d); // джинн лише в Головному
    expect(equip(d, CFG_MAIN, 'pk', 'g').main.pk).toBe('g');
    expect(equip(d, 'set001', 'ta', 'a').sets[0].slots).toEqual({ ta: 'a' });
  });

  it('equip кілець: перенос між cr і cd, обидві руки різними кільцями', () => {
    let d = base();
    d = equip(d, CFG_MAIN, 'cd', 'r1'); // перенос з лівої на праву
    expect(d.main).toEqual({ ta: 'a', cd: 'r1' });
    d = equip(d, CFG_MAIN, 'cr', 'r2');
    expect(d.main).toEqual({ ta: 'a', cd: 'r1', cr: 'r2' });
    d = equip(d, CFG_MAIN, 'cr', 'r1'); // r1 переїжджає на ліву, cd звільняється
    expect(d.main).toEqual({ ta: 'a', cr: 'r1' });
    valid(d);
  });

  it('equipAuto: свій слот; кільця — у вільну руку; джинн у сет — ні', () => {
    let d = base();
    d = equipAuto(d, CFG_MAIN, 'r2');
    expect(d.main.cd).toBe('r2'); // cr зайнято r1
    d = equipAuto(d, CFG_MAIN, 'h');
    expect(d.main.ft).toBe('h');
    expect(equipAuto(d, 'set001', 'g')).toBe(d);
    d = equipAuto(d, 'set001', 'r1');
    expect(d.sets[0].slots).toEqual({ cr: 'r1' });
    d = equipAuto(d, 'set001', 'r2');
    expect(d.sets[0].slots).toEqual({ cr: 'r1', cd: 'r2' });
    d = equipAuto(d, 'set001', 'r1'); // уже надіте — без змін
    expect(d.sets[0].slots).toEqual({ cr: 'r1', cd: 'r2' });
  });

  it('unequip / unequipAll / fillEmptyFromMain', () => {
    let d = base();
    expect(unequip(d, CFG_MAIN, 'ft')).toBe(d);
    expect(unequip(d, CFG_MAIN, 'ta').main).toEqual({ cr: 'r1' });
    expect(unequipAll(d, CFG_MAIN).main).toEqual({});
    expect(unequipAll(d, 'set001')).toBe(d);
    d = equip(d, 'set001', 'cd', 'r1'); // у сеті r1 на правій руці
    d = fillEmptyFromMain(d, 'set001');
    // ta добирається; cr з Головного = r1, але r1 уже в сеті → не дублюється
    expect(d.sets[0].slots).toEqual({ cd: 'r1', ta: 'a' });
    expect(fillEmptyFromMain(d, 'set001')).toBe(d); // нічого додавати
    expect(unequipAll(d, 'set001').sets[0].slots).toEqual({});
    valid(d);
  });

  it('fillEmptyFromMain: кільця — пулом (кільце Головного з правої руки в сеті на лівій → друге йде на праву)', () => {
    let d = mkDoc({
      items: [inst('r1', 'oq', 284), inst('r2', 'oq', 280)],
      main: { cr: 'r1', cd: 'r2' },
      sets: [mkSet('set001', { cd: 'r1' })],
    });
    d = fillEmptyFromMain(d, 'set001');
    expect(d.sets[0].slots).toEqual({ cd: 'r1', cr: 'r2' });
    valid(d);
  });
});

describe('речі', () => {
  it('addFromCatalog: в інвентар, з опцією одразу надіти; ліміт 100', () => {
    let d = mkDoc();
    const r = addFromCatalog(d, 'ta', 1900, { p: 28526 });
    expect(r.iid).toBe('1');
    d = r.doc;
    expect(d.items).toEqual([{ i: '1', cat: 'ta', id: 1900, p: 28526 }]);
    expect(d.main).toEqual({});
    const r2 = addFromCatalog(d, 'oq', 284, { equipTo: { cfgId: CFG_MAIN, slot: 'cd' } });
    d = r2.doc;
    expect(d.main).toEqual({ cd: r2.iid });
    const r3 = addFromCatalog(d, 'oq', 284, { equipTo: { cfgId: CFG_MAIN, slot: 'ta' } }); // не той слот — річ лишається в інвентарі
    expect(r3.doc.items).toHaveLength(3);
    expect(r3.doc.main).toEqual({ cd: r2.iid });
    const full = mkDoc({ items: Array.from({ length: 100 }, (_, k) => inst('i' + k.toString(36), 'oq', 284)) });
    const over = addFromCatalog(full, 'oq', 284);
    expect(over.iid).toBeNull();
    expect(over.doc).toBe(full);
    valid(d);
  });

  it('duplicateInstance: копія одразу за оригіналом, ніде не надіта', () => {
    const d = mkDoc({ items: [inst('a', 'ta', 1900, { r: 10, g: [54, 55] }), inst('b', 'ft', 83)], main: { ta: 'a' }, nextIid: 5 });
    const r = duplicateInstance(d, 'a');
    expect(r.iid).toBe('5');
    expect(r.doc.items.map((i) => i.i)).toEqual(['a', '5', 'b']);
    expect(r.doc.items[1]).toEqual({ i: '5', cat: 'ta', id: 1900, r: 10, g: [54, 55] });
    expect(whereWorn(r.doc, '5')).toEqual([]);
    expect(duplicateInstance(d, 'zz').iid).toBeNull();
  });

  it('updateInstance з Головного — на місці (сет, що ділить річ, бачить зміну)', () => {
    const d = mkDoc({ items: [inst('a', 'ta', 1900)], main: { ta: 'a' }, sets: [mkSet('set001', { ta: 'a' })] });
    const r = updateInstance(d, CFG_MAIN, 'a', { r: 12, x: [{ t: 'sx', v: 20 }] });
    expect(r.iid).toBe('a');
    expect(r.doc.items).toEqual([{ i: 'a', cat: 'ta', id: 1900, r: 12, x: [{ t: 'sx', v: 20 }] }]);
    expect(r.doc.sets[0].slots).toEqual({ ta: 'a' });
    expect(r.doc.main).toEqual({ ta: 'a' });
  });

  it('updateInstance з вкладки сету, річ надіта ще й у Головному — копія стає в сет', () => {
    const d = mkDoc({ items: [inst('a', 'ta', 1900), inst('b', 'ft', 83)], main: { ta: 'a', ft: 'b' }, sets: [mkSet('set001', { ta: 'a' })], nextIid: 7 });
    const r = updateInstance(d, 'set001', 'a', { r: 12 });
    expect(r.iid).toBe('7');
    expect(r.doc.items.map((i) => i.i)).toEqual(['a', '7', 'b']);
    expect(r.doc.items[0]).toEqual({ i: 'a', cat: 'ta', id: 1900 }); // оригінал не зачеплено
    expect(r.doc.items[1]).toEqual({ i: '7', cat: 'ta', id: 1900, r: 12 });
    expect(r.doc.main).toEqual({ ta: 'a', ft: 'b' });
    expect(r.doc.sets[0].slots).toEqual({ ta: '7' });
    valid(r.doc);
    // Річ лише в цьому сеті — правка на місці, без копії.
    const r2 = updateInstance(r.doc, 'set001', '7', { r: 11 });
    expect(r2.iid).toBe('7');
    expect(r2.doc.items).toHaveLength(3);
    expect(r2.doc.items[1].r).toBe(11);
    // Річ з інвентаря сету, надіта в Головному (позначка «Г») — копія лишається в інвентарі.
    const r3 = updateInstance(r2.doc, 'set001', 'b', { r: 3 });
    expect(r3.iid).not.toBe('b');
    expect(whereWorn(r3.doc, r3.iid)).toEqual([]);
    expect(r3.doc.main.ft).toBe('b');
  });

  it('updateInstance: копія неможлива при ліміті — doc без змін; патч нормалізується', () => {
    const items = Array.from({ length: 100 }, (_, k) => inst('i' + k.toString(36), 'ta', 1900));
    const d = mkDoc({ items, main: { ta: 'i0' }, sets: [mkSet('set001', { ta: 'i0' })] });
    expect(updateInstance(d, 'set001', 'i0', { r: 1 }).doc).toBe(d);
    const n = updateInstance(d, CFG_MAIN, 'i0', { r: 0, g: [0, 0], x: [], e: [{ t: 'hp', v: 5 }], w: 0, xr: true }).doc.items[0];
    expect(n).toEqual({ i: 'i0', cat: 'ta', id: 1900, e: [{ t: 'hp', v: 5 }] });
    expect(normalizeInst({ i: 'q', cat: 'ft', id: 83, w: 3, c: 4, g: [1, 2, 3, 4, 5], r: 99 })).toEqual({ i: 'q', cat: 'ft', id: 83, r: 12, g: [1, 2, 3, 4] });
  });

  it('deleteInstance: каскадно з усіх конфігурацій', () => {
    const d = mkDoc({
      items: [inst('a', 'oq', 284), inst('b', 'oq', 280)],
      main: { cr: 'a', cd: 'b' },
      sets: [mkSet('set001', { cr: 'a' }), mkSet('set002', { cd: 'b' }, 'pa', 'ПА')],
    });
    const r = deleteInstance(d, 'a');
    expect(r.items.map((i) => i.i)).toEqual(['b']);
    expect(r.main).toEqual({ cd: 'b' });
    expect(r.sets[0].slots).toEqual({});
    expect(r.sets[1]).toBe(d.sets[1]); // не зачеплений сет — те саме посилання
    expect(deleteInstance(d, 'zz')).toBe(d);
    valid(r);
  });
});

describe('ліміти: операції не виводять документ за DOC_LIMITS', () => {
  const rows = (n: number): StatRow[] => Array.from({ length: n }, (_, k) => ({ t: 'hp', v: k + 1 }));
  /** 40 речей по 10 рядків = рівно 400; перша надіта в Головному і в сеті. */
  const atRows = () =>
    mkDoc({
      items: Array.from({ length: 40 }, (_, k) => inst('i' + k.toString(36), 'ta', 1900, { x: rows(10) })),
      main: { ta: 'i0' },
      sets: [mkSet('set001', { ta: 'i0' })],
      nextIid: 100,
    });

  it('копія речі з ролами понад 400 рядків — blocked rolls, doc без змін', () => {
    const d = atRows();
    expect(rollRowCount(d)).toBe(DOC_LIMITS.rollRows);
    valid(d);
    const r = duplicateInstance(d, 'i1');
    expect(r).toEqual({ doc: d, iid: null, blocked: 'rolls' });
    const items = Array.from({ length: 100 }, (_, k) => inst('i' + k.toString(36), 'oq', 284));
    expect(duplicateInstance(mkDoc({ items }), 'i0').blocked).toBe('items');
    // Річ без ролів копіюється і при 400 рядках.
    const plain = { ...d, items: [...d.items, inst('p', 'oq', 284)] };
    expect(duplicateInstance(plain, 'p').iid).not.toBeNull();
  });

  it('авто-копія при правці спільної речі з сету — blocked rolls; правка на місці, що додає рядки, — теж', () => {
    const d = atRows();
    const copy = updateInstance(d, 'set001', 'i0', { r: 5 });
    expect(copy.blocked).toBe('rolls');
    expect(copy.doc).toBe(d);
    const grow = updateInstance(d, CFG_MAIN, 'i1', { x: rows(11) });
    expect(grow.blocked).toBe('rolls');
    expect(grow.doc).toBe(d);
    // «Замінити базу» (база + роли) понад ліміт — так само.
    expect(updateInstance(d, CFG_MAIN, 'i1', { xr: true, x: [...rows(10), { t: 'ld_min', v: 1 }] }).blocked).toBe('rolls');
    // Правка без нових рядків і прибирання рядків проходять.
    expect(updateInstance(d, CFG_MAIN, 'i1', { r: 3 }).blocked).toBeUndefined();
    const less = updateInstance(d, CFG_MAIN, 'i1', { x: rows(2) });
    expect(less.blocked).toBeUndefined();
    expect(rollRowCount(less.doc)).toBe(392);
  });

  it('документ понад ліміт (стара чернетка) можна виправляти: правка, що зменшує рядки, проходить', () => {
    const over = { ...atRows(), items: [...atRows().items, inst('z', 'ta', 1900, { x: rows(5) })] };
    expect(rollRowCount(over)).toBe(405);
    const r = updateInstance(over, CFG_MAIN, 'z', { x: rows(1) });
    expect(r.blocked).toBeUndefined();
    expect(rollRowCount(r.doc)).toBe(401);
    expect(updateInstance(over, CFG_MAIN, 'z', { x: rows(6) }).blocked).toBe('rolls');
  });

  it('жодна послідовність операцій біля лімітів не дає документа, який не пройде validateDoc', () => {
    let d = atRows();
    // 59 речей без ролів → 99 речей, 400 рядків.
    for (let k = 0; k < 59; k++) d = addFromCatalog(d, 'oq', 284).doc;
    expect(d.items).toHaveLength(99);
    valid(d);
    const ids = () => d.items.map((i) => i.i);
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let step = 0; step < 300; step++) {
      const pick = ids()[rnd(ids().length)];
      const cfg = d.sets.length && rnd(2) ? d.sets[rnd(d.sets.length)].id : CFG_MAIN;
      switch (rnd(7)) {
        case 0:
          d = duplicateInstance(d, pick).doc;
          break;
        case 1:
          d = updateInstance(d, cfg, pick, { x: [...(d.items.find((i) => i.i === pick)?.x || []), { t: 'sx', v: 1 }] }).doc;
          break;
        case 2:
          d = updateInstance(d, cfg, pick, { r: rnd(13) }).doc;
          break;
        case 3:
          d = addFromCatalog(d, 'ta', 1900, { equipTo: { cfgId: cfg, slot: 'ta' } }).doc;
          break;
        case 4:
          d = createSet(d, rnd(2) ? 'pz' : 'aspd').doc;
          break;
        case 5:
          d = equipAuto(d, cfg, pick);
          break;
        default:
          d = pickFromCatalog(d, cfg, 'ta', 'ta', 1900).doc;
      }
      const v = validateDoc(JSON.parse(JSON.stringify(d)));
      if (!v.ok) throw new Error('крок ' + step + ': ' + v.errors.join('; '));
    }
  });
});

describe('pickFromCatalog («Обрати іншу»)', () => {
  it('попередня річ «як з каталогу», надіта лише тут, — замінюється на місці, без сироти', () => {
    const d = mkDoc({ items: [inst('a', 'ta', 1900), inst('b', 'ft', 83)], main: { ta: 'a', ft: 'b' }, nextIid: 9 });
    expect(isPlainInst(d.items[0])).toBe(true);
    const r = pickFromCatalog(d, CFG_MAIN, 'ta', 'ta', 1901, { p: 5 });
    expect(r.iid).toBe('9');
    expect(r.dropped).toBe('a');
    expect(r.kept).toBeNull();
    expect(r.doc.items).toEqual([{ i: '9', cat: 'ta', id: 1901, p: 5 }, { i: 'b', cat: 'ft', id: 83 }]);
    expect(r.doc.main).toEqual({ ta: '9', ft: 'b' });
    valid(r.doc);
  });

  it('річ із правками чи надіта ще десь лишається в інвентарі (kept)', () => {
    const edited = mkDoc({ items: [inst('a', 'ta', 1900, { r: 3 })], main: { ta: 'a' } });
    const r1 = pickFromCatalog(edited, CFG_MAIN, 'ta', 'ta', 1901);
    expect(r1.dropped).toBeNull();
    expect(r1.kept).toBe('a');
    expect(r1.doc.items.map((i) => i.i)).toEqual(['a', r1.iid]);
    const shared = mkDoc({ items: [inst('a', 'ta', 1900)], main: { ta: 'a' }, sets: [mkSet('set001', { ta: 'a' })] });
    const r2 = pickFromCatalog(shared, 'set001', 'ta', 'ta', 1901);
    expect(r2.kept).toBe('a');
    expect(r2.doc.main.ta).toBe('a');
    expect(r2.doc.sets[0].slots.ta).toBe(r2.iid);
    // Порожній слот — просто нова річ; чужа категорія — без змін.
    expect(pickFromCatalog(mkDoc(), CFG_MAIN, 'ta', 'ta', 1900).kept).toBeNull();
    const d = mkDoc();
    expect(pickFromCatalog(d, CFG_MAIN, 'ta', 'ft', 83).doc).toBe(d);
  });

  it('при 100 речах заміна «чистої» речі все одно можлива (кількість не росте)', () => {
    const items = Array.from({ length: 100 }, (_, k) => inst('i' + k.toString(36), 'ta', 1900));
    const d = mkDoc({ items, main: { ta: 'i0' } });
    const r = pickFromCatalog(d, CFG_MAIN, 'ta', 'ta', 1901);
    expect(r.blocked).toBeUndefined();
    expect(r.doc.items).toHaveLength(100);
    const edited = { ...d, items: [{ ...items[0], r: 1 }, ...items.slice(1)] };
    expect(pickFromCatalog(edited, CFG_MAIN, 'ta', 'ta', 1901).blocked).toBe('items');
  });
});

describe('бафи', () => {
  it('toggleBuff / setBuffLvl / setBuffSide / add / remove', () => {
    const anyBuff = Object.values(getBuffs() || {}).flat()[0];
    expect(anyBuff).toBeTruthy();
    const id = anyBuff.id;
    let d = mkDoc();
    d = toggleBuff(d, id);
    expect(d.buffs).toEqual({ cfg: { [id]: { on: true, lvl: 10, side: '' } }, extra: [] });
    d = toggleBuff(d, id);
    expect(d.buffs?.cfg[String(id)].on).toBe(false);
    const max = buffMaxLevel(getBuffById(id)!);
    d = setBuffLvl(d, id, 999);
    expect(d.buffs?.cfg[String(id)].lvl).toBeLessThanOrEqual(max);
    d = setBuffLvl(d, id, 0);
    expect(d.buffs?.cfg[String(id)].lvl).toBe(1);
    d = addExtraBuff(d, 424242);
    expect(d.buffs?.extra).toEqual([424242]);
    expect(d.buffs?.cfg['424242']).toEqual({ on: true, lvl: 10, side: '' });
    d = removeExtraBuff(d, 424242);
    expect(d.buffs?.extra).toEqual([]);
    expect(d.buffs?.cfg['424242']).toBeUndefined();
    expect(removeExtraBuff(d, 424242)).toBe(d);
    valid(d);
  });

  it('сторона: лише для бафів зі сторонами; вибір сторони = максимальний рівень', () => {
    const sided = Object.values(getBuffs() || {})
      .flat()
      .find((b) => Object.values(b.qc).some((q) => q && typeof q === 'object' && Object.values(q as object).some((lv) => lv && typeof lv === 'object' && 'rs' in (lv as object))));
    expect(sided).toBeTruthy();
    const id = sided!.id;
    let d = setBuffSide(mkDoc(), id, 'rs');
    const max = buffMaxLevel(sided!);
    expect(d.buffs?.cfg[String(id)]).toEqual({ on: false, lvl: max, side: 'rs' });
    d = setBuffSide(d, id, '');
    expect(d.buffs?.cfg[String(id)].side).toBe('');
    expect(d.buffs?.cfg[String(id)].lvl).toBe(max - 1);
    d = setBuffLvl(d, id, 999);
    expect(d.buffs?.cfg[String(id)].lvl).toBe(max - 1); // без сторони — останній рівень недоступний
    const plain = Object.values(getBuffs() || {})
      .flat()
      .find((b) => !Object.values(b.qc).some((q) => q && typeof q === 'object' && Object.values(q as object).some((lv) => lv && typeof lv === 'object' && 'rs' in (lv as object))));
    if (plain) expect(setBuffSide(mkDoc(), plain.id, 'rs')).toEqual(mkDoc());
  });
});
