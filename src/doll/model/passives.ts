// =========================================================
// ЛЯЛЬКА — пасивки класу: майстерність зброї («Мастерство стрельбы»,
// «Мастер кинжала», «Техника боя с …»). У грі вони діють завжди і входять у
// фіз. атаку у вікні персонажа (множник атаки за типом зброї, +6 % за рівень,
// 11 рівень — світла +24 / темна +9 і крит). Тому лялька рахує їх завжди — у
// характеристиках, у скорі й у силі персонажа — навіть коли гравець їх не
// чіпав. Не налаштовано — 11 рівень зі стороною шляху персонажа (шлях з 89
// рівня), без шляху — 10. Гравець може змінити рівень, сторону або вимкнути
// (не вивчена). Налаштування лежить у doc.buffs.cfg, як у звичайних бафів.
// =========================================================

import { buffHasSides, buffMaxLevel, XZ } from '../core/constants';
import { getBuffs } from '../core/refdata';
import type { BuffDef } from '../core/types';
import type { BuffCfgRow, CharacterDoc } from './doc';

const MASTERY = /^gs_oi_[a-z]+_av_eg$/;
/** Рівень, з якого береться шлях (мудрець/демон). */
export const PATH_LEVEL = 89;

const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

/** Пасивка: свого класу, дає майстерність зброї, без мани й тривалості (не каст). */
export function isPassive(b: BuffDef, sm: number): boolean {
  return b.do_by === sm && b.types.some((t) => MASTERY.test(t)) && num(b.lm.mp) <= 0 && num(b.lm.vj) <= 0;
}

/** Пасивки класу (порожньо, поки довідники не завантажені). */
export function classPassives(cls: string): BuffDef[] {
  const buffs = getBuffs();
  const sm = XZ[cls];
  if (!buffs || !sm) return [];
  return (buffs[String(sm)] || []).filter((b) => isPassive(b, sm));
}

export function isClassPassive(cls: string, id: number): boolean {
  return classPassives(cls).some((b) => b.id === id);
}

/** Налаштування пасивки, коли гравець її не чіпав. */
export function passiveDefault(doc: Pick<CharacterDoc, 'path' | 'level'>, b: BuffDef): BuffCfgRow {
  const max = buffMaxLevel(b);
  if (buffHasSides(b) && doc.path && doc.level >= PATH_LEVEL) return { on: true, lvl: max, side: doc.path };
  return { on: true, lvl: Math.min(10, buffHasSides(b) ? Math.max(1, max - 1) : max), side: '' };
}

/** Дійсне налаштування пасивки: збережене або типове. */
export function passiveCfg(doc: CharacterDoc, b: BuffDef): BuffCfgRow {
  return doc.buffs?.cfg[String(b.id)] ?? passiveDefault(doc, b);
}
