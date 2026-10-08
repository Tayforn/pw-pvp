import { beforeAll, describe, expect, it } from 'vitest';
import { classPointsFor, computeGearScoreWith, normalizeRules, registrationScore } from '../../../data/gearRules';
import type { PlayerGear } from '../../../data/types';
import { validateDoc, type CharacterDoc, type SlotKey } from '../doc';
import { ITEM_BREAKDOWN_MAX_BYTES, WHY_MAX, breakdownBytes, itemBreakdown, scoreItems, type ItemRow } from '../itemScore';
import { duplicateInstance, equip, updateInstance } from '../ops';
import { charLevelOf, genieOf, CLS_CHAR } from '../sheet';
import { BY, docFrom, inst, loadRef, lookup, mkSet } from './testDoc';

beforeAll(() => loadRef());

const rules = normalizeRules({});

/** Знімок заявки власника (regs_snap.json, 25.09.2026): лучник 104, R9R2 +12, R8R +9 ×4,
 * ШГ/Вознєс +11, Срібний місяць + R9, сети «Спів» (свій плащ, намисто, пояс, трактат) і «ПЗ»
 * (свій лук R8R з ПЗ +21 ролами). */
const SNAP = {
  v: 2, cls: 'js', name: 'Tayforn', path: 'rs', level: 104, gender: 'm', nextIid: 24,
  main: { cd: '7', cr: '6', ft: '1', it: 'h', mj: 'd', pk: 'g', qn: '3', rv: 'a', rx: 'c', st: '5', ta: '8', tg: 'b', vx: 'e', wy: '2' },
  sets: [
    { id: 's0000i', kind: 'aspd', name: 'Спів', slots: { cd: '7', cr: '6', ft: '1', it: 'h', mj: 'd', qn: 'f', rv: 'a', rx: 'c', st: 'k', ta: '8', tg: 'b', vx: 'l', wy: 'j' } },
    { id: 's0000m', kind: 'pz', name: 'ПЗ', slots: { cd: '7', cr: '6', ft: '1', it: 'h', mj: 'd', qn: '3', rv: 'a', rx: 'c', st: '5', ta: 'n', tg: 'b', vx: 'e', wy: '2' } },
  ],
  attrs: { dex: 455, mag: 5, str: 70, vit: 5 },
  buffs: { cfg: { '28': { on: true, lvl: 11, side: 'rs' }, '164': { on: true, lvl: 11, side: 'rs' } }, extra: [] },
  items: [
    { e: [{ t: 'ld', v: 150 }], g: [57, 57, 57, 57], i: '1', p: 38256, r: 11, id: 83, cat: 'ft' },
    { e: [{ t: 'wf', v: 330 }], g: [57, 57, 57, 57], i: '2', p: 38257, r: 11, id: 40, cat: 'wy' },
    { i: '3', p: 17634, id: 56, cat: 'qn' },
    { i: '4', p: 23617, r: 10, id: 152, cat: 'vx' },
    { e: [{ t: 'ab_gq', v: 330 }], i: '5', p: 24686, r: 10, id: 179, cat: 'st' },
    { e: [{ t: 'bu', v: 2 }], i: '6', p: 37009, r: 9, id: 180, cat: 'oq' },
    { i: '7', p: 28607, id: 184, cat: 'oq' },
    {
      g: [112, 112], i: '8', p: 36352, r: 12, id: 1927, xr: true, cat: 'ta',
      x: [{ t: 'ld_min', v: 1282 }, { t: 'ld_max', v: 2381 }, { t: 'ad', v: 50 }, { t: 'xn', v: 0.1 }, { t: 'uy', v: 25 }, { t: 'hp', v: 500 }, { t: 'ld', v: 84 }, { t: 'ld', v: 84 }],
    },
    { g: [52, 52, 52, 52], i: 'a', p: 32276, r: 9, x: [{ t: 'lf', v: 8 }, { t: 'uy', v: 8 }, { t: 'bu', v: 1 }], id: 373, cat: 'rv' },
    { g: [52, 52, 52, 52], i: 'b', p: 32286, r: 9, x: [{ t: 'uy', v: 10 }, { t: 'qe', v: 129 }, { t: 'hp', v: 123 }], id: 340, cat: 'tg' },
    { g: [52, 52, 52, 52], i: 'c', p: 32726, r: 9, x: [{ t: 'hp', v: 108 }, { t: 'uy', v: 9 }, { t: 'hp', v: 103 }], id: 304, cat: 'rx' },
    { g: [52, 52, 52, 52], i: 'd', p: 32710, r: 9, x: [{ t: 'wf', v: 205 }, { t: 'hp', v: 121 }, { t: 'ia', v: 2 }], id: 293, cat: 'mj' },
    { e: [{ t: 'tx', v: 10 }, { t: 'uy', v: 10 }, { t: 'om', v: 11 }], i: 'e', p: 23614, r: 10, id: 157, cat: 'vx' },
    { i: 'f', p: 17670, id: 92, cat: 'qn' },
    { i: 'g', p: 23754, id: 3, cat: 'pk' },
    { i: 'h', p: 30252, id: 20, cat: 'it' },
    { g: [129, 129, 129, 129], i: 'j', p: 21398, r: 9, id: 54, cat: 'wy' },
    { i: 'k', p: 20375, x: [{ t: 'ci', v: 6 }, { t: 'hp', v: 150 }], id: 267, cat: 'st' },
    { i: 'l', p: 6240, x: [{ t: 'ci', v: 6 }, { t: 'wf', v: 81 }], id: 186, cat: 'vx' },
    { i: 'n', p: 32263, x: [{ t: 'sx', v: 21 }, { t: 'om', v: 14 }, { t: 'ia', v: 2 }, { t: 'ab_gq', v: 419 }], id: 1816, cat: 'ta' },
  ],
  sheet: { shg: true, genie: 'g100', ring1: 'silver', ring2: 'r9', tract: 't6', voznes: true, armorSet: 'r8r', shgRefine: 11, weaponGrade: 'r9r2', voznesRefine: 11 },
  titles: { ae: 432, ld: 161, qe: 243, wf: 237, xq: 185, ab_gq: 222 },
};

function tay(): CharacterDoc {
  const v = validateDoc(SNAP);
  if (!v.ok) throw new Error(v.errors.join('; '));
  return v.doc;
}
const rowOf = (rows: ItemRow[], catId: number, cfg?: number) => rows.find((r) => r.catId === catId && (cfg === undefined || r.cfg === cfg));
/** Скор для 3×3 так, як його складе заявка: клас + рівень + джин + itemPoints. */
const score3 = (doc: CharacterDoc, itemPoints: number) =>
  Math.round(classPointsFor(rules, CLS_CHAR[doc.cls], 3) + rules.level[charLevelOf(doc.level)] + rules.genie[genieOf(doc) ?? 'g60'] + itemPoints);
/** Лагеря (+2 ПЗ) у всі гнізда. */
const CAMP = [57, 57, 57, 57];

describe('скор v2 «від речей»: заявка власника', () => {
  // Розклад на вбудованій balance-v1.0 (лучник; рядки округлено до 2 знаків):
  //  Головний: «Комплект твердині» R9R2 +12, абілка ka, 2× «Прическа майнкрафта» (12 рів.) — 60 + 25 + 2 × 14/24 + 15 = 101.17
  //            ШГ +11 з 4 Лагерями — 15 + 11 + 4 × 2 = 34 (без armorRefine/6 — п. 2 рішень)
  //            Вознєс +11 з 4 Лагерями — 10 + 11 + 8 = 29; бонус за обидві — 5
  //            4 × R8R +9 з 4 Сюань Юань — 22/4 + 23/6 + 4 × 14/24 = 11.67 → 46.67
  //            кільця Срібний місяць 6 + R9 9 = 15; трактат «Феникс…» (6 грейд) 5; намисто, пояс, стріли, джин — 0
  //  сет «ПЗ»: «Вітер мисливця-тіні» (R8R, ПЗ +21 ролами; у каталозі ПЗ 0) — свап-зброя: 21 ПЗ × 1 = 21 (стеля 25), у mainPoints
  //  сет «Спів»: «Плащ тишины» +9 («Жезл друїда» 7 рів. = 0) — 23/6 = 3.83; «Девять кудзу» (7 грейд) 8 → 11.83 (стелі у v1.0 немає)
  //  itemPoints = 251.85 + 11.83 + 5 = 268.68; скор 3×3 = клас 8 + рівень 7 (104) + джин 10 (анкета g100) + 268.68 → 294.
  // Критики (v2_critics) рахували 277 на тій самій шкалі до рішень читальної перевірки. Різниця +17:
  //  +21 ПЗ свап-лука з ролів (п. 1), −9.67 armorRefine/6 на ШГ/Вознєс (п. 2), +5 трактат Головного (6 грейд) окремо
  //  від трактату сету «Спів» (п. 7: у кожному сеті свій, а не один «найкращий»); решта 0.67 — округлення рядків.
  it('розклад по речах: 268.68 балів за речі, скор 3×3 = 294', () => {
    const doc = tay();
    const r = scoreItems(doc, rules, lookup);
    expect(r.itemPoints).toBe(268.68);
    expect(r.mainTotal).toBe(251.85);
    expect(r.setsRaw).toBe(11.83);
    expect(r.setsCapped).toBe(11.83);
    expect(r.pairBonus).toBe(5);
    expect(r.warn).toEqual([]);
    expect(score3(doc, r.itemPoints)).toBe(294);
    expect(rowOf(r.main, 1927)).toMatchObject({ cfg: 0, slot: 'ta', points: 101.17, why: 'r9r2 60 · +12 25 · кам 1.2 · ka 15' });
    expect(rowOf(r.main, 1816)).toMatchObject({ cfg: 2, slot: 'ta', points: 21, why: 'свап: ПЗ 21' });
    expect(rowOf(r.main, 83)).toMatchObject({ points: 34, why: 'ШГ 15 · +11 11 · кам 8' });
    expect(rowOf(r.main, 40)).toMatchObject({ points: 29, why: 'Вознєс 10 · +11 11 · кам 8' });
    for (const id of [373, 340, 304, 293]) expect(rowOf(r.main, id)).toMatchObject({ points: 11.67, why: 'r8r 5.5 · +9 3.8 · кам 2.3' });
    expect(rowOf(r.main, 180)?.points).toBe(6);
    expect(rowOf(r.main, 184)?.points).toBe(9);
    expect(rowOf(r.main, 56)).toMatchObject({ points: 5, why: 't6 5' });
    expect(r.sets.map((s) => [s.name, s.total])).toEqual([['Спів', 11.83], ['ПЗ', 0]]);
    expect(rowOf(r.sets[0].rows, 54)).toMatchObject({ cfg: 1, points: 3.83, why: '+9 3.8' });
    expect(rowOf(r.sets[0].rows, 92)).toMatchObject({ points: 8, why: 't7 8' });
    // речі сету, добрані з Головного, не рахуються вдруге: у «ПЗ» власний лише лук, і той у mainPoints
    expect(r.sets[1].rows).toEqual([]);
    for (const row of [...r.main, ...r.sets.flatMap((s) => s.rows)]) expect(row.why.length).toBeLessThanOrEqual(WHY_MAX);
  });

  it('зброя: найдорожча — головна, де б не лежала; R9R2 у сеті й R8R у Головному дають те саме', () => {
    const base = tay();
    const swapped: CharacterDoc = { ...base, main: { ...base.main, ta: 'n' }, sets: base.sets.map((s) => (s.name === 'ПЗ' ? { ...s, slots: { ...s.slots, ta: '8' } } : { ...s, slots: { ...s.slots, ta: 'n' } })) };
    const a = scoreItems(base, rules, lookup);
    const b = scoreItems(swapped, rules, lookup);
    expect(b.itemPoints).toBe(a.itemPoints);
    expect(b.mainTotal).toBe(a.mainTotal);
    expect(rowOf(b.main, 1927)).toMatchObject({ cfg: 2, points: 101.17 });
    expect(rowOf(b.main, 1816)).toMatchObject({ cfg: 0, points: 21 });
    expect(b.warn).toContain('у сеті зброя дорожча, ніж у Головному');
    expect(a.warn).not.toContain('у сеті зброя дорожча, ніж у Головному');
  });

  it('дубль ШГ у сеті (копія від правки з вкладки сету) не подвоює: один раз, найбільша точка', () => {
    const base = tay();
    const a = scoreItems(base, rules, lookup);
    // Правка ШГ (+11 → +12) з вкладки «Спів»: річ надіта й у Головному, тож ops робить копію в сеті.
    const { doc: dup, iid } = updateInstance(base, 's0000i', '1', { r: 12 });
    expect(iid).not.toBe('1');
    const b = scoreItems(dup, rules, lookup);
    expect(b.itemPoints).toBe(a.itemPoints + 1); // лише +1 за рівень точки, а не другий ШГ (+35)
    const shg = b.main.filter((r) => r.catId === 83);
    expect(shg.map((r) => [r.cfg, r.points, r.why])).toEqual([[0, 0, 'ШГ уже зараховано'], [1, 35, 'ШГ 15 · +12 12 · кам 8']]);
    expect(b.pairBonus).toBe(5);
    expect(b.warn).toContain('«Шолом героя» у 2 екземплярах');
    // Незмінена копія в сеті — та сама річ: без змін і без примітки.
    const { doc: d2, iid: copy } = duplicateInstance(base, '1');
    const same = scoreItems(equip(d2, 's0000i', 'ft', copy!), rules, lookup);
    expect(same.itemPoints).toBe(a.itemPoints);
    expect(same.warn).toEqual([]);
  });

  it('кільця: лише два найкращі з усіх надітих; решта — 0', () => {
    const base = tay();
    const a = scoreItems(base, rules, lookup);
    // у сеті «Спів» два інші кільця: R9R1 +5 (12 + 5) і R9R1 +0 (12)
    const items = [...base.items, inst('q1', 'oq', 185, { r: 5 }), inst('q2', 'oq', 186)];
    const sets = base.sets.map((s) => (s.name === 'Спів' ? { ...s, slots: { ...s.slots, cr: 'q1', cd: 'q2' } } : s));
    const b = scoreItems({ ...base, items, sets }, rules, lookup);
    expect(b.itemPoints).toBe(a.itemPoints - 15 + 17 + 12);
    const rings = b.main.filter((r) => r.slot === 'cr' || r.slot === 'cd');
    expect(rings.filter((r) => r.points > 0).map((r) => [r.catId, r.points])).toEqual([[185, 17], [186, 12]]);
    expect(rings.filter((r) => r.points === 0).map((r) => [r.catId, r.why])).toEqual([[180, 'третє кільце: 0'], [184, 'третє кільце: 0']]);
    expect(b.warn).toEqual([]); // два кільця однієї речі каталогу — не «екземпляри»
    // два однакові кільця в Головному (той самий slotKey) — дві речі: дедуп за slotKey лише між конфігураціями
    const pair = scoreItems({ ...base, sets: [], items: [...base.items, inst('r1', 'oq', 180, { r: 9, e: [{ t: 'bu', v: 2 }] })], main: { ...base.main, cd: 'r1' } }, rules, lookup);
    expect(pair.main.filter((r) => r.catId === 180).map((r) => [r.iid, r.points])).toEqual([['6', 6], ['r1', 6]]);
    // …а та сама пара, продубльована в сеті, — усе ще дві речі, а не чотири
    const dupSet = scoreItems({ ...base, sets: [mkSet('rings00001', { cr: '6', cd: 'r1' })], items: [...base.items, inst('r1', 'oq', 180, { r: 9, e: [{ t: 'bu', v: 2 }] })], main: { ...base.main, cd: 'r1' } }, rules, lookup);
    expect(dupSet.main.filter((r) => r.catId === 180).length).toBe(2);
    expect(dupSet.itemPoints).toBe(pair.itemPoints);
  });

  it('свап-зброя рангу 17+ (не з сервера) — 0 із приміткою; ПЗ свап-зброй разом — до стелі', () => {
    const base = tay();
    // «Сукня з бантом»: ранг 17, у каталозі ПЗ 80 — а балів 0
    const dress = scoreItems({ ...base, items: [...base.items, inst('sw', 'ta', 2655)], sets: base.sets.map((s) => (s.name === 'Спів' ? { ...s, slots: { ...s.slots, ta: 'sw' } } : s)) }, rules, lookup);
    expect(rowOf(dress.main, 2655)).toMatchObject({ cfg: 1, points: 0, why: 'ранг 17: не з сервера — 0' });
    expect(dress.warn).toContain('зброя «Сукня з бантом» рангу 17 — не з сервера, 0 балів');
    expect(dress.itemPoints).toBe(scoreItems(base, rules, lookup).itemPoints);
    // другий свап-лук з ПЗ +15 у сеті «Спів» (він у документі перший): 21 + 15 = 36 → стеля 25;
    // стеля вичерпується від найбільшого ПЗ — лук на 21 повний, лук на 15 обрізано до 4
    const two = scoreItems({ ...base, items: [...base.items, inst('sw', 'ta', 1816, { x: [{ t: 'sx', v: 15 }] })], sets: base.sets.map((s) => (s.name === 'Спів' ? { ...s, slots: { ...s.slots, ta: 'sw' } } : s)) }, rules, lookup);
    expect(rowOf(two.main, 1816, 2)).toMatchObject({ points: 21, why: 'свап: ПЗ 21' });
    expect(rowOf(two.main, 1816, 1)).toMatchObject({ points: 4, why: 'свап: ПЗ 15 · стеля 25' });
    expect(two.itemPoints).toBe(scoreItems(base, rules, lookup).itemPoints + 4);
    expect(two.warn).toContain('«Вітер мисливця-тіні» у 2 екземплярах');
    // ПЗ-камінь у свап-зброї теж ПЗ: Лагеря в гнізді свап-лука → +2
    const gem = scoreItems({ ...base, items: base.items.map((it) => (it.i === 'n' ? { ...it, g: [57] } : it)) }, rules, lookup);
    expect(rowOf(gem.main, 1816)).toMatchObject({ points: 23, why: 'свап: ПЗ 23' });
  });

  it('registrationScore: рядок з itemPoints — клас + itemPoints + рівень + джин; без них — таблиця; без анкети — null', () => {
    const doc = tay();
    const gear: PlayerGear = {
      charClass: 'archer', charLevel: 'l104', build: 'dd', weaponGrade: 'r9r2', weaponRefine: 'w12', weaponPz: true,
      armorSet: 'r8r', armorRefine: 'a9', gems: 'xuan_pa', specialSets: [], specialSetGems: {}, tract: 't6', genie: 'g100',
      shg: true, shgRefine: 11, voznes: true, voznesRefine: 11, ring1: 'silver', ring1Refine: null, ring2: 'r9', ring2Refine: null,
    };
    const v2 = scoreItems(doc, rules, lookup).itemPoints;
    expect(registrationScore({ gear, itemPoints: v2 }, rules, 3)).toBe(294);
    expect(registrationScore({ gear, itemPoints: v2 }, rules, 3)).toBe(score3(doc, v2));
    expect(registrationScore({ gear, itemPoints: null }, rules, 3)).toBe(computeGearScoreWith(gear, rules, 3));
    expect(registrationScore({ gear, itemPoints: null }, rules, 3)).toBe(262); // таблиця з анкети заявки 25.09 (трактат t6)
    expect(registrationScore({ gear: null, itemPoints: v2 }, rules, 3)).toBeNull();
    // клас — за розміром команди, як у таблиці; рівень без анкети — як 90–100
    const six = normalizeRules({ classPointsBySize: { ...rules.classPointsBySize, '6': { ...rules.classPointsBySize['6'], archer: 2 } } });
    expect(registrationScore({ gear, itemPoints: v2 }, six, 6)).toBe(294 - 6);
    expect(registrationScore({ gear: { ...gear, charLevel: null }, itemPoints: v2 }, rules, 3)).toBe(294 - 7);
  });
});

describe('скор v2: типові фікстури й сети', () => {
  // typical-js (лучник 105, v1.0): «Небесний лук» R9 +10 з Ракшаса (ПА 3) і Світлого духа (ПА 2), ka —
  // 36 + 12 + 5 + 15 = 68; ШГ +8 з 4 Безбрежності (11 рів.) — 15 + 8 + 4 × 8/24 = 24.33; Вознєс — 10 + 8 + 1.33 = 19.33;
  // 4 × R9 +8 з Безбрежності — 35/4 + 17/6 + 1.33 = 12.92; «Император» 20; збірник із 2 Безбрежності 0.67;
  // кільця 17-го рангу — Луна 0 з приміткою; бонус 5. Разом 189.01; скор = 8 + 10 (105) + 0 (джина немає) + 189.01 → 207.
  // typical-by (воїн): «Важка сокира Ареса» R9 36 + 12 + 5 + zl 8 = 61 (−7), клас 5 (−3) → 182.01, скор 197.
  // Критики мали 209.67 / 199.67: у них ШГ/Вознєс ще з armorRefine/6 (+5.67) і ПА-камені в зброї плоско по 1 (−3).
  it('typical-js 207, typical-by 197 (3×3); кільця поза шкалою — примітка', () => {
    const js = docFrom('typical-js');
    const a = scoreItems(js, rules, lookup);
    expect(a.itemPoints).toBe(189.01);
    expect(score3(js, a.itemPoints)).toBe(207);
    expect(rowOf(a.main, 1902)).toMatchObject({ points: 68, why: 'r9 36 · +10 12 · кам 5 · ka 15' });
    expect(rowOf(a.main, 83)?.points).toBe(24.33);
    expect(rowOf(a.main, 109)?.points).toBe(20);
    expect(rowOf(a.main, 146)).toMatchObject({ slot: 'pp', points: 0.67, why: 'кам 0.7' });
    expect(a.sets).toEqual([]);
    expect(a.warn).toEqual([
      'кільце: лялька не розпізнала «Блукання в забутті (ж )» — зараховано як «Луна і нижче»',
      "кільце: лялька не розпізнала «Неприв'язана човен (ж )» — зараховано як «Луна і нижче»",
    ]);
    const by = docFrom('typical-by');
    const b = scoreItems(by, rules, lookup);
    expect(b.itemPoints).toBe(182.01);
    expect(score3(by, b.itemPoints)).toBe(197);
    expect(rowOf(b.main, 1900)).toMatchObject({ points: 61, why: 'r9 36 · +10 12 · кам 5 · zl 8' });
  });

  it('повний ПЗ-сет ТТ99 +5 з 24 Лагерями: 48 за камені + 3 за точку, під стелею swapTotalCap', () => {
    const base = docFrom('typical-by');
    const camp = { g: CAMP, r: 5 };
    const items = [inst('p1', 'rv', 312, camp), inst('p2', 'tg', 305, camp), inst('p3', 'rx', 276, camp), inst('p4', 'mj', 259, camp), inst('p5', 'ft', 179, camp), inst('p6', 'wy', 54, camp)];
    const doc: CharacterDoc = { ...base, items: [...base.items, ...items], sets: [mkSet('pzset0001', { rv: 'p1', tg: 'p2', rx: 'p3', mj: 'p4', ft: 'p5', wy: 'p6' })] };
    const noCap = scoreItems(doc, rules, lookup);
    expect(noCap.sets[0].rows.map((r) => [r.slot, r.points, r.why])).toEqual([
      ['ft', 8.5, '+5 0.5 · кам 8'], ['rv', 8.5, 'other 0 · +5 0.5 · кам 8'], ['tg', 8.5, 'other 0 · +5 0.5 · кам 8'],
      ['rx', 8.5, 'other 0 · +5 0.5 · кам 8'], ['wy', 8.5, '+5 0.5 · кам 8'], ['mj', 8.5, 'other 0 · +5 0.5 · кам 8'],
    ]);
    expect(noCap.setsRaw).toBe(51);
    expect(noCap.setsCapped).toBe(51); // у вбудованій стелі немає
    expect(noCap.itemPoints).toBe(182.01 + 51);
    const capped = scoreItems(doc, normalizeRules({ swapTotalCap: 25 }), lookup);
    expect(capped.setsRaw).toBe(51);
    expect(capped.setsCapped).toBe(25);
    expect(capped.itemPoints).toBe(182.01 + 25);
    expect(capped.mainTotal).toBe(noCap.mainTotal);
  });

  it('камені: ПЗ/ПА — одиниця × доп (у зброї — за стороною зброї), решта — за рівнем', () => {
    const base = docFrom('typical-by');
    const withGems = (g: number[], slot: 'rv' | 'ta' = 'rv'): number => {
      const iid = base.main[slot]!;
      const items = base.items.map((it) => (it.i === iid ? { ...it, g } : it));
      return scoreItems({ ...base, items }, rules, lookup).main.find((r) => r.slot === slot)!.points;
    };
    // рядки округлено до 2 знаків, тож дроби звіряємо з точністю 0,05
    const bare = withGems([]);
    expect(withGems([57]) - bare).toBeCloseTo(2, 1); // Лагеря +2 ПЗ
    expect(withGems([43]) - bare).toBeCloseTo(3, 1); // Цзин Юэ +3 ПЗ
    expect(withGems([54]) - bare).toBeCloseTo(3, 1); // Ракшаса +3 ПА
    expect(withGems([58, 59]) - bare).toBeCloseTo(2, 1); // Каменная + Алмазная броня по 1
    expect(withGems([52]) - bare).toBeCloseTo(14 / 24, 1); // Сюань Юань — 12 рів. за таблицею
    expect(withGems([198]) - bare).toBeCloseTo(8 / 24, 1); // Безбрежності — 11 рів.
    // у зброї «Прическа майнкрафта» дає фіз. атаку — це 12 рів., а не ПЗ; Ракшаса — ПА 3
    const bareTa = withGems([], 'ta');
    expect(withGems([112], 'ta') - bareTa).toBeCloseTo(14 / 24, 1);
    expect(withGems([54, 54], 'ta') - bareTa).toBeCloseTo(6, 1);
    // одиниця — бали за камінь на +1 ПЗ (doll.gemPoints.pz1): подвоїли — Лагеря 4
    const u2 = normalizeRules({ doll: { gemPoints: { pz1: 2 } } });
    const iid = base.main.rv!;
    const items = base.items.map((it) => (it.i === iid ? { ...it, g: [57] } : it));
    const rv = (r: typeof rules) => scoreItems({ ...base, items }, r, lookup).main.find((x) => x.slot === 'rv')!.points;
    expect(rv(u2) - rv(rules)).toBeCloseTo(2, 1);
  });

  /** typical-by + n сетів по 13 власних речей (копії речей Головного з гравіюванням — інший slotKey, інакше злились би з Головним). */
  const withSets = (n: number): CharacterDoc => {
    const base = docFrom('typical-by');
    const slots: SlotKey[] = ['ft', 'vx', 'rv', 'st', 'tg', 'rx', 'wy', 'mj', 'cr', 'cd', 'ta', 'it', 'qn'];
    const socket = new Set<SlotKey>(['ft', 'rv', 'tg', 'rx', 'wy', 'mj']);
    const items = [...base.items];
    const sets = Array.from({ length: n }, (_, j) => j + 1).map((k) => {
      const own: Partial<Record<SlotKey, string>> = {};
      for (const s of slots) {
        const iid = `s${k}${s}`;
        items.push(inst(iid, BY[s].cat, BY[s].id, { r: k, e: [{ t: 'hp', v: k }], ...(socket.has(s) ? { g: CAMP } : {}), ...(s === 'ta' ? { x: [{ t: 'sx', v: 10 }] } : {}) }));
        own[s] = iid;
      }
      return mkSet(`set00000${k}`, own, 'pz', `Сет ${k}`);
    });
    return { ...base, items, sets };
  };

  it('item_breakdown: 3 сети по 13 речей — 27 рядків із «чому» в 2000 Б; 5 сетів — без «чому»; малий розклад цілий', () => {
    const mainRows = scoreItems(docFrom('typical-by'), rules, lookup).main.length;
    const r = scoreItems(withSets(3), rules, lookup);
    // у сеті лишаються 8 власних рядків: зброя, ШГ, Вознєс і два кільця з кожного сету йдуть у mainPoints
    expect(r.sets.map((s) => s.rows.length)).toEqual([8, 8, 8]);
    expect(r.main.length).toBe(mainRows + 3 * 5);
    const b = itemBreakdown(r, 'balance-v1.0', { cls: 5, lvl: 10, genie: 0 });
    expect(breakdownBytes(b)).toBeLessThanOrEqual(ITEM_BREAKDOWN_MAX_BYTES);
    expect(b.v).toBe(1);
    expect(b.ver).toBe('balance-v1.0');
    expect(b.sum).toEqual({ cls: 5, lvl: 10, genie: 0, main: r.mainTotal, sets: r.setsCapped, setsRaw: r.setsRaw, pair: r.pairBonus });
    expect(b.rows.length).toBe(27);
    expect(b.rows.every((row) => row.length === 5)).toBe(true); // вмістилось разом із «чому»
    expect(b.rows.every((row) => row[3] > 0)).toBe(true);
    // Нерозпізнані кільця важливіші за дублі екземплярів — саме вони потрапляють у дві примітки.
    expect(b.warn).toHaveLength(2);
    for (const w of b.warn) expect(w).toMatch(/^кільце: лялька не розпізнала/);
    for (const w of b.warn) expect(w.length).toBeLessThanOrEqual(80);
    // 5 сетів (ліміт документа): з «чому» понад 2000 Б → «чому» прибрано, усі 37 рядків лишились
    const r5 = scoreItems(withSets(5), rules, lookup);
    const b5 = itemBreakdown(r5, 'balance-v1.0', { cls: 5, lvl: 10, genie: 0 });
    expect(breakdownBytes(b5)).toBeLessThanOrEqual(ITEM_BREAKDOWN_MAX_BYTES);
    expect(b5.rows.length).toBe(37);
    expect(b5.rows.every((row) => row.length === 4)).toBe(true);
    expect(b5.rows.every((row) => row[3] > 0)).toBe(true);
    // малий розклад — з «чому» і лише зараховані рядки
    const small = itemBreakdown(scoreItems(tay(), rules, lookup), 'balance-v1.0');
    expect(breakdownBytes(small)).toBeLessThanOrEqual(ITEM_BREAKDOWN_MAX_BYTES);
    expect(small.sum).toEqual({ main: 251.85, sets: 11.83, setsRaw: 11.83, pair: 5 });
    expect(small.rows).toContainEqual([0, 'ta', 1927, 101.17, 'r9r2 60 · +12 25 · кам 1.2 · ka 15']);
    expect(small.rows).toContainEqual([2, 'ta', 1816, 21, 'свап: ПЗ 21']);
    expect(small.rows).toContainEqual([1, 'qn', 92, 8, 't7 8']);
    expect(small.rows.some((row) => row[3] === 0)).toBe(false);
    expect(small.rows.length).toBe(13);
    expect(JSON.stringify(small)).not.toMatch(/NaN|Infinity|undefined/);
  });
});
