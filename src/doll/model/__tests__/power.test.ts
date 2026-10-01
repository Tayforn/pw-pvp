import { beforeAll, describe, expect, it } from 'vitest';
import { DOLL_ENGINE_VER } from '../../core/version';
import { POWER_OPPONENT, powerOf } from '../power';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

const OPP = { pa: 40, pz: 40 };

describe('сила з ляльки', () => {
  it('типовий суперник заявки — ПА 40 / ПЗ 40', () => {
    expect(POWER_OPPONENT).toEqual(OPP);
  });

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

  it('ПА зброї записана окремо (wpa, ціле ≥ 0); абілка зброї — код з каталогу, якщо є', () => {
    const doc = docFrom('typical-js');
    const p = powerOf(doc, OPP, lookup);
    expect(Number.isInteger(p.wpa)).toBe(true);
    expect(p.wpa).toBeGreaterThanOrEqual(0);
    if (p.abil !== undefined) expect(p.abil).toMatch(/^[a-z_]+$/);
  });
});
