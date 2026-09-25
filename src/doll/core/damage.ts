// =========================================================
// ЛЯЛЬКА — перевірка дамага по мобу (формули mypers ghk/vyp/oza/L).
// Порт із pw-calc src/lib/doll/damage.ts: змінено імпорти, прибрано dmgLogLine
// (лог урону у pvp — обʼєкти DmgLogEntry, рендер у панелі).
// =========================================================

import { defPerc, type CharStats } from './engine';
import type { OppMob, SkillDmg, SkillDef, DmgLogEntry } from './types';

export type { DmgLogEntry };

/** Дефолт — «Золотий король» (з рефу). */
export const DEFAULT_OPP: OppMob = {
  name: 'Золотий король', hp: 23977103, level: 150,
  physAtkMin: 17139, physAtkMax: 20567, magAtkMin: 7234, magAtkMax: 8681,
  acc: 4940, eva: 91, physDef: 2140, lw: 1767, mo: 1031, dn: 1767, vt: 1767, sp: 2871,
};

const ELEM_SHORT = ['lw', 'mo', 'dn', 'vt', 'sp'] as const;

/** % зрізання урону мобом для типу: фіз. або стихія (рахується від рівня атакуючого = нашого). */
export function oppReductionPerc(mob: OppMob, kind: 'phys' | 'lw' | 'mo' | 'dn' | 'vt' | 'sp', myLevel: number): number {
  const def = kind === 'phys' ? mob.physDef : mob[kind];
  return defPerc(def, myLevel || 1);
}
/** Середня маг. редукція по 5 стихіях. */
export function oppMagReductionPerc(mob: OppMob, myLevel: number): number {
  let s = 0;
  for (const e of ELEM_SHORT) s += oppReductionPerc(mob, e, myLevel);
  return s / 5;
}

/**
 * Множник рівня (mypers `oza`): залежить від різниці рівнів (мішень − атакуючий).
 * 3–5 → 0.9, 6–8 → 0.8, 9–11 → 0.7, 12–15 → 0.6, 16–20 → 0.5, >20 → 0.25, інакше 1.
 */
export function levelMult(atkLvl: number, defLvl: number): number {
  const n = defLvl - atkLvl;
  if (n >= 3 && n <= 5) return 0.9;
  if (n >= 6 && n <= 8) return 0.8;
  if (n >= 9 && n <= 11) return 0.7;
  if (n >= 12 && n <= 15) return 0.6;
  if (n >= 16 && n <= 20) return 0.5;
  if (n > 20) return 0.25;
  return 1;
}

/**
 * Множник рівнів атаки/захисту (mypers L): q = наш рівень атаки, w = рівень захисту цілі.
 * q>w → 1+(q−w)/100; q<w → 1/(1+1.2×(w−q)/100).
 */
export function atkLevelMult(q: number, w: number): number {
  if (q > w) return 1 + (q - w) / 100;
  if (q < w) return 1 / (1 + (1.2 * (w - q)) / 100);
  return 1;
}

/**
 * Урон скіла по мобу (формула mypers `ghk`/`vyp`):
 *   (атака × thw × oza + плоский урон скіла) × L (рівні атаки/захисту) × lvz (дух)
 *   × csf (урон монстрам) × (1 − % захисту мішені). Крит = урон × (крит. множник / 100).
 */
export function skillDamage(
  me: CharStats,
  mob: OppMob,
  sk: SkillDef,
  critMult: number,
  atkLvl: number,
  myLevel: number,
  spirit = 0,
  mobDmg = 0,
): SkillDmg {
  const hfMult = levelMult(myLevel || 1, mob.level || 1);
  const L = atkLevelMult(atkLvl, 0); // редактор моба не має рівня захисту → 0
  const lvz = (4000 + spirit) / 4000; // бойовий дух (mypers lvz; у моба mr = 0)
  const csf = 1 + (3 * mobDmg) / (300 + mobDmg); // «урон монстрам» (mypers csf; bc моба = 0)
  const red = sk.mag ? oppMagReductionPerc(mob, myLevel) : oppReductionPerc(mob, 'phys', myLevel);
  const z = 1 - red / 100;
  // Як у mypers vyp: атакова частина = фіз×pm + маг×mm (×oza), плоска — без oza;
  // L/lvz/csf множать усю суму.
  const calc = (p: number, m: number) =>
    Math.max(0, Math.round(((p * (sk.pm || 0) + m * (sk.mm || 0)) * hfMult + sk.flat) * L * lvz * csf * z));
  const min = calc(me.physAtk.min, me.magAtk.min);
  const max = calc(me.physAtk.max, me.magAtk.max);
  return { min, max, critMin: Math.round(min * critMult), critMax: Math.round(max * critMult) };
}

/**
 * Повний розрахунок урону скіла з тоталів спорядження (t) і бафів (ib) — 1:1 з legacy
 * logSkillDamage: крит-множник (спец-скіли перекривають), рівень атаки, дух, урон монстрам.
 */
export function computeSkillDamage(
  me: CharStats,
  mob: OppMob,
  sk: SkillDef,
  myLevel: number,
  t: Record<string, number>,
  ib: Record<string, number>,
): SkillDmg {
  // Крит. множник (mypers mq): 200% + gs_crit_rage_ghk зі споряди та бафів;
  // спец-скіли перекривають: 334 → ×1.5, 330/331 → ×1.3.
  let critMult = (200 + (t.gs_crit_rage_ghk || 0) + (ib.gs_crit_rage_ghk || 0)) / 100;
  if (sk.id === 334) critMult = 1.5;
  else if (sk.id === 330 || sk.id === 331) critMult = 1.3;
  // Рівень атаки: спорядження (ad) + бафи (gs_ad/−vh_ad).
  const atkLvl = (t.ad || 0) + (ib.ad || 0) + (ib.gs_ad || 0) - (ib.vh_ad || 0);
  const spirit = (t.mr || 0) + (t.vln || 0) + (ib.mr || 0) + (ib.vln || 0); // бойовий дух
  const mobDmg = (t.su || 0) + (t.qgc || 0) + (ib.su || 0) + (ib.qgc || 0); // урон монстрам
  return skillDamage(me, mob, sk, critMult, atkLvl, myLevel, spirit, mobDmg);
}
