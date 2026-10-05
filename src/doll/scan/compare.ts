// =========================================================
// СКАН СКРІНШОТІВ — числа вікна «Персонаж» проти ляльки. Заточок, каменів і
// ролів на скріншотах не видно, тож після заповнення ляльки зі скріншотів
// гравець доводить її руками, а ця таблиця підказує, де ще різниця: що показує
// гра, що рахує рушій ляльки і наскільки вони розходяться.
// =========================================================

import { deriveIb } from '../core/buffs';
import { computeStats } from '../core/stats';
import { computeSummary } from '../core/summary';
import { getItem } from '../data/catalog';
import type { CharacterDoc } from '../model/doc';
import { hydrate, toDollState, type ItemLookup } from '../model/hydrate';
import type { StatKey, StatsScan } from './stats';

/** Те, що показує вікно «Персонаж», пораховане рушієм ляльки для конфігурації —
 * без бафів, лише з пасивками класу (як у грі без накладених ефектів). */
export function dollNumbers(doc: CharacterDoc, cfgId: string, lookup: ItemLookup = getItem): Record<StatKey, number> {
  const build = toDollState(hydrate(doc, lookup), cfgId);
  const t = computeStats(build).t;
  const ib = deriveIb(build);
  const c = computeSummary(build, t, ib).char;
  const g = (...keys: string[]): number => keys.reduce((s, k) => s + (t[k] || 0) + (ib[k] || 0), 0);
  return {
    level: doc.level,
    hp: c.hp,
    mp: c.mp,
    vit: c.attr.vit,
    str: c.attr.str,
    mag: c.attr.mag,
    dex: c.attr.dex,
    physMin: c.physAtk.min,
    physMax: c.physAtk.max,
    magMin: c.magAtk.min,
    magMax: c.magAtk.max,
    crit: c.crit,
    aps: c.aps,
    acc: c.acc,
    pa: g('ad', 'gs_ad'),
    cast: g('ci') - g('re') + g('xj'),
    stealth: c.stealth,
    mobDmg: g('su', 'qgc'),
    physDef: c.physDef,
    magDef: c.magDef,
    critDmg: 200 + g('gs_crit_rage_ghk'),
    speed: c.speed,
    eva: c.eva,
    pz: g('sx', 'gs_sx'),
    soul: g('mk'),
    detect: c.detect,
    mobDef: g('wz', 'wkl'),
  };
}

/** Рядки звірки в порядку вікна гри: ключ, підпис, допустима різниця. Похідні
 * числа (ЖС, атака, захист…) рушій округлює трохи інакше, ніж гра, — їм ±1.
 * «Сили Духу» тут немає: лялька її не рахує. */
const ROWS: Array<[StatKey, string, number]> = [
  ['level', 'Рівень', 0],
  ['hp', 'ЖС', 1],
  ['mp', 'МЕ', 1],
  ['vit', 'Тіло', 0],
  ['str', 'Сила', 0],
  ['mag', 'Інтелект', 0],
  ['dex', 'Спритність', 0],
  ['physMin', 'Фіз. атака, мін', 1],
  ['physMax', 'Фіз. атака, макс', 1],
  ['magMin', 'Маг. атака, мін', 1],
  ['magMax', 'Маг. атака, макс', 1],
  ['crit', 'Шанс крит. удару, %', 0],
  ['aps', 'Атак/сек', 0.005],
  ['acc', 'Точність', 1],
  ['pa', 'Показник атаки', 0],
  ['cast', 'Підготовка заклинань', 0],
  ['stealth', 'Непомітність', 0],
  ['mobDmg', 'Шкода монстрам', 0],
  ['physDef', 'Фіз. захист', 1],
  ['magDef', 'Маг. захист', 1],
  ['critDmg', 'Крит. шкода, %', 0],
  ['speed', 'Швидкість, м/сек', 0.05],
  ['eva', 'Ухилення', 1],
  ['pz', 'Показник захисту', 0],
  ['detect', 'Виявлення', 0],
  ['mobDef', 'Захист від монстрів', 0],
];

export interface StatRow {
  key: StatKey;
  label: string;
  /** Число з гри; null — на скріншоті не прочитано. */
  game: number | null;
  doll: number;
  /** Чи збігається в межах допуску; null — порівняти нема з чим. */
  ok: boolean | null;
}

/** Порівняти числа зі скріншота з тим, що дає лялька в конфігурації. */
export function compareStats(doc: CharacterDoc, cfgId: string, stats: StatsScan, lookup: ItemLookup = getItem): StatRow[] {
  const doll = dollNumbers(doc, cfgId, lookup);
  return ROWS.map(([key, label, tol]) => {
    const game = stats.values[key] ?? null;
    return { key, label, game, doll: doll[key], ok: game === null ? null : Math.abs(game - doll[key]) <= tol + 1e-9 };
  });
}
