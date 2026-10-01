// =========================================================
// ЛЯЛЬКА — фільтр списку пікера речей. Порт pickerRows Хелпера
// (DollPage.tsx:423-458) як чиста функція: пошук «рівень + назва», типи (ir),
// «лише що вдягається», камені під річ, сортування й ліміт рядків.
//
// Однойменні речі НЕ злипаються (аудит 30.09.2026: дедуплікація за
// назва|іконка|рівень|грейд ховала 49 зброй, 34 збірники, 16 кілець з іншими
// статами). Замість цього pickerVariants нумерує варіанти однієї назви —
// пікер показує бейдж «варіант N з M», а різницю видно в підписі рядка.
// =========================================================

import { meetsReq } from '../core/stats';
import { defaultState, type DollState, type Item } from '../core/types';
import { gemOk } from './gemOk';

export interface PickerFilterOpts {
  cls: string;
  level: number;
  onlyFit: boolean; // лише речі, що проходять вимоги
  attrs?: { str: number; dex: number; vit: number; mag: number }; // для onlyFit без готового build
  build?: DollState; // точний контекст вимог (переважає cls/level/attrs)
  gearAttr?: Record<string, number>; // бонуси атрибутів від речей (computeStats().gearAttr)
  types?: ReadonlySet<string>; // фільтр за ir (тип зброї/броні); порожній = усі
  gemHost?: { item: Item; cat: string } | null; // пікер каменя: під яку річ
  sort?: '' | 'lvl-asc' | 'lvl-desc';
  limit?: number; // скільки рядків віддати (Хелпер — 400; пікер зі списком-вікном передає великий ліміт)
}

export const PICKER_LIMIT = 400;

/** Рівень для фільтра цифрами: вимога oj, а без неї (книги/збірники) — рівень предмета hf. */
export function pickerReqLvl(it: Item): number {
  return Number(it.oj) || Number(it.hf) || 0;
}

/** Запит «101 меч» → рівень 101 + «меч»; «меч» → лише назва. */
export function parsePickerQuery(q: string): { lvl: number | null; name: string } {
  const m = q.trim().toLowerCase().match(/^(\d+)\s*(.*)$/);
  return m ? { lvl: Number(m[1]), name: m[2].trim() } : { lvl: null, name: q.trim().toLowerCase() };
}

function buildOf(opts: PickerFilterOpts): DollState {
  if (opts.build) return opts.build;
  const b = defaultState();
  b.cls = opts.cls;
  b.level = opts.level;
  if (opts.attrs) {
    b.str = opts.attrs.str;
    b.dex = opts.attrs.dex;
    b.vit = opts.attrs.vit;
    b.mag = opts.attrs.mag;
  }
  return b;
}

export function filterPickerItems(items: Item[], q: string, opts: PickerFilterOpts): { rows: Item[]; total: number } {
  const { lvl: lvlQ, name: nameQ } = parsePickerQuery(q);
  const gemHost = opts.gemHost || null;
  const types = gemHost ? null : opts.types && opts.types.size ? opts.types : null;
  const fitOnly = !gemHost && opts.onlyFit;
  const build = fitOnly ? buildOf(opts) : null;
  const gearAttr = opts.gearAttr || {};
  const rows = items.filter((it) => {
    if (gemHost && !gemOk(it, gemHost.cat, gemHost.item)) return false;
    if (lvlQ != null && pickerReqLvl(it) !== lvlQ) return false;
    if (nameQ && !String(it.name || '').toLowerCase().includes(nameQ)) return false;
    if (types && !types.has(String(it.ir))) return false;
    if (build && !meetsReq(build, it, gearAttr).ok) return false;
    return true;
  });
  if (opts.sort === 'lvl-asc') rows.sort((a, b) => pickerReqLvl(a) - pickerReqLvl(b));
  else if (opts.sort === 'lvl-desc') rows.sort((a, b) => pickerReqLvl(b) - pickerReqLvl(a));
  const limit = opts.limit ?? PICKER_LIMIT;
  return { rows: rows.slice(0, limit), total: rows.length };
}

/** Усі типи (ir) у списку — для чекбоксів фільтра, у порядку першої появи. */
export function pickerTypeIrs(items: Item[]): string[] {
  return [...new Set(items.map((it) => it.ir).filter((x): x is string => !!x))];
}

export interface PickerVariant {
  n: number; // номер варіанта в порядку каталогу, з 1
  of: number; // скільки всього однойменних
}

/** Однойменні речі каталогу (та сама назва, іконка, вимога рівня і грейд, але інші
 * стати) — id → «варіант N з M». Речі без двійників у мапі нема. Рахується по
 * всьому каталогу категорії, не по відфільтрованому списку: номер — властивість
 * речі, він не має стрибати від пошуку чи галочки «лише придатні». */
export function pickerVariants(items: Item[]): Map<number, PickerVariant> {
  const groups = new Map<string, number[]>();
  for (const it of items) {
    const o = it as Record<string, unknown>;
    const key = it.name + '|' + o.an + '|' + (it.oj ?? '') + '|' + (o.tv ?? '');
    const g = groups.get(key);
    if (g) g.push(Number(it.id));
    else groups.set(key, [Number(it.id)]);
  }
  const out = new Map<number, PickerVariant>();
  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, i) => out.set(id, { n: i + 1, of: ids.length }));
  }
  return out;
}

/** Текст бейджа варіанта: «варіант 2 з 4». */
export function variantText(v: PickerVariant): string {
  return 'варіант ' + v.n + ' з ' + v.of;
}
