// =========================================================
// ЛЯЛЬКА — константи й чисті довідкові функції.
// Порт із pw-calc src/modules/doll/data.ts БЕЗ fetch-завантажувачів, іконок
// (iconStyle/buffIconStyle → data/assets.ts) і мертвих STAT_GROUPS/BUFFS.
// Довідники (labels, fuState) беруться з refdata.ts, а не з модульних сінглтонів.
// =========================================================

import { getFuState, getLabels } from './refdata';
import type { BuffDef, SlotDef } from './types';

/** Категорії з гендерним спрайтом (вигляд відрізняється для ч/ж, індекс `an` той самий). */
export const GENDERED = new Set(['ft', 'rv', 'tg', 'rx', 'mj']);

/** Слоти ляльки (порядок = порядок у сітці). */
export const SLOTS: SlotDef[] = [
  { slot: 'ft', cat: 'ft', label: 'Шолом' },
  { slot: 'vx', cat: 'vx', label: 'Намисто' },
  { slot: 'rv', cat: 'rv', label: 'Нагрудник' },
  { slot: 'st', cat: 'st', label: 'Пояс' },
  { slot: 'tg', cat: 'tg', label: 'Поножі' },
  { slot: 'rx', cat: 'rx', label: 'Взуття' },
  { slot: 'wy', cat: 'wy', label: 'Накидка' },
  { slot: 'mj', cat: 'mj', label: 'Браслети' },
  { slot: 'cr', cat: 'oq', label: 'Кільце (л)' },
  { slot: 'cd', cat: 'oq', label: 'Кільце (п)' },
  { slot: 'ta', cat: 'ta', label: 'Зброя' },
  { slot: 'it', cat: 'it', label: 'Боєприпаси' },
  { slot: 'qn', cat: 'qn', label: 'Книга' },
  { slot: 'pp', cat: 'pp', label: 'Збірник' },
  { slot: 'pk', cat: 'pk', label: 'Джинн' },
  { slot: 'gv', cat: 'gv', label: 'Тома' },
  { slot: 'ic', cat: 'ic', label: 'Політ' },
];

// Кастомні допи (характеристики), які можна додати на річ у редакторі (як «допы» в mypers).
export const ADDON_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'ld_min', label: 'Фіз. атака (мін)' },
  { code: 'ld_max', label: 'Фіз. атака (макс)' },
  { code: 'xq_min', label: 'Маг. атака (мін)' },
  { code: 'xq_max', label: 'Маг. атака (макс)' },
  { code: 'lw_eq', label: 'Захист від металу' },
  { code: 'mo_eq', label: 'Захист від дерева' },
  { code: 'dn_eq', label: 'Захист від води' },
  { code: 'vt_eq', label: 'Захист від вогню' },
  { code: 'sp_eq', label: 'Захист від землі' },
  { code: 'co', label: 'Макс. HP (%)' },
  { code: 'cc', label: 'Макс. MP (%)' },
  { code: 'cx', label: 'Віднов. HP' },
  { code: 'mp_recovery', label: 'Віднов. MP' },
  { code: 'max_oi_av', label: 'Макс. фіз. атака' },
  { code: 'max_xq', label: 'Макс. маг. атака' },
  { code: 'bu', label: 'Зменш. фіз. урону (%)' },
  { code: 'ia', label: 'Зменш. маг. урону (%)' },
  { code: 'bonus_hf', label: 'Бонус рівня' },
  { code: 'hp', label: 'Здоровʼя' },
  { code: 'mp', label: 'Мана' },
  { code: 'om', label: 'Сила' },
  { code: 'lf', label: 'Тілобудова' },
  { code: 'uy', label: 'Спритність' },
  { code: 'tx', label: 'Інтелект' },
  { code: 'mk', label: 'Сила духу' },
  { code: 'mr', label: 'Бойовий дух' },
  { code: 'ld', label: 'Фіз. атака' },
  { code: 'xq', label: 'Маг. атака' },
  { code: 'wf', label: 'Фіз. захист' },
  { code: 'ab_gq', label: 'Маг. захист' },
  { code: 'ad', label: 'Рівень атаки' },
  { code: 'sx', label: 'Рівень захисту' },
  { code: 'ae', label: 'Міткість' },
  { code: 'qe', label: 'Ухилення' },
  { code: 'cl', label: 'Швидкість' },
  { code: 'ci', label: 'Час співу (%)' },
  { code: 'ed', label: 'Шанс криту (%)' },
  { code: 'pec', label: 'Фіз. пробивання' },
  { code: 'kdn', label: 'Маг. пробивання' },
  { code: 'wz', label: 'Захист від монстрів' },
  { code: 'su', label: 'Урон монстрам' },
];

// Усі коди стат, що можуть стояти в ролах речі (x/e документа персонажа):
// ADDON_OPTIONS ∪ коди nw.wu усіх каталогів. Білий список для validateDoc.
// Згенеровано scripts/doll-addon-codes.ts — не правити руками
// (перегенерувати: npx vite-node scripts/doll-addon-codes.ts).
// >>> ADDON_CODES
export const ADDON_CODES: readonly string[] = [
  'ld_min', 'ld_max', 'xq_min', 'xq_max', 'lw_eq', 'mo_eq', 'dn_eq', 'vt_eq',
  'sp_eq', 'co', 'cc', 'cx', 'mp_recovery', 'max_oi_av', 'max_xq', 'bu',
  'ia', 'bonus_hf', 'hp', 'mp', 'om', 'lf', 'uy', 'tx',
  'mk', 'mr', 'ld', 'xq', 'wf', 'ab_gq', 'ad', 'sx',
  'ae', 'qe', 'cl', 'ci', 'ed', 'pec', 'kdn', 'wz',
  'su', 'ab_gq_eg', 'ae_eg', 'cl_eg', 'cp', 'ct', 'exp', 'fp',
  'metal_eq', 'qe_eg', 'wf_eg', 'xn',
];
// <<< ADDON_CODES

/** Назви класів за sm-індексом (відповідає XZ: by=1…gunner=14). */
export const CLASS_BY_SM: Record<number, string> = {
  1: 'Воїн', 2: 'Маг', 3: 'Оборотень', 4: 'Друїд', 5: 'Жрець', 6: 'Лучник',
  7: 'Убивця', 8: 'Шаман', 9: 'Страж', 10: 'Містик', 11: 'Призрак', 12: 'Жнець',
  13: 'Паладин', 14: 'Стрілок',
};

/** Максимальний рівень бафа = найбільший числовий ключ у qc (понад 0). */
export function buffMaxLevel(b: BuffDef): number {
  let max = 1;
  for (const k in b.qc) {
    const q = b.qc[k] as Record<string, unknown> | unknown[];
    const keys = Array.isArray(q) ? q.map((_, i) => i) : Object.keys(q).map(Number);
    for (const n of keys) if (n > max) max = n;
  }
  return max;
}
/**
 * Значення стату на рівні/стороні — точна формула mypers `hs`:
 *   value = lm[key] + qc[key][0]·(рівень−1) + qc[key][рівень]?.[side]
 */
export function buffVal(b: BuffDef, key: string, level: number, side: string): number {
  let s = typeof b.lm[key] === 'number' ? b.lm[key] : 0;
  const q = b.qc[key] as Record<string, unknown> | undefined;
  if (q) {
    const L = Math.max(1, Math.min(buffMaxLevel(b), level));
    const inc = q['0'] != null ? Number(q['0']) : 0; // приріст за рівень
    let at = 0; // значення саме на цьому рівні (де визначене, напр. макс)
    const lv = (q as Record<string, unknown>)[String(L)];
    if (lv != null) at = typeof lv === 'object' ? Number((lv as Record<string, number>)[side]) || 0 : Number(lv) || 0;
    s += inc * (L - 1) + at;
  }
  // ціле, або 1 знак якщо дробове
  return Math.round(s * 10) / 10;
}
/** Ефекти бафа як {type,val} на рівні/стороні (для рушія й опису). */
export function buffEffects(b: BuffDef, level: number, side: string): Array<{ type: string; val: number }> {
  return b.types.map((t) => ({ type: t, val: buffVal(b, t, level, side) }));
}
/** Чи має баф варіанти світла/темна (rs/je в qc) — тобто вибір сторони має сенс. */
export function buffHasSides(b: BuffDef): boolean {
  for (const k in b.qc) {
    const q = b.qc[k];
    if (!q || typeof q !== 'object') continue;
    for (const lv of Object.values(q as Record<string, unknown>)) {
      if (lv && typeof lv === 'object') {
        const o = lv as Record<string, unknown>;
        if ('rs' in o || 'je' in o) return true;
      }
    }
  }
  return false;
}
/** Назва бафа з урахуванням сторони (світл/темн) — як на рефі. */
export function buffDisplayName(b: BuffDef, side: string): string {
  if (side === 'rs' && b.nameRs) return b.nameRs;
  if (side === 'je' && b.nameJe) return b.nameJe;
  return b.name;
}

/** Опис ефекту стану (з підстановкою значення у {code}). */
export function buffDesc(code: string, val: number): string {
  const fuState = getFuState();
  const tpl = fuState && fuState[code];
  if (!tpl) return code + ' +' + val;
  return tpl.replace(new RegExp('\\{' + code + '\\}', 'g'), String(val));
}

/** Підпис зі словника labels (pg, taAddons, …); без словника — сам ключ. */
export function lbl(dict: string, key: string | number | undefined): string {
  const labels = getLabels();
  if (key == null || !labels || !labels[dict]) return String(key ?? '');
  return labels[dict][String(key)] ?? String(key);
}

// Елементальні захисти (порядок: метал, дерево, вода, вогонь, земля).
export const ELEM = ['lw_eq', 'mo_eq', 'dn_eq', 'vt_eq', 'sp_eq'] as const;

// Базові формули PW (з mypers `sd`): HP = коеф×(Тілобудова + 2×(рівень−1)),
// MP = коеф×(Інтелект + 2×(рівень−1)). Коефіцієнт — на клас.
export const HP_VIT: Record<string, number> = {
  by: 15, ej: 15, paladin: 15, ya: 17, rl: 12, js: 13, fx: 13, uf: 13, gunner: 13,
  ga: 10, ij: 10, sj: 10, rg: 10, he: 10,
};
export const MP_MAG: Record<string, number> = {
  by: 9, ej: 9, paladin: 9, ya: 7, rl: 12, js: 11, fx: 11, uf: 11, gunner: 11,
  ga: 14, ij: 14, sj: 14, rg: 14, he: 14,
};
// Міткість / ухилення = коеф × Спритність (на клас).
export const ACC_DEX: Record<string, number> = {
  by: 10, ej: 10, paladin: 10, ya: 8, rl: 7, js: 8, fx: 8, rg: 8, uf: 8, gunner: 8,
  ga: 5, ij: 5, sj: 5, he: 5,
};
export const EVA_DEX: Record<string, number> = {
  by: 10, ej: 10, paladin: 10, ya: 8, rl: 6, js: 6, fx: 6, rg: 6, uf: 6, gunner: 6,
  ga: 2, ij: 2, sj: 2, he: 2,
};
// Базова швидкість руху класу, м/с (mypers sd.gy).
export const SPEED_BASE: Record<string, number> = {
  by: 5, ej: 5, paladin: 5, ya: 4.9, rl: 5.1, js: 5.2, fx: 5.2, uf: 5.2, gunner: 5.2,
  ga: 4.8, ij: 4.8, sj: 4.8, rg: 4.8, he: 4.8,
};
// Клас → індекс sm (визначає per-level фактор атаки в mypers).
export const XZ: Record<string, number> = {
  by: 1, ga: 2, ya: 3, rl: 4, ij: 5, js: 6, fx: 7, sj: 8, ej: 9, rg: 10, uf: 11, he: 12, paladin: 13, gunner: 14,
};
// Типи зброї, що рахують фіз. атаку від Спритності (інші — від Сили).
export const DEX_WEAPONS = new Set(['ne', 'eb', 'fo', 'firearm']);

// Слоти з гніздами під камені — фіксована к-сть клітинок, як у mypers
// (initGemCells): зброя 2, броня/біжутерія/збірник — 4.
// Кільця/намисто/пояс (oq/vx/st) гнізд не мають.
export const SOCKETABLE = new Set(['ta', 'ft', 'rv', 'tg', 'rx', 'wy', 'mj', 'pp']);
export function defaultSockets(cat: string): number {
  if (!SOCKETABLE.has(cat)) return 0;
  return cat === 'ta' ? 2 : 4;
}
export function maxSockets(cat: string): number {
  return defaultSockets(cat);
}

// Заточка (+1..+12) — точно як у mypers: спершу цілочисельна таблиця ghTable
// з поправкою ghCorrect[база][рівень] (для книг — ghBookCorrect); якщо для цієї
// бази/рівня поправки немає — фолбек round(база × ghTablePerc).
export const GH_PERC = [1, 2, 3.05, 4.3, 5.75, 7.55, 9.95, 13, 17.05, 22.03, 29, 37.5];
const GH_INT = [1, 2, 3, 4, 5, 7, 9, 13, 17, 22, 29, 37];
const GH_CORRECT: Record<number, Record<number, number>> = {
  8: { 4: 3, 5: 7, 6: 5, 7: 9, 10: 3, 12: 5 },
  10: { 4: 3, 5: 7, 6: 5, 7: 9, 10: 3, 12: 5 },
  11: { 4: 3, 5: 8, 6: 6, 7: 10, 10: 3, 12: 5 },
  12: { 4: 3, 5: 9, 6: 6, 7: 11, 10: 3, 12: 6 },
  13: { 4: 4, 5: 9, 6: 7, 7: 13, 10: 3, 12: 6 },
  14: { 4: 4, 5: 10, 6: 7, 7: 13, 10: 4, 12: 7 },
  15: { 4: 4, 5: 11, 6: 8, 7: 14, 10: 4, 12: 7 },
  16: { 4: 4, 5: 12, 6: 8, 7: 15, 10: 4, 12: 8 },
  17: { 4: 5, 5: 12, 6: 9, 7: 16, 10: 5, 12: 8 },
  18: { 4: 5, 5: 13, 6: 10, 7: 17, 10: 5, 12: 9 },
  19: { 3: 1, 4: 5, 5: 14, 6: 10, 7: 18, 9: 1, 10: 5, 12: 9 },
  20: { 3: 1, 4: 6, 5: 15, 6: 11, 7: 19, 9: 1, 10: 6, 12: 10 },
  21: { 3: 1, 4: 6, 5: 15, 6: 11, 7: 20, 9: 1, 10: 6, 12: 10 },
  22: { 3: 1, 4: 6, 5: 16, 6: 12, 7: 20, 9: 1, 10: 6, 12: 11 },
  24: { 3: 1, 4: 7, 5: 18, 6: 13, 7: 22, 9: 1, 10: 7, 12: 12 },
  25: { 3: 1, 4: 7, 5: 18, 6: 13, 7: 23, 9: 1, 10: 7, 12: 12 },
  26: { 3: 1, 4: 7, 5: 19, 6: 14, 7: 24, 9: 1, 10: 7, 12: 13 },
  27: { 3: 1, 4: 8, 5: 20, 6: 14, 7: 25, 9: 1, 10: 8, 12: 13 },
  28: { 3: 1, 4: 8, 5: 21, 6: 15, 7: 26, 9: 1, 10: 8, 12: 14 },
  30: { 3: 1, 4: 9, 5: 22, 6: 16, 7: 28, 9: 1, 10: 9, 12: 15 },
  32: { 3: 1, 4: 9, 5: 24, 6: 17, 7: 30, 9: 1, 10: 9, 12: 16 },
  33: { 3: 1, 4: 10, 5: 24, 6: 18, 7: 31, 9: 1, 10: 9, 12: 16 },
  35: { 3: 1, 4: 10, 5: 26, 6: 19, 7: 33, 9: 1, 10: 10, 12: 17 },
  36: { 3: 1, 4: 10, 5: 27, 6: 19, 7: 34, 9: 1, 10: 10, 12: 18 },
  37: { 3: 1, 4: 11, 5: 27, 6: 20, 7: 35, 9: 1, 10: 11, 12: 18 },
  39: { 3: 2, 4: 11, 5: 29, 6: 21, 7: 37, 9: 2, 10: 11, 12: 19 },
  40: { 3: 2, 4: 12, 5: 30, 6: 22, 7: 38, 9: 2, 10: 12, 12: 20 },
  42: { 3: 2, 4: 12, 5: 31, 6: 23, 7: 39, 9: 2, 10: 12, 12: 21 },
  44: { 3: 2, 4: 13, 5: 33, 6: 24, 7: 41, 9: 2, 10: 13, 12: 22 },
  45: { 3: 2, 4: 13, 5: 33, 6: 24, 7: 42, 9: 2, 10: 13, 12: 22 },
  48: { 3: 2, 4: 14, 5: 36, 6: 26, 7: 45, 9: 2, 10: 14, 12: 24 },
  51: { 3: 2, 4: 15, 5: 38, 6: 28, 7: 48, 9: 2, 10: 15, 12: 25 },
  52: { 3: 2, 4: 15, 5: 39, 6: 28, 7: 49, 9: 2, 10: 15, 12: 26 },
  56: { 3: 2, 4: 16, 5: 42, 6: 30, 7: 53, 9: 2, 10: 16, 12: 28 },
  60: { 3: 3, 4: 18, 5: 45, 6: 33, 7: 57, 9: 3, 10: 18, 12: 30 },
  64: { 3: 3, 4: 19, 5: 48, 6: 35, 7: 60, 9: 3, 10: 19, 12: 32 },
  68: { 3: 3, 4: 20, 5: 51, 6: 37, 7: 64, 9: 3, 10: 20, 12: 34 },
};
const GH_BOOK_CORRECT: Record<number, Record<number, number>> = {
  5: { 4: 1, 5: 3, 6: 2, 7: 4, 10: 1, 12: 2 },
  6: { 4: 1, 5: 4, 6: 3, 7: 5, 10: 1, 12: 3 },
  7: { 4: 2, 5: 5, 6: 3, 7: 6, 10: -1, 11: -3, 12: 0 },
  8: { 4: 2, 5: 6, 6: 4, 7: 7, 10: 2, 11: 0, 12: 4 },
  9: { 4: 2, 5: 6, 6: 5, 7: 8, 10: 2, 11: 0, 12: 4 },
  10: { 3: 0, 4: 3, 5: 7, 6: 5, 7: 9, 9: 0, 10: 3, 11: 0, 12: 5 },
  11: { 3: 0, 4: 3, 5: 8, 6: 6, 7: 10, 9: 0, 10: 3, 11: 0, 12: 5 },
  12: { 3: 0, 4: 3, 5: 9, 6: 6, 7: 11, 9: 0, 10: 3, 11: 0, 12: 6 },
  14: { 3: 0, 4: 4, 5: 10, 6: 7, 7: 13, 9: 0, 10: 4, 11: 0, 12: 7 },
};
export function refineVal(ghBase: number, level: number, isBook = false): number {
  if (level < 1 || level > 12) return 0;
  // Книги: спершу власна таблиця; якщо поправки немає — падаємо в загальну (як mypers refVal).
  if (isBook) {
    const bc = GH_BOOK_CORRECT[ghBase];
    if (bc && bc[level] !== undefined) return ghBase * GH_INT[level - 1] + bc[level];
  }
  const corr = GH_CORRECT[ghBase];
  if (corr && corr[level] !== undefined) return ghBase * GH_INT[level - 1] + corr[level];
  return Math.round(ghBase * GH_PERC[level - 1]);
}
// Додаткові бонуси заточки книг (mypers ghAddons.qn) — кумулятивні пороги +3/+6/+9/+12.
export const QN_REFINE_ADDONS: Record<number, Record<string, number>> = {
  3: { ld: 50, xq: 50 },
  6: { ld: 80, xq: 80 },
  9: { ad: 5 },
  12: { ad: 15 },
};

// Аліаси кодів стат до канонічних (co/cc — НЕ аліаси: це % макс. HP/MP, рушій їх читає окремо).
export const STAT_ALIAS: Record<string, string> = { mana: 'mp', oi_eq: 'wf', ab_eq: 'ab_gq', metal_eq: 'lw_eq' };
