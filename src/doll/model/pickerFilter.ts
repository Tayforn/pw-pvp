// =========================================================
// ЛЯЛЬКА — фільтр списку пікера речей. Порт pickerRows Хелпера
// (DollPage.tsx:423-458) як чиста функція: пошук «рівень + назва», типи (ir),
// «лише що вдягається», камені під річ, дедуплікація однакових речей
// (імʼя + іконка + вимога рівня + грейд), сортування й ліміт 400 рядків.
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
  limit?: number; // скільки рядків віддати (Хелпер — 400)
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
  const seen = new Set<string>();
  const rows = items.filter((it) => {
    if (gemHost && !gemOk(it, gemHost.cat, gemHost.item)) return false;
    if (lvlQ != null && pickerReqLvl(it) !== lvlQ) return false;
    if (nameQ && !String(it.name || '').toLowerCase().includes(nameQ)) return false;
    if (types && !types.has(String(it.ir))) return false;
    if (build && !meetsReq(build, it, gearAttr).ok) return false;
    const o = it as Record<string, unknown>;
    const key = it.name + '|' + o.an + '|' + (it.oj ?? '') + '|' + (o.tv ?? '');
    if (seen.has(key)) return false;
    seen.add(key);
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
