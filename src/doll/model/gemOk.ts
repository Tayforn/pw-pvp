// =========================================================
// ЛЯЛЬКА — чи лізе камінь у гніздо речі. Порт фільтра пікера каменів
// Хелпера (DollPage.tsx, gemOk): рівень каменя не вище рівня речі, а в
// броню/зброю — лише «звичайні» камені (pg generic), не біжутерні.
// =========================================================

import type { Item } from '../core/types';

/** Категорії, куди ставлять лише камені pg=generic (біжутерні — ні). */
const GENERIC_ONLY: ReadonlySet<string> = new Set(['ft', 'rv', 'tg', 'rx', 'ta', 'wy', 'mj']);

/** Каменів у броню/зброю, яких на сервері немає (власник 25.09.2026: Ракшаса й
 * Светлого духа немає; максимум у броні — +1 ПА і +2 ПЗ, тож і Цзин Юэ +3 ПЗ).
 * У пікері їх не видно; уже вставлені лишаються — каталог не чіпаємо, щоб
 * документи не ламались. Біжутерійні камені (не generic) тут не зачеплено. */
export const NOT_ON_SERVER_GEMS: ReadonlySet<number> = new Set([
  54, // Камень Ракшаса, +3 ПА
  55, // Камень светлого духа, +2 ПА
  43, // Камень Цзин Юэ, +3 ПЗ
]);

export function gemOk(gem: Item, cat: string, slotItem: Item): boolean {
  if (NOT_ON_SERVER_GEMS.has(Number(gem.id))) return false;
  const hostHf = Number(slotItem.hf) || 0;
  if (hostHf && (Number(gem.hf) || 0) > hostHf) return false;
  if (GENERIC_ONLY.has(cat) && gem.pg !== 'generic') return false;
  return true;
}
