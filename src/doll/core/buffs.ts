// =========================================================
// ЛЯЛЬКА — бафи: зведення ефектів (ib), рядок показаних станів, конфлікти.
// Порт із pw-calc src/lib/doll/buffs.ts: змінено імпорти, прибрано buffTipHtml
// (тултіп бафа у pvp — React-вузли, див. model/tipModel.ts).
// =========================================================

import { buffEffects, XZ } from './constants';
import { getBuffs, getDebuffs, getBuffDefaults, getBuffById } from './refdata';
import type { BuffDef, DollState } from './types';

/** Налаштування бафа (без мутації стану): існуюче або дефолт. */
export function buffCfgRead(build: DollState, id: number): { on: boolean; lvl: number; side: string } {
  return build.buffCfg[String(id)] || { on: false, lvl: 10, side: '' };
}

/** Стани у рядку: курований базовий набір + додані вручну (extraBuffs) + активні.
 *  Усе, чого нема в базі — додається юзером через попап. */
function withExtraActive(build: DollState, data: Record<string, BuffDef[]> | null, base: BuffDef[]): BuffDef[] {
  if (!data) return [];
  const byId: Record<number, BuffDef> = {};
  for (const k in data) for (const b of data[k]) byId[b.id] = b;
  const list = [...base];
  const ids = new Set(list.map((b) => b.id));
  const push = (id: number) => {
    const b = byId[id];
    if (b && !ids.has(id)) {
      list.push(b);
      ids.add(id);
    }
  };
  for (const id of build.extraBuffs) push(id);
  for (const k in build.buffCfg) if (build.buffCfg[k].on) push(Number(k));
  return list;
}
/** Бафи (pg=rk) у рядку: курований дефолт-набір класу (свій клас спереду) + додані + активні. */
export function shownBuffs(build: DollState): BuffDef[] {
  const buffs = getBuffs();
  if (!buffs) return [];
  const sm = XZ[build.cls] || 1;
  const byId: Record<number, BuffDef> = {};
  for (const k in buffs) for (const b of buffs[k]) byId[b.id] = b;
  const defIds = getBuffDefaults()?.[String(sm)] || [];
  const base = defIds.map((id) => byId[id]).filter((b): b is BuffDef => !!b);
  return withExtraActive(build, buffs, base);
}
/** Дебафи (pg=hb) у рядку: дебафи свого класу (do_by==sm) + додані + активні. */
export function shownDebuffs(build: DollState): BuffDef[] {
  const debuffs = getDebuffs();
  if (!debuffs) return [];
  const sm = XZ[build.cls] || 1;
  return withExtraActive(build, debuffs, debuffs[String(sm)] || []);
}

/** ib-карта зведених ефектів УСІХ увімкнених станів (бафи+дебафи) з buffCfg. */
export function deriveIb(build: DollState): Record<string, number> {
  const ib: Record<string, number> = {};
  for (const k in build.buffCfg) {
    const c = build.buffCfg[k];
    if (!c || !c.on) continue;
    const b = getBuffById(Number(k));
    if (!b) continue;
    for (const e of buffEffects(b, c.lvl, c.side)) ib[e.type] = (ib[e.type] || 0) + e.val;
  }
  return ib;
}

/** id активних станів, що конфліктують з активованим (спільний ex-стейт) — їх треба вимкнути
 *  (варіанти на кшталт «Вспышка ци / Высшая / Демона» — взаємовиключні, як на рефі). */
export function conflictingActive(build: DollState, activated: BuffDef): number[] {
  if (!activated.ex || !activated.ex.length) return [];
  const ex = new Set(activated.ex);
  const out: number[] = [];
  for (const k in build.buffCfg) {
    if (!build.buffCfg[k].on) continue;
    const id = Number(k);
    if (id === activated.id) continue;
    const b = getBuffById(id);
    if (b && b.ex && b.ex.some((e) => ex.has(e))) out.push(id);
  }
  return out;
}
