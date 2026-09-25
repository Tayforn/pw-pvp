import { beforeAll, describe, expect, it } from 'vitest';
import { validateDoc } from '../doc';
import { createSet, equip, updateInstance } from '../ops';
import { charLevelOf, dollFacts, gearFromCharacter, sheetErrors, sheetFromGear, type DollFacts, type Sheet } from '../sheet';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const FULL: Sheet = {
  build: 'dd', weaponGrade: 'r8r', weaponRefine: 'w10', armorSet: 'r8r', armorRefine: 'a10', gems: 'pa',
  tract: 't7', genie: 'g100', shg: false, voznes: false, ring1: 'r9', ring2: 'r9r1', ring2Refine: 3,
};
const NO_FACTS: DollFacts = { weaponPz: false, specialSets: [], pa: 12.4, pz: 7.6 };

describe('анкета персонажа', () => {
  it('рівень ляльки → рівень анкети', () => {
    expect(charLevelOf(90)).toBe('l90_100');
    expect(charLevelOf(100)).toBe('l90_100');
    expect(charLevelOf(103)).toBe('l103');
    expect(charLevelOf(105)).toBe('l105');
  });

  it('перевірка анкети в документі: відомі поля й значення', () => {
    expect(sheetErrors(FULL)).toEqual([]);
    expect(sheetErrors({ weaponGrade: 'r99' })).not.toEqual([]);
    expect(sheetErrors({ foo: 1 })).not.toEqual([]);
    expect(sheetErrors({ ring1Refine: 13 })).not.toEqual([]);
    expect(sheetErrors({ specialSetGems: { pz: 'camp' } })).toEqual([]);
    expect(sheetErrors({ specialSetGems: { zz: 'camp' } })).not.toEqual([]);
    const doc = { ...docFrom('typical-js'), sheet: FULL };
    expect(validateDoc(doc).ok).toBe(true);
    expect(validateDoc({ ...doc, sheet: { weaponGrade: 'r99' } }).ok).toBe(false);
  });

  it('неповна анкета — перелік того, чого бракує', () => {
    const doc = { ...docFrom('typical-js'), sheet: { build: 'dd' } as Sheet };
    const r = gearFromCharacter(doc, NO_FACTS, { setsFromDoll: true });
    expect(r.gear).toBeNull();
    expect(r.missing).toContain('зброя');
    expect(r.missing).toContain('кільце 2');
  });

  it('повна анкета: клас і рівень — з ляльки, показники — з Головного', () => {
    const doc = { ...docFrom('typical-js'), sheet: FULL };
    const r = gearFromCharacter(doc, NO_FACTS, { setsFromDoll: true });
    expect(r.missing).toEqual([]);
    expect(r.gear).toMatchObject({ charClass: 'archer', weaponGrade: 'r8r', ring2: 'r9r1', ring2Refine: 3, ring1Refine: null, weaponPz: false, specialSets: [] });
    expect(r.attackLevel).toBe(12);
    expect(r.defenseLevel).toBe(8);
  });

  it('сети з ляльки: лише коли ввімкнено, і з каменями з анкети', () => {
    const doc = { ...docFrom('typical-js'), sheet: FULL };
    const facts: DollFacts = { ...NO_FACTS, specialSets: ['pz'] };
    expect(gearFromCharacter(doc, facts, { setsFromDoll: false }).gear?.specialSets).toEqual([]);
    const need = gearFromCharacter(doc, facts, { setsFromDoll: true });
    expect(need.gear).toBeNull();
    expect(need.missing.join()).toContain('ПЗ');
    const ok = gearFromCharacter({ ...doc, sheet: { ...FULL, specialSetGems: { pz: 'camp' } } }, facts, { setsFromDoll: true });
    expect(ok.gear?.specialSets).toEqual(['pz']);
    expect(ok.gear?.specialSetGems).toEqual({ pz: 'camp' });
  });

  it('ПЗ-зброя з ляльки: інша зброя в сеті, що піднімає ПЗ', () => {
    let doc = docFrom('typical-by');
    expect(dollFacts(doc, lookup).weaponPz).toBe(false);
    const { doc: d1, setId } = createSet(doc, 'pz');
    doc = equip(d1, setId!, 'ta', d1.main.ta!);
    doc = updateInstance(doc, setId!, doc.main.ta!, { x: [{ t: 'sx', v: 20 }] }).doc;
    const f = dollFacts(doc, lookup);
    expect(f.weaponPz).toBe(true);
    // +20 ПЗ від зброї: поріг ПЗ-сету (≥ 30) досягнуто лише якщо Головний уже мав ≥ 10
    expect(f.specialSets.includes('pz')).toBe(f.pz + 20 >= 30);
  });

  it('зміна з анкети не зберігає клас, рівень, ПЗ-зброю й сети', () => {
    const out = sheetFromGear({ charClass: 'archer', charLevel: 'l105', weaponPz: true, specialSets: ['pz'], weaponGrade: 'r9', specialSetGems: { pz: 'pa' } });
    expect(out).toEqual({ weaponGrade: 'r9', specialSetGems: { pz: 'pa' } });
  });
});
