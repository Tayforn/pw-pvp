// =========================================================
// СКАН СКРІНШОТІВ — один знімок: що на ньому. Гравець кидає скріншоти як є, не
// кажучи, де який, тож кожен пробуємо обома сканерами:
//  • вікно «Персонаж» шукаємо завжди — це швидко і дає масштаб інтерфейсу;
//  • сітку спорядження шукаємо, якщо вікна «Персонаж» на знімку немає або
//    знімок великий (екран цілком — тоді на ньому можуть бути обидва вікна).
// =========================================================

import { scanEquip, type EquipOpts, type EquipScan, type ScanSource } from './equip';
import type { Raster } from './raster';
import { scanStats, type StatsScan } from './stats';

/** Знімок, менший за це, — вирізане вікно: якщо на ньому «Персонаж», спорядження там уже немає. */
const WINDOW_PX = 400_000;

export interface ShotRead {
  stats: StatsScan | null;
  equip: EquipScan | null;
  /** Чому не знайдено ні того, ні іншого (порожньо, якщо щось знайдено). */
  reasons: string[];
}

/**
 * Розпізнати кілька знімків разом. Спершу на всіх шукаємо вікно «Персонаж» —
 * воно дає масштаб інтерфейсу, з яким сітку спорядження на решті шукати вдесятеро
 * швидше, хоч у якому порядку їх кинули. `opts.scale` — масштаб із раніше
 * прочитаного вікна, якщо серед нових знімків його немає.
 */
export function readShots(shots: Raster[], src: ScanSource, opts: EquipOpts = {}): ShotRead[] {
  const stats = shots.map((shot) => scanStats(shot));
  const hint = stats.find((s): s is StatsScan => s.ok)?.scale ?? opts.scale;
  return shots.map((shot, i) => {
    const st = stats[i];
    const statsOk = st.ok ? st : null;
    if (statsOk && shot.w * shot.h < WINDOW_PX) return { stats: statsOk, equip: null, reasons: [] };
    const equip = scanEquip(shot, src, { ...opts, scale: statsOk?.scale ?? hint });
    const equipOk = equip.ok ? equip : null;
    const reasons: string[] = [];
    if (!statsOk && !equipOk) {
      if (!st.ok) reasons.push(st.reason);
      if (!equip.ok) reasons.push(equip.reason);
    }
    return { stats: statsOk, equip: equipOk, reasons };
  });
}

/** Розпізнати один знімок. */
export function readShot(shot: Raster, src: ScanSource, opts: EquipOpts = {}): ShotRead {
  return readShots([shot], src, opts)[0];
}
