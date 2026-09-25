// =========================================================
// Golden-тест ядра: ті самі білди, що прогнав НЕЗМІНЕНИЙ pw-calc (еталони з
// scripts/doll-golden.ts), мають дати ті самі числа в pvp-ядрі — точно, toEqual.
// Фікстури — посиланнями на речі, тож заодно перевіряються каталоги pvp.
// =========================================================

import { beforeAll, describe, expect, it } from 'vitest';
import { XZ } from '../constants';
import { deriveIb, shownBuffs, shownDebuffs } from '../buffs';
import { DEFAULT_OPP, computeSkillDamage } from '../damage';
import { derivedNumbers } from '../derived';
import { getSkills } from '../refdata';
import { computeActiveSlots, computeStats } from '../stats';
import { computeSummary } from '../summary';
import { hydrateFixture, type Fixture } from './hydrateFixture';
import { loadTestRefData, testCatalog } from './testData';

interface Golden {
  t: Record<string, number>;
  gearAttr: Record<string, number>;
  active: string[];
  ib: Record<string, number>;
  char: unknown;
  cells: Array<[string, string]>;
  attrPlus: Record<string, number>;
  shown: { buffs: number[]; debuffs: number[] };
  skills: Record<string, unknown>;
  derived: Record<string, number>;
}

// Через glob, а не import json: tsc не виводить тип із 700 КБ еталонів.
const FX = import.meta.glob('./fixtures/*.json', { import: 'default', eager: true }) as Record<string, Fixture[]>;
const GOLD = import.meta.glob('./golden/*.json', { import: 'default', eager: true }) as Record<string, Record<string, Golden>>;
const fixtures = (name: string): Fixture[] => FX['./fixtures/' + name + '.json'];
const goldens = (name: string): Record<string, Golden> => GOLD['./golden/' + name + '.json'];

const getItem = testCatalog();
beforeAll(() => loadTestRefData());

function check(fx: Fixture, g: Golden): void {
  const build = hydrateFixture(fx, getItem);
  const { t, gearAttr } = computeStats(build);
  expect(t).toEqual(g.t);
  expect(gearAttr).toEqual(g.gearAttr);
  expect([...computeActiveSlots(build)].sort()).toEqual(g.active);
  const ib = deriveIb(build);
  expect(ib).toEqual(g.ib);
  const sum = computeSummary(build, t, ib);
  expect(sum.char).toEqual(g.char);
  expect(sum.cells.map((c) => [c.label, c.val])).toEqual(g.cells);
  expect(sum.attrPlus).toEqual(g.attrPlus);
  expect(shownBuffs(build).map((b) => b.id)).toEqual(g.shown.buffs);
  expect(shownDebuffs(build).map((b) => b.id)).toEqual(g.shown.debuffs);
  const skills = getSkills()?.[String(XZ[fx.cls])] || [];
  expect(skills.length).toBeGreaterThan(0);
  const dmg = Object.fromEntries(skills.map((sk) => [String(sk.id), computeSkillDamage(sum.char, DEFAULT_OPP, sk, build.level, t, ib)]));
  expect(dmg).toEqual(g.skills);
  expect(derivedNumbers(build)).toEqual(g.derived);
  expect(derivedNumbers(build, {}, t)).toEqual(g.derived);
}

for (const group of ['manual', 'random']) {
  describe(`golden: ${group === 'manual' ? 'ручні фікстури' : 'випадкові білди'}`, () => {
    const list = fixtures(group);
    const gold = goldens(group);
    it('еталон є для кожної фікстури', () => {
      expect(list.length).toBeGreaterThan(0);
      expect(list.map((f) => f.name).sort()).toEqual(Object.keys(gold).sort());
    });
    for (const fx of list) it(fx.name, () => check(fx, gold[fx.name]));
  });
}
