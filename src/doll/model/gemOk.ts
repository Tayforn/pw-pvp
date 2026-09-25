// =========================================================
// ЛЯЛЬКА — чи лізе камінь у гніздо речі. Порт фільтра пікера каменів
// Хелпера (DollPage.tsx, gemOk): рівень каменя не вище рівня речі, а в
// броню/зброю — лише «звичайні» камені (pg generic), не біжутерні.
// =========================================================

import type { Item } from '../core/types';

/** Категорії, куди ставлять лише камені pg=generic (біжутерні — ні). */
const GENERIC_ONLY: ReadonlySet<string> = new Set(['ft', 'rv', 'tg', 'rx', 'ta', 'wy', 'mj']);

export function gemOk(gem: Item, cat: string, slotItem: Item): boolean {
  const hostHf = Number(slotItem.hf) || 0;
  if (hostHf && (Number(gem.hf) || 0) > hostHf) return false;
  if (GENERIC_ONLY.has(cat) && gem.pg !== 'generic') return false;
  return true;
}
