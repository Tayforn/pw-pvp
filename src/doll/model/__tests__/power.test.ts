import { beforeAll, describe, expect, it } from 'vitest';
import { classPointsFor, dollGearScoreWith, normalizeRules, tableGearPartWith } from '../../../data/gearRules';
import type { PlayerGear } from '../../../data/types';
import { DOLL_ENGINE_VER } from '../../core/version';
import { powerOf } from '../power';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const OPP = { pa: 40, pz: 40 };
const gear: PlayerGear = {
  charClass: 'archer', charLevel: null, build: 'dd', weaponGrade: 'r8r', weaponRefine: 'w10', weaponPz: false,
  armorSet: 'r8r', armorRefine: 'a8', gems: 'pa', specialSets: [], specialSetGems: {}, tract: 't7', genie: 'g100',
  shg: false, shgRefine: null, voznes: false, voznesRefine: null,
  ring1: null, ring1Refine: null, ring2: null, ring2Refine: null,
};

describe('сила з ляльки', () => {
  it('атака й живучість — додатні, з версією формул', () => {
    for (const name of ['typical-js', 'typical-by']) {
      const p = powerOf(docFrom(name), OPP, lookup);
      expect(p.off).toBeGreaterThan(0);
      expect(p.def).toBeGreaterThan(0);
      expect(p.engine).toBe(DOLL_ENGINE_VER);
    }
  });

  it('сильніший суперник: ПЗ суперника ріже атаку, ПА — живучість', () => {
    const doc = docFrom('typical-js');
    const p0 = powerOf(doc, OPP, lookup);
    expect(powerOf(doc, { pa: 40, pz: 80 }, lookup).off).toBeLessThan(p0.off);
    expect(powerOf(doc, { pa: 80, pz: 40 }, lookup).def).toBeLessThan(p0.def);
  });

  it('більше Тілобудови — більше живучості', () => {
    const doc = docFrom('typical-js');
    const more = { ...doc, attrs: { ...doc.attrs, vit: doc.attrs.vit + 100 } };
    expect(powerOf(more, OPP, lookup).def).toBeGreaterThan(powerOf(doc, OPP, lookup).def);
  });
});

describe('скор з ляльки', () => {
  const ref = { off: 10000, def: 20000, base: 150, label: 'еталон' };
  const rules = normalizeRules({ dollScore: { mode: 'shadow', refs: { archer: ref } } });
  const power = (off: number, def: number) => ({ off, def, pa: 0, pz: 0, engine: DOLL_ENGINE_VER });
  const extras = classPointsFor(rules, 'archer', 3) + rules.genie.g100;

  it('як еталон — бали еталона + клас + джин', () => {
    expect(dollGearScoreWith(gear, power(10000, 20000), rules, 3)).toBe(Math.round(150 + extras));
  });

  it('подвоєння атаки ДД дає perDouble × частку атаки', () => {
    const s = dollGearScoreWith(gear, power(20000, 20000), rules, 3)!;
    expect(s - dollGearScoreWith(gear, power(10000, 20000), rules, 3)!).toBe(Math.round(50 * 0.7));
    const con = dollGearScoreWith({ ...gear, build: 'con' }, power(10000, 40000), rules, 3)!;
    expect(con - Math.round(150 + extras)).toBe(Math.round(50 * 0.7));
  });

  it('бали спорядження не від’ємні; без еталона — null', () => {
    expect(dollGearScoreWith(gear, power(1, 1), rules, 3)).toBe(Math.round(extras));
    expect(dollGearScoreWith({ ...gear, charClass: 'wizard' }, power(10000, 20000), rules, 3)).toBeNull();
  });

  it('нормалізація: кривий еталон відкидається, режим за замовчуванням — вимкнено', () => {
    const r = normalizeRules({ dollScore: { refs: { archer: { off: 0, def: 5 }, wizard: { off: 5, def: 5, base: 10 }, nope: { off: 1, def: 1 } } } });
    expect(r.dollScore.mode).toBe('off');
    expect(Object.keys(r.dollScore.refs)).toEqual(['wizard']);
  });

  it('бали еталона за таблицею — скор без класу, джина й запасного', () => {
    expect(tableGearPartWith(gear, rules, 3)).toBeGreaterThan(0);
  });
});
