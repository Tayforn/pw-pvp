import { beforeAll, describe, expect, it } from 'vitest';
import { deriveIb } from '../../core/buffs';
import { computeStats } from '../../core/stats';
import { computeSummary } from '../../core/summary';
import type { CharacterDoc } from '../doc';
import { CFG_MAIN, hydrate, toDollState } from '../hydrate';
import { setBuffLvl, setBuffSide, toggleBuff } from '../ops';
import { classPassives, passiveCfg } from '../passives';
import { powerOf } from '../power';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const MASTERY_BOW = 28; // «Мастерство стрельбы»
const atk = (doc: CharacterDoc) => {
  const st = toDollState(hydrate(doc, lookup), CFG_MAIN);
  return computeSummary(st, computeStats(st).t, deriveIb(st)).char.physAtk;
};

describe('пасивки класу', () => {
  it('лучник: майстерність лука — пасивка; активні бафи — ні', () => {
    const ids = classPassives('js').map((b) => b.id);
    expect(ids).toEqual([MASTERY_BOW]);
    expect(classPassives('by').map((b) => b.id).sort()).toEqual([17, 18, 19, 20]);
  });

  it('не налаштована: 11 рівень зі стороною шляху, без шляху — 10', () => {
    const doc = docFrom('typical-js');
    const b = classPassives('js')[0];
    expect(passiveCfg({ ...doc, level: 104, path: 'rs' }, b)).toEqual({ on: true, lvl: 11, side: 'rs' });
    expect(passiveCfg({ ...doc, level: 104, path: null }, b)).toEqual({ on: true, lvl: 10, side: '' });
    expect(passiveCfg({ ...doc, level: 80, path: 'je' }, b)).toEqual({ on: true, lvl: 10, side: '' });
  });

  it('діє без бафів: множник атаки луком +6 % за рівень, світла 11 — +90 %', () => {
    const base = { ...docFrom('typical-js'), path: null, buffs: undefined } as CharacterDoc;
    const off = toggleBuff(base, MASTERY_BOW); // вимкнути не налаштовану = вимкнути
    expect(off.buffs?.cfg[String(MASTERY_BOW)]?.on).toBe(false);
    const a0 = atk(off);
    const a10 = atk(base);
    const rs = atk(setBuffSide(base, MASTERY_BOW, 'rs'));
    expect(a10.max).toBeGreaterThan(a0.max);
    expect(rs.max).toBeGreaterThan(a10.max);
    // атака пропорційна множнику: (m + 0.9) / (m + 0.6) = rs / lvl10, m — множник без пасивки
    const m0 = a0.max, k = (rs.max - m0) / (a10.max - m0);
    expect(k).toBeCloseTo(0.9 / 0.6, 1);
  });

  it('рівень пасивки змінюється без вимикання; сила персонажа її враховує', () => {
    const base = { ...docFrom('typical-js'), path: null, buffs: undefined } as CharacterDoc;
    const lv5 = setBuffLvl(base, MASTERY_BOW, 5);
    expect(lv5.buffs?.cfg[String(MASTERY_BOW)]).toEqual({ on: true, lvl: 5, side: '' });
    const opp = { pa: 40, pz: 40 };
    expect(powerOf(lv5, opp, lookup).off).toBeLessThan(powerOf(base, opp, lookup).off);
  });
});
