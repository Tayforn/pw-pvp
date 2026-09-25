// =========================================================
// ЛЯЛЬКА — «похідні числа» білда для порівняння конфігурацій (Головний ↔ сет)
// і для майбутніх балів за сети. Нове в pvp; формули не свої — це лише вибірка
// з тоталів stats.ts і рушія engine.ts, як у summary.ts (g = t + ib).
// =========================================================

import { computeStats } from './stats';
import { computeSummary } from './summary';
import type { DollState } from './types';

export interface DerivedNumbers {
  pa: number; // рівень атаки: ad + gs_ad
  pz: number; // рівень захисту: sx + gs_sx
  channel: number; // час співу, %: ci − re + xj (додатне = швидше)
  xn: number; // зменшення паузи між атаками, сек
  aps: number; // атак/сек (0 без зброї)
  hp: number;
  physDef: number;
  magDefAvg: number; // середній маг. захист по 5 стихіях
  physAtkMin: number;
  physAtkMax: number;
  magAtkMin: number;
  magAtkMax: number;
}

/**
 * Похідні числа білда. `ib` — ефекти станів (deriveIb); за замовчуванням порожні,
 * бо власні бафи в порівняння сетів і в скор не входять. `t` можна передати,
 * якщо тотали вже пораховано (щоб не рахувати computeStats двічі).
 */
export function derivedNumbers(build: DollState, ib: Record<string, number> = {}, t?: Record<string, number>): DerivedNumbers {
  const tot = t ?? computeStats(build).t;
  const c = computeSummary(build, tot, ib).char;
  const g = (...keys: string[]): number => keys.reduce((s, k) => s + (tot[k] || 0) + (ib[k] || 0), 0);
  return {
    pa: g('ad', 'gs_ad'),
    pz: g('sx', 'gs_sx'),
    channel: g('ci') - g('re') + g('xj'),
    xn: g('xn'),
    aps: c.aps,
    hp: c.hp,
    physDef: c.physDef,
    magDefAvg: c.magDef,
    physAtkMin: c.physAtk.min,
    physAtkMax: c.physAtk.max,
    magAtkMin: c.magAtk.min,
    magAtkMax: c.magAtk.max,
  };
}
