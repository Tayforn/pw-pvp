// =========================================================
// ЛЯЛЬКА — довідники (сети, стани, вміння, підписи), які ядру дають ззовні.
// Замінює fetch-сінглтони pw-calc src/modules/doll/data.ts: ядро нічого не
// вантажить, а отримує дані через setRefData (у застосунку — data/refLoader.ts,
// у тестах — з диска). Геттери названо як у calc, щоб stats/buffs/damage
// відрізнялись від оригіналу лише імпортами.
// =========================================================

import type { SetDef, BuffDef, SkillDef } from './types';

export interface RefData {
  sets: Record<string, SetDef>;
  buffs: Record<string, BuffDef[]>; // за do_by ("0" = глобальні), pg=rk
  debuffs: Record<string, BuffDef[]>; // за do_by, pg=hb
  buffDefaults: Record<string, number[]>; // sm → id бафів «за замовчуванням» у рядку
  skills: Record<string, SkillDef[]>; // sm → вміння класу
  fuState: Record<string, string>; // код ефекту → шаблон опису з {code}
  labels: Record<string, Record<string, string>>; // словники-мітки (pg, taAddons, …)
}

let ref: RefData | null = null;
let buffById: Record<number, BuffDef> = {};

/** Підставити довідники (повністю; повторний виклик замінює попередні). */
export function setRefData(d: RefData): void {
  ref = d;
  buffById = {};
  for (const map of [d.buffs, d.debuffs]) for (const sm in map) for (const b of map[sm]) buffById[b.id] = b;
}

/** Чи довідники вже підставлено (для станів «завантажую…» в UI). */
export function hasRefData(): boolean {
  return ref !== null;
}

export function getSets(): Record<string, SetDef> | null {
  return ref ? ref.sets : null;
}
export function getBuffs(): Record<string, BuffDef[]> | null {
  return ref ? ref.buffs : null;
}
export function getDebuffs(): Record<string, BuffDef[]> | null {
  return ref ? ref.debuffs : null;
}
/** Курований набір бафів, що показуються в рядку за замовчуванням (sm → id). */
export function getBuffDefaults(): Record<string, number[]> | null {
  return ref ? ref.buffDefaults : null;
}
/** Стан (баф або дебаф) за id. */
export function getBuffById(id: number): BuffDef | null {
  return buffById[id] || null;
}
export function getSkills(): Record<string, SkillDef[]> | null {
  return ref ? ref.skills : null;
}
export function getFuState(): Record<string, string> | null {
  return ref ? ref.fuState : null;
}
export function getLabels(): Record<string, Record<string, string>> | null {
  return ref ? ref.labels : null;
}
