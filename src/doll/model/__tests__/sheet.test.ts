import { beforeAll, describe, expect, it } from 'vitest';
import { gemMixLabel, normalizeGemCounts, normalizeRules } from '../../../data/gearRules';
import type { Item } from '../../core/types';
import { validateDoc } from '../doc';
import { createSet, equip, updateInstance } from '../ops';
import {
  armorRefineBucket, buildOf, charLevelOf, dollFacts, gearFromCharacter, gemClass, gemsBucket, sheetErrors, sheetFromGear, weaponRefineBucket,
  type DollFacts, type Sheet,
} from '../sheet';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const rules = normalizeRules({});
const SHEET: Sheet = { weaponGrade: 'r8r', armorSet: 'r8r', tract: 't7', genie: 'g100', shg: false, voznes: false, ring1: 'r9', ring2: 'r9r1' };
const FACTS: DollFacts = {
  build: 'dd', weaponPz: false, specialSets: [], specialSetGems: {}, weaponRefine: 'w10', armorRefine: 'a8', armorRefineAvg: 7.4,
  gems: 'pa', gemPoints: 26, gemCounts: { topPa: 24 }, ring1Refine: 0, ring2Refine: 3, pa: 12.4, pz: 7.6,
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
    expect(gemClass(gem(13, ['sx', 2]))).toBe('campPz');
    expect(gemClass(gem(14, ['ad', 3]))).toBe('topPa');
    expect(gemClass(gem(13, ['hp', 200]))).toBe('topOther');
    expect(gemClass(gem(12, ['ed', 1]))).toBe('g12');
    expect(gemClass(gem(9, ['hp', 65]))).toBe('low');
    expect(gemsBucket(24 * rules.doll.gemPoints.campPz, rules)).toBe('camp');
    expect(gemsBucket(24 * rules.doll.gemPoints.topPa, rules)).toBe('pa');
    // половина Лагерів + половина ПА = 33 → «Сюаньки / Лагеря» за балами
    expect(gemsBucket(12 * rules.doll.gemPoints.campPz + 12 * rules.doll.gemPoints.topPa, rules)).toBe('xuan_camp');
    expect(gemsBucket(0, rules)).toBe('g0_9');
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
    expect(validateDoc({ ...doc, sheet: { weaponGrade: 'r99' } }).ok).toBe(false);
  });

  it('неповна анкета — перелік того, чого бракує', () => {
    const doc = { ...docFrom('typical-js'), sheet: { weaponGrade: 'r8r' } as Sheet };
    const r = gearFromCharacter(doc, FACTS, { setsFromDoll: true });
    expect(r.gear).toBeNull();
    expect(r.missing).toContain('сет броні');
    expect(r.missing).toContain('кільце 2');
  });

  it('повна анкета: грейди з анкети, решта — з ляльки', () => {
    const doc = { ...docFrom('typical-js'), sheet: SHEET };
    const r = gearFromCharacter(doc, FACTS, { setsFromDoll: true });
    expect(r.missing).toEqual([]);
    expect(r.gear).toMatchObject({
      charClass: 'archer', build: 'dd', weaponGrade: 'r8r', weaponRefine: 'w10', armorRefine: 'a8', gems: 'pa',
      ring2: 'r9r1', ring2Refine: 3, ring1Refine: null,
    });
    expect(r.attackLevel).toBe(12);
    expect(r.defenseLevel).toBe(8);
  });

  it('сети з ляльки: лише коли ввімкнено, камені сету — з ляльки', () => {
    const doc = { ...docFrom('typical-js'), sheet: SHEET };
    const facts: DollFacts = { ...FACTS, specialSets: ['pz'], specialSetGems: { pz: 'camp' } };
    expect(gearFromCharacter(doc, facts, { setsFromDoll: false }).gear?.specialSets).toEqual([]);
    const on = gearFromCharacter(doc, facts, { setsFromDoll: true }).gear;
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
    // Сюаньки ×16 + Лагеря ×8 ≈ 23 б. → рядок «Сюаньки / ПА» (20), але підпис каже правду
    expect(gemMixLabel({ g12: 16, campPz: 8 })).toBe('ПЗ 13+ ×8 · 12 рів. ×16');
    expect(gemMixLabel(null)).toBe('');
    expect(normalizeGemCounts({ g12: 16, campPz: 8.4, bogus: 3, low: 0 })).toEqual({ g12: 16, campPz: 8 });
    expect(normalizeGemCounts('x')).toBeNull();
  });

  it('зміна з анкети зберігає лише грейди', () => {
    const out = sheetFromGear({ charClass: 'archer', weaponPz: true, specialSets: ['pz'], weaponGrade: 'r9', gems: 'camp', armorRefine: 'a10', ring1: 'moon' });
    expect(out).toEqual({ weaponGrade: 'r9', ring1: 'moon' });
  });
});
