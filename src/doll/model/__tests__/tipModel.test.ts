import { beforeAll, describe, expect, it } from 'vitest';
import { SLOTS } from '../../core/constants';
import { computeStats } from '../../core/stats';
import { getBuffById } from '../../core/refdata';
import type { DollState, TipCtx } from '../../core/types';
import { buildBuffTipModel, buildTipModel, itemGrade, propLine } from '../tipModel';
import { pvpWording } from '../../core/__tests__/tipWording';
import { calcState, loadRef, lookup } from './testDoc';

const TIPS = import.meta.glob('../../core/__tests__/golden/tips.json', { import: 'default', eager: true }) as Record<
  string,
  Record<string, Record<string, { name: string; lines: string[] }>>
>;
const tips = Object.values(TIPS)[0];

beforeAll(() => loadRef());

function slotTipCtx(build: DollState, key: string): TipCtx {
  return {
    gems: build.gems[key], refine: build.refine[key] || 0, isBook: key === 'qn', isWeapon: key === 'ta',
    engrave: build.engrave[key], addons: build.addons[key], wdf: build.wdf[key], crystal: build.crystal[key],
  };
}

const SAMPLE = [
  'typical-by', 'typical-ga', 'typical-js', 'edge-addons-append', 'edge-addons-replace', 'edge-engrave', 'edge-wdf-crystal',
  'edge-set-3-of-5', 'edge-gem-single-dop', 'edge-genie-flight-tome', 'edge-set-req-unmet', 'edge-rings-different',
];

describe('buildTipModel = текст тултіпа Хелпера', () => {
  for (const name of SAMPLE) {
    it(name, () => {
      const build = calcState(name);
      computeStats(build);
      let checked = 0;
      for (const def of SLOTS) {
        const it = build.equipped[def.slot];
        const exp = tips[name]?.[def.slot];
        if (!it || !exp) continue;
        const model = buildTipModel(it, def.cat, slotTipCtx(build, def.slot), build);
        const lines = model.lines.map((l) => l.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
        expect(lines, `${name}/${def.slot}`).toEqual(exp.lines.map(pvpWording));
        expect(exp.name).toContain(model.name);
        expect(exp.name.endsWith('+' + model.refine) || model.refine === 0).toBe(true);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('вимоги позначаються ok=false, деталі сету on; без build — усе ok', () => {
    const build = calcState('edge-set-req-unmet');
    const unmet = SLOTS.map((d) => d.slot).filter((s) => build.equipped[s]);
    let bad = 0;
    for (const s of unmet) {
      const def = SLOTS.find((d) => d.slot === s)!;
      const m = buildTipModel(build.equipped[s], def.cat, slotTipCtx(build, s), build);
      bad += m.lines.filter((l) => l.kind === 'req' && l.ok === false).length;
      for (const l of m.lines) {
        if (l.kind === 'setp') expect(typeof l.on).toBe('boolean');
        if (l.kind === 'req') expect(typeof l.ok).toBe('boolean');
      }
    }
    expect(bad).toBeGreaterThan(0);
    const weapon = lookup('ta', 1900)!;
    const noBuild = buildTipModel(weapon, 'ta');
    expect(noBuild.lines.filter((l) => l.kind === 'req').every((l) => l.ok)).toBe(true);
    expect(noBuild.lines.find((l) => l.kind === 'set')?.text).toMatch(/\(0\/6\)$/);
    expect(noBuild.lines.filter((l) => l.kind === 'setp').every((l) => l.on === false)).toBe(true);
    expect(noBuild.grade).toBe(itemGrade(weapon, 'ta').tier);
    expect(noBuild.name).toBe('☆☆ Важка сокира Ареса');
    expect(noBuild.refine).toBe(0);
    // Жодного HTML у текстах.
    for (const l of noBuild.lines) expect(l.text).not.toMatch(/[<>]/);
  });

  it('propLine / itemGrade', () => {
    expect(propLine('ed', 2)).toBe('Шанс криту +2%');
    expect(propLine('ci', 8)).toBe('Час співу −8');
    expect(propLine('ct', -10)).toBe('Вимоги по талантах +10%');
    expect(propLine('xn', 0.1)).toBe('Пауза між атаками −0.1 сек');
    expect(propLine('zzz', 1)).toBe('zzz +1');
    expect(itemGrade({ id: 1, an: 0, mi: 0, name: 'x', tv: '42' } as never)).toEqual({ tier: 4, stars: 2 });
    expect(itemGrade({ id: 1, an: 0, mi: 0, name: 'x', tv: '2' } as never)).toEqual({ tier: 1, stars: 2 });
    expect(itemGrade({ id: 1, an: 0, mi: 0, name: 'x', tv: '113' } as never)).toEqual({ tier: 11, stars: 3 });
    expect(itemGrade({ id: 1, an: 0, mi: 0, name: 'x', hf: 7 } as never, 'qn')).toEqual({ tier: 0, stars: 2 });
  });
});

describe('buildBuffTipModel', () => {
  it('рівень, параметри й опис — з формул ядра', () => {
    const build = calcState('edge-buffs-rs');
    const id = Number(Object.keys(build.buffCfg)[0]);
    const b = getBuffById(id)!;
    const m = buildBuffTipModel(build, b);
    expect(m.name).toBe(b.name);
    expect(m.lines[0]).toMatch(/^Рівень: \d+$/);
    expect(m.lines.length).toBeGreaterThan(1);
    for (const l of m.lines) expect(l).not.toMatch(/[<>]/);
  });
});
