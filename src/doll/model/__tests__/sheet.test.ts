import { beforeAll, describe, expect, it } from 'vitest';
import { gemMixLabel, normalizeGemCounts, normalizeRules } from '../../../data/gearRules';
import type { Item } from '../../core/types';
import { validateDoc } from '../doc';
import { createSet, equip, updateInstance } from '../ops';
import {
  armorRefineBucket, buildOf, charLevelOf, dollFacts, dollMissing, gearFromCharacter, gemClass, gemsBucket, genieOf, sheetErrors, weaponRefineBucket,
  SHG_ITEM, VOZNES_ITEM, type DollFacts, type Sheet,
} from '../sheet';
import { hydrate } from '../hydrate';
import { docFrom, inst, loadRef, lookup, mkDoc, mkSet } from './testDoc';

beforeAll(() => loadRef());

const rules = normalizeRules({});
/** Стара «Анкета для турнірів» у збереженому персонажі — у бали не йде (крім genie як запасного шляху). */
const SHEET: Sheet = { weaponGrade: 'r8r', armorSet: 'r8r', tract: 't7', genie: 'g100', shg: false, voznes: false, ring1: 'r9', ring2: 'r9r1' };
const FACTS: DollFacts = {
  build: 'dd', weaponPz: false, weaponPzGain: 0, specialSets: [], specialSetGems: {}, weaponRefine: 'w10', armorRefine: 'a8', armorRefineAvg: 7.4,
  gems: 'pa', gemPoints: 26, gemCounts: { topPa: 24 }, ring1Refine: 0, ring2Refine: 3, shgRefine: null, voznesRefine: null,
  weaponGrade: 'r9', armorSet: 'r9', tract: 'emperor', ring1: 'moon', ring2: 'moon', gradeNotes: [], pa: 12.4, pz: 7.6,
};
const gem = (hf: number, dop: [string, number]): Item => ({ id: 1, hf, obDops: [dop, dop], name: 'g' } as unknown as Item);

describe('анкета персонажа', () => {
  it('рівень ляльки → рівень анкети', () => {
    expect(charLevelOf(90)).toBe('l90_100');
    expect(charLevelOf(103)).toBe('l103');
    expect(charLevelOf(105)).toBe('l105');
  });

  it('точка: броня — середня з округленням угору; зброя — за таблицею', () => {
    expect(armorRefineBucket(7.1)).toBe('a8');
    expect(armorRefineBucket(8)).toBe('a8');
    expect(armorRefineBucket(3.9)).toBe('a0_4');
    expect(armorRefineBucket(12)).toBe('a12');
    expect(weaponRefineBucket(5)).toBe('w0_5');
    expect(weaponRefineBucket(7)).toBe('w6_7');
    expect(weaponRefineBucket(10)).toBe('w10');
    expect(weaponRefineBucket(12)).toBe('w12');
  });

  it('клас каменя з каталогу і сума → рядок таблиці «Камні»', () => {
    expect(gemClass(gem(13, ['sx', 2]))).toBe('campPz'); // Лагеря
    expect(gemClass(gem(12, ['sx', 1]))).toBe('pz1'); // Каменная броня
    expect(gemClass(gem(12, ['ad', 1]))).toBe('topPa'); // Алмазная броня
    expect(gemClass(gem(14, ['ad', 3]))).toBe('topPa');
    expect(gemClass(gem(13, ['hp', 200]))).toBe('topOther');
    expect(gemClass(gem(12, ['ed', 1]))).toBe('g12');
    expect(gemClass(gem(9, ['hp', 65]))).toBe('low');
    // Механіка зіставлення — на старих балах за камінь (Лагеря 40/24, ПА 26/24).
    const old = normalizeRules({ doll: { gemPoints: { campPz: 40 / 24, topPa: 26 / 24, topOther: 14 / 24, g12: 14 / 24, g11: 8 / 24, g10: 4 / 24, low: 0 } } });
    expect(gemsBucket(24 * old.doll.gemPoints.campPz, old)).toBe('camp');
    expect(gemsBucket(24 * old.doll.gemPoints.topPa, old)).toBe('pa');
    // половина Лагерів + половина ПА = 33 → «Сюаньки / Лагеря» за балами
    expect(gemsBucket(12 * old.doll.gemPoints.campPz + 12 * old.doll.gemPoints.topPa, old)).toBe('xuan_camp');
    expect(gemsBucket(0, old)).toBe('g0_9');
    // Зараз: 1 ПА = 1 ПЗ = 1 бал — Лагеря ×24 = 48, Каменная й Алмазная броня ×24 = 24.
    expect(24 * rules.doll.gemPoints.campPz).toBe(48);
    expect(24 * rules.doll.gemPoints.pz1).toBe(24);
    expect(24 * rules.doll.gemPoints.topPa).toBe(24);
    expect(gemsBucket(24 * rules.doll.gemPoints.campPz, rules)).toBe('camp');
  });

  it('збірка з атрибутів: частка очок у Тілобудові', () => {
    const doc = docFrom('typical-js');
    expect(buildOf({ ...doc, attrs: { str: 5, dex: 400, vit: 30, mag: 5 } }, rules)).toBe('dd');
    expect(buildOf({ ...doc, attrs: { str: 5, dex: 300, vit: 150, mag: 5 } }, rules)).toBe('hybrid');
    expect(buildOf({ ...doc, attrs: { str: 5, dex: 200, vit: 300, mag: 5 } }, rules)).toBe('con');
  });

  it('перевірка анкети в документі: відомі поля й значення', () => {
    expect(sheetErrors(SHEET)).toEqual([]);
    expect(sheetErrors({ weaponGrade: 'r99' })).not.toEqual([]);
    expect(sheetErrors({ foo: 1 })).not.toEqual([]);
    expect(sheetErrors({ gems: 'pa', build: 'dd' })).toEqual([]); // старі чернетки з полями, які тепер рахує лялька
    const doc = { ...docFrom('typical-js'), sheet: SHEET };
    expect(validateDoc(doc).ok).toBe(true);
    // старі галочки ШГ/Вознєс у збережених персонажах і далі проходять перевірку
    const legacy: Sheet = { ...SHEET, shg: true, shgRefine: 11, voznes: true, voznesRefine: null };
    expect(sheetErrors(legacy)).toEqual([]);
    expect(validateDoc({ ...doc, sheet: legacy }).ok).toBe(true);
    expect(validateDoc({ ...doc, sheet: { weaponGrade: 'r99' } }).ok).toBe(false);
  });

  it('бракує речей: без зброї (ніде) чи з порожнім слотом броні Головного gear = null; рядки — як у плашці стану', () => {
    const base = docFrom('typical-js');
    expect(dollMissing(base, hydrate(base, lookup))).toEqual([]);
    const main = { ...base.main };
    delete main.ta;
    const noWeapon = gearFromCharacter({ ...base, main }, FACTS, { setsFromDoll: true }, lookup);
    expect(noWeapon.gear).toBeNull();
    expect(noWeapon.missing).toEqual(['зброя']);
    // зброя лише в сеті — цього досить (скор v2 рахує найдорожчу, де б вона не лежала)
    const inSet = { ...base, main, sets: [mkSet('s1', { ta: base.main.ta })] };
    expect(gearFromCharacter(inSet, FACTS, { setsFromDoll: true }, lookup).missing).toEqual([]);
    delete main.rv;
    delete main.mj;
    const noArmor = gearFromCharacter({ ...base, main }, FACTS, { setsFromDoll: true }, lookup);
    expect(noArmor.gear).toBeNull();
    expect(noArmor.missing).toEqual(['зброя', 'порожні слоти броні: нагрудник, браслети']);
    const oneSlot = { ...base.main };
    delete oneSlot.tg;
    expect(gearFromCharacter({ ...base, main: oneSlot }, FACTS, { setsFromDoll: true }, lookup).missing).toEqual(['порожній слот броні: поножі']);
    // стара анкета не потрібна і нічого не блокує
    expect(gearFromCharacter(base, FACTS, { setsFromDoll: true }, lookup).missing).toEqual([]);
    expect(gearFromCharacter({ ...base, sheet: { weaponGrade: 'r8r' } }, FACTS, { setsFromDoll: true }, lookup).missing).toEqual([]);
  });

  it('грейди — з ляльки (DollFacts), стара анкета в документі на них не впливає; джин — genieOf', () => {
    const doc = { ...docFrom('typical-js'), sheet: SHEET }; // в анкеті r8r / r8r / t7 / r9 / r9r1 — ігнорується
    const r = gearFromCharacter(doc, FACTS, { setsFromDoll: true }, lookup);
    expect(r.missing).toEqual([]);
    expect(r.gear).toMatchObject({
      charClass: 'archer', charLevel: 'l105', build: 'dd', weaponGrade: 'r9', weaponRefine: 'w10', armorSet: 'r9', armorRefine: 'a8', gems: 'pa',
      tract: 'emperor', ring1: 'moon', ring2: 'moon', ring1Refine: null, ring2Refine: null,
      genie: 'g100', // зі старої анкети — запасний шлях, поки блок джина не заповнено
    });
    expect(r.attackLevel).toBe(12);
    expect(r.defenseLevel).toBe(8);
    // точка кільця — лише для R9R1, з ляльки
    const r9r1 = gearFromCharacter(doc, { ...FACTS, ring2: 'r9r1' }, { setsFromDoll: true }, lookup).gear!;
    expect([r9r1.ring2, r9r1.ring2Refine]).toEqual(['r9r1', 3]);
    // без анкети й блоку джина — «до 60»; блок джина головніший за анкету
    expect(gearFromCharacter(docFrom('typical-js'), FACTS, { setsFromDoll: true }, lookup).gear?.genie).toBe('g60');
    expect(gearFromCharacter({ ...doc, genie: { level: 70, luck: 65, skills: [] } }, FACTS, { setsFromDoll: true }, lookup).gear?.genie).toBe('g61_70');
  });

  it('сети з ляльки: лише коли ввімкнено, камені сету — з ляльки', () => {
    const doc = docFrom('typical-js');
    const facts: DollFacts = { ...FACTS, specialSets: ['pz'], specialSetGems: { pz: 'camp' } };
    expect(gearFromCharacter(doc, facts, { setsFromDoll: false }, lookup).gear?.specialSets).toEqual([]);
    const on = gearFromCharacter(doc, facts, { setsFromDoll: true }, lookup).gear;
    expect(on?.specialSets).toEqual(['pz']);
    expect(on?.specialSetGems).toEqual({ pz: 'camp' });
  });

  it('лялька: точка й камені рахуються з речей; ПЗ-зброя — інша зброя в сеті', () => {
    let doc = docFrom('typical-by');
    const f0 = dollFacts(doc, rules, lookup);
    expect(f0.weaponRefine).not.toBeNull();
    expect(f0.armorRefine).not.toBeNull();
    expect(f0.weaponPz).toBe(false);
    const { doc: d1, setId } = createSet(doc, 'pz');
    doc = equip(d1, setId!, 'ta', d1.main.ta!);
    doc = updateInstance(doc, setId!, doc.main.ta!, { x: [{ t: 'sx', v: 20 }] }).doc;
    expect(dollFacts(doc, rules, lookup).weaponPz).toBe(true);
  });

  it('обсяг «усі сети» бере середнє по конфігураціях', () => {
    const doc = docFrom('typical-by');
    const { doc: d1 } = createSet(doc, 'pz'); // порожній сет = як Головний
    const main = dollFacts(d1, rules, lookup);
    const all = dollFacts(d1, normalizeRules({ doll: { scope: 'all' } }), lookup);
    expect(all.armorRefineAvg).toBeCloseTo(main.armorRefineAvg!, 6);
    expect(all.gemPoints).toBeCloseTo(main.gemPoints, 6);
  });

  it('склад каменів: рахується поштучно, у заявці — підпис замість рядка таблиці', () => {
    const f = dollFacts(docFrom('typical-by'), rules, lookup);
    const total = Object.values(f.gemCounts).reduce((a, b) => a + (b ?? 0), 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(24);
    // Сюань Юань ×16 + Лагеря ×8: 16 × 14/24 + 8 × 2 ≈ 25 б.
    expect(gemMixLabel({ g12: 16, campPz: 8 })).toBe('ПЗ+2 ×8 · 12 рів. ×16');
    expect(gemMixLabel({ g12: 16, campPz: 8 }, rules)).toBe('ПЗ+2 ×8 · 12 рів. ×16 = 25 б.');
    expect(gemMixLabel(null)).toBe('');
    expect(normalizeGemCounts({ g12: 16, campPz: 8.4, bogus: 3, low: 0 })).toEqual({ g12: 16, campPz: 8 });
    expect(normalizeGemCounts('x')).toBeNull();
  });

  it('ШГ і Вознєс — з ляльки: «Шлем героя» і «Плащ вознесения» в Головному чи в сеті, точка з речі', () => {
    const items = [inst('h', 'ft', SHG_ITEM.id, { r: 11 }), inst('c', 'wy', VOZNES_ITEM.id, { r: 7 }), inst('x', 'ft', 179)];
    const none = dollFacts(mkDoc({ items, main: { ft: 'x' } }), rules, lookup);
    expect([none.shgRefine, none.voznesRefine]).toEqual([null, null]); // «Шлем генерала» — не ШГ; плащ лише в інвентарі
    const main = dollFacts(mkDoc({ items, main: { ft: 'h', wy: 'c' } }), rules, lookup);
    expect([main.shgRefine, main.voznesRefine]).toEqual([11, 7]);
    const inSet = dollFacts(mkDoc({ items, main: { ft: 'x' }, sets: [mkSet('s1', { ft: 'h', wy: 'c' })] }), rules, lookup);
    expect([inSet.shgRefine, inSet.voznesRefine]).toEqual([11, 7]);
    // У заявці — з ляльки, а старі галочки в документі ігноруються
    const doc = { ...docFrom('typical-js'), sheet: { ...SHEET, shg: true, shgRefine: 12 } };
    const g = gearFromCharacter(doc, { ...FACTS, shgRefine: null, voznesRefine: 9 }, { setsFromDoll: false }, lookup).gear!;
    expect([g.shg, g.shgRefine, g.voznes, g.voznesRefine]).toEqual([false, null, true, 9]);
    // стара галочка без точки нічого не блокує
    const noRefine = gearFromCharacter({ ...doc, sheet: { ...SHEET, shg: true } }, FACTS, { setsFromDoll: false }, lookup);
    expect(noRefine.missing).toEqual([]);
    // два екземпляри: у Головному +5, у сеті +11 — береться більша точка
    const two = [inst('h5', 'ft', SHG_ITEM.id, { r: 5 }), inst('h11', 'ft', SHG_ITEM.id, { r: 11 })];
    expect(dollFacts(mkDoc({ items: two, main: { ft: 'h5' }, sets: [mkSet('s1', { ft: 'h11' })] }), rules, lookup).shgRefine).toBe(11);
  });

  it('джин: з блоку джина за удачею, інакше зі старої анкети, інакше null', () => {
    const base = mkDoc();
    expect(genieOf(base)).toBeNull();
    expect(genieOf({ ...base, sheet: { genie: 'g81_90' } })).toBe('g81_90');
    expect(genieOf({ ...base, genie: { level: 100, luck: 95, skills: [] } })).toBe('g91_99');
    expect(genieOf({ ...base, genie: { level: 105, luck: 100, skills: [] } })).toBe('g100');
    expect(genieOf({ ...base, genie: { level: 40, luck: 0, skills: [] } })).toBe('g60');
    // Блок джина має пріоритет над старою анкетою.
    expect(genieOf({ ...base, sheet: { genie: 'g100' }, genie: { level: 70, luck: 65, skills: [] } })).toBe('g61_70');
    // Занижена удача балів не знижує: 8 вмінь без удачі 91 не буває.
    const eight = [10001, 9681, 9751, 9791, 9941, 9601, 9581, 9741];
    expect(genieOf({ ...base, genie: { level: 100, luck: 0, skills: eight } })).toBe('g91_99');
    expect(genieOf({ ...base, genie: { level: 60, luck: 0, skills: eight.slice(0, 5) } })).toBe('g60');
    expect(genieOf({ ...base, genie: { level: 80, luck: 0, skills: eight.slice(0, 6) } })).toBe('g71_80');
  });

});
