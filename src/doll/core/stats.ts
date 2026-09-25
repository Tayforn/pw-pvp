// =========================================================
// ЛЯЛЬКА — чисті формули зведення стат зі спорядження.
// Порт із pw-calc src/lib/doll/stats.ts (коміт у version.ts): змінено лише
// імпорти. Формули PW (реверс mypers) НЕ змінені — це доводять golden-тести.
// =========================================================

import { SLOTS, ELEM, STAT_ALIAS, XZ, refineVal, QN_REFINE_ADDONS } from './constants';
import { getSets } from './refdata';
import type { Item, DollState, ReqCheck } from './types';

export const ATTR_BASE = 5; // базове значення кожного атрибута

// «Титули» — поля сумарних доповнень (порядок як у mypers) і кап значення (mypers titleLimit).
export const TITLE_LIMIT = 3000;
export const TITLE_FIELDS: Array<{ code: string; label: string }> = [
  { code: 'ld', label: 'Фіз. атака' },
  { code: 'xq', label: 'Маг. атака' },
  { code: 'wf', label: 'Фіз. захист' },
  { code: 'ab_gq', label: 'Маг. захист' },
  { code: 'ae', label: 'Міткість' },
  { code: 'qe', label: 'Ухилення' },
  { code: 'hp', label: 'Здоровʼя' },
];

export function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

/** Класове обмеження речі: hi — масив sm-ід класів (XZ), яким річ доступна.
 *  Порожній/відсутній або повний (всі 14) — обмеження немає. */
export function classRestriction(it: Item): number[] | null {
  const hi = (it as Record<string, unknown>).hi;
  if (!Array.isArray(hi) || hi.length === 0 || hi.length >= 14) return null;
  return hi as number[];
}

/** Чи відповідає персонаж вимогам речі (рівень + Сила/Спритн/Інт + клас).
 *  Атрибути — з урахуванням бонусів від речей (як у грі: трактат +45 інт дозволяє зброю з 297). */
export function meetsReq(build: DollState, it: Item, gear: Record<string, number> = {}): ReqCheck {
  const lvl = build.level >= (Number(it.oj) || 0);
  const str = build.str + (gear.om || 0) >= (Number(it.om_uo) || 0);
  const dex = build.dex + (gear.uy || 0) >= (Number(it.uy_uo) || 0);
  const mag = build.mag + (gear.tx || 0) >= (Number((it as Record<string, unknown>).tx_uo) || 0);
  const cr = classRestriction(it);
  const cls = !cr || cr.includes(XZ[build.cls] || 0);
  return { ok: lvl && str && dex && mag && cls, lvl, str, dex, mag, cls };
}

/** Доступно вільних очок статів: 5 за рівень (понад 1-й) мінус витрачені. */
export function availPoints(build: DollState): number {
  const budget = 5 * Math.max(0, (build.level || 1) - 1);
  const spent =
    build.str - ATTR_BASE + (build.dex - ATTR_BASE) + (build.vit - ATTR_BASE) + (build.mag - ATTR_BASE);
  return budget - spent;
}

/** Бонуси заточки речі на рівні lvl: [{type, val}] («av» → ld/xq за наявністю; книги — свої пороги). */
export function refineBonuses(it: Item, lvl: number, isBook: boolean): Array<{ type: string; val: number }> {
  const out: Array<{ type: string; val: number }> = [];
  const gh = it.gh as unknown;
  if (lvl > 0 && Array.isArray(gh) && typeof gh[1] === 'number') {
    const rv = refineVal(gh[1], lvl, isBook);
    const types = Array.isArray(gh[0]) ? (gh[0] as string[]) : [String(gh[0])];
    for (const rt of types) {
      if (rt === 'av') {
        if (Array.isArray(it.ld) || num(it.ld)) out.push({ type: 'ld', val: rv });
        if (Array.isArray(it.xq) || num(it.xq)) out.push({ type: 'xq', val: rv });
      } else out.push({ type: rt, val: rv });
    }
  }
  // Бонуси заточки книг (mypers ghAddons.qn): кумулятивні пороги +3/+6/+9/+12.
  if (isBook && lvl > 0) {
    for (const thr in QN_REFINE_ADDONS) {
      if (Number(thr) > lvl) continue;
      for (const [code, val] of Object.entries(QN_REFINE_ADDONS[Number(thr)])) out.push({ type: code, val });
    }
  }
  return out;
}

/** Дієвий доп каменя в контексті слота (у зброї obDops[0], інакше obDops[1]). */
export function gemDop(g: Item, isWeapon: boolean): [string, number] | null {
  const dops = g.obDops as unknown;
  if (!Array.isArray(dops)) return null;
  const pick = (isWeapon ? dops[0] : dops[1]) || dops[0];
  if (!Array.isArray(pick)) return null;
  return [String(pick[0]), parseFloat(String(pick[1])) || 0];
}

/** Додати стат до тоталів з урахуванням діапазонів/стихій. */
export function applyStat(add: (k: string, v: number) => void, type: string, v: number): void {
  if (type === 'ld') {
    add('ld_min', v);
    add('ld_max', v);
  } else if (type === 'xq') {
    add('xq_min', v);
    add('xq_max', v);
  } else if (type === 'ab_gq') {
    for (const e of ELEM) add(e, v);
  } else {
    add(type, v);
  }
}

/** Базові стати речі як редагований список {type,val} (для вкладки «Характеристики»). */
export function flattenItemStats(it: Item): Array<{ type: string; val: number }> {
  const o = it as Record<string, unknown>;
  const out: Array<{ type: string; val: number }> = [];
  // ld/xq: у зброї — діапазон [min,max], у біжутерії/поясів/боєприпасів/томів — плоске число (+N до обох меж)
  if (Array.isArray(it.ld)) {
    out.push({ type: 'ld_min', val: num(it.ld[0]) });
    out.push({ type: 'ld_max', val: num(it.ld[1]) });
  } else if (num(it.ld)) {
    out.push({ type: 'ld_min', val: num(it.ld) });
    out.push({ type: 'ld_max', val: num(it.ld) });
  }
  if (Array.isArray(it.xq)) {
    out.push({ type: 'xq_min', val: num(it.xq[0]) });
    out.push({ type: 'xq_max', val: num(it.xq[1]) });
  } else if (num(it.xq)) {
    out.push({ type: 'xq_min', val: num(it.xq) });
    out.push({ type: 'xq_max', val: num(it.xq) });
  }
  if (typeof it.wf === 'number' && it.wf) out.push({ type: 'wf', val: it.wf });
  const ab = it.ab_gq;
  if (typeof ab === 'number' && ab) out.push({ type: 'ab_gq', val: ab });
  else if (ab && typeof ab === 'object') {
    const m = ab as Record<string, unknown>;
    for (const e of ELEM) if (m[e] != null) out.push({ type: e, val: num(m[e]) });
  }
  if (typeof it.hp === 'number' && it.hp) out.push({ type: 'hp', val: it.hp });
  if (typeof o.mana === 'number' && o.mana) out.push({ type: 'mp', val: num(o.mana) });
  if (typeof it.qe === 'number' && it.qe) out.push({ type: 'qe', val: it.qe });
  const nw = it.nw as { wu?: Array<{ type?: string; val?: unknown }> } | undefined;
  if (nw && Array.isArray(nw.wu)) for (const w of nw.wu) if (w && w.type) out.push({ type: w.type, val: num(w.val) });
  return out;
}

/** Сумарні стати зі вказаних слотів (редаговані властивості + камені + заточка + сети). */
export function aggregateStats(build: DollState, active: ReadonlySet<string>): Record<string, number> {
  const t: Record<string, number> = {};
  const add = (k: string, v: number): void => {
    const key = STAT_ALIAS[k] || k;
    t[key] = (t[key] || 0) + v;
  };
  for (const slot in build.equipped) {
    const it = build.equipped[slot];
    if (!active.has(slot)) continue; // непридатна річ (не вистачає рівня/статів) — не враховується
    const addS = add;
    if (typeof it.sy === 'number') t.sy = Math.max(t.sy || 0, it.sy); // АПС — з предмета
    // Властивості речі (редаговані per-instance; якщо не задані — з бази предмета).
    const ad = build.addons[slot];
    const stats = ad && ad.length ? ad : flattenItemStats(it);
    for (const a of stats) if (a && a.type) applyStat(addS, a.type, num(a.val));
    // Камені в гніздах (у зброї діє obDops[0], інакше — obDops[1]).
    const ob = build.gems[slot];
    if (Array.isArray(ob)) {
      for (const g of ob) {
        const dop = g && gemDop(g, slot === 'ta');
        if (dop) applyStat(addS, dop[0], dop[1]);
      }
    }
    // Заточка (+N): бонуси головної стати за gh (книги — власна таблиця + порогові допи).
    for (const b of refineBonuses(it, build.refine[slot] || 0, slot === 'qn')) applyStat(addS, b.type, b.val);
    // Гравіювання (ручні стати, mypers item_engrave).
    for (const a of build.engrave[slot] || []) if (a && a.type) applyStat(addS, a.type, num(a.val));
    // Шліфовка (руна) і кристал — стати з nw.wu (mypers wdfDops/crystalDops).
    for (const sp of [build.wdf[slot], build.crystal[slot]]) {
      const wu = (sp?.nw as { wu?: Array<{ type?: string; val?: unknown }> } | undefined)?.wu;
      if (Array.isArray(wu)) for (const w of wu) if (w && w.type) applyStat(addS, w.type, num(w.val));
    }
  }
  // «Титули» (mypers ik): ручні сумарні доповнення — вливаються в тотали як стати речей.
  for (const [code, raw] of Object.entries(build.titles)) {
    const v = Math.min(TITLE_LIMIT, Math.max(0, Math.round(Number(raw) || 0)));
    if (!v) continue;
    if (code === 'ld') {
      add('ld_min', v);
      add('ld_max', v);
    } else if (code === 'xq') {
      add('xq_min', v);
      add('xq_max', v);
    } else {
      applyStat(add, code, v); // ab_gq розкладеться на 5 стихій, решта — flat
    }
  }
  // Бонуси комплектів (сетів): рахуємо деталі за спільним ps, додаємо zn для порогів ≤ к-сті.
  const sd = getSets();
  if (sd) {
    const psCount = setPieceCount(build, active);
    for (const ps in psCount) {
      const set = sd[ps];
      if (!set || !set.zn) continue;
      for (const k in set.zn) {
        if (Number(k) <= psCount[ps]) {
          const b = set.zn[k];
          if (b.type === 'ab_gq') {
            for (const e of ELEM) add(e, b.val);
          } else if (b.type === 'ld') {
            add('ld_min', b.val);
            add('ld_max', b.val);
          } else if (b.type === 'xq') {
            add('xq_min', b.val);
            add('xq_max', b.val);
          } else {
            add(b.type, b.val);
          }
        }
      }
    }
  }
  return t;
}

/** Набір слотів, чиї вимоги виконані. Атрибути від уже активних речей ідуть у залік
 *  (трактат +45 інт «вмикає» зброю з вимогою 297) — ітеруємо до фікспоінта. */
export function computeActiveSlots(build: DollState): Set<string> {
  const slots = Object.keys(build.equipped);
  const active = new Set<string>();
  for (let pass = 0; pass < slots.length; pass++) {
    const t = aggregateStats(build, active);
    let changed = false;
    for (const slot of slots) {
      if (!active.has(slot) && meetsReq(build, build.equipped[slot], t).ok) {
        active.add(slot);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return active;
}

/** Сумарні стати з усіх придатних надітих предметів + кеш бонусів атрибутів (gearAttr). */
export function computeStats(build: DollState): { t: Record<string, number>; gearAttr: Record<string, number> } {
  const t = aggregateStats(build, computeActiveSlots(build));
  return { t, gearAttr: { om: t.om || 0, uy: t.uy || 0, lf: t.lf || 0, tx: t.tx || 0 } };
}

/** Скільки деталей кожного сета (за спільним ps) надіто.
 *  Як у mypers: лише речі, що проходять вимоги, і без дублів (та сама річ двічі — 1 деталь). */
export function setPieceCount(build: DollState, active: ReadonlySet<string>): Record<string, number> {
  const c: Record<string, number> = {};
  const seen = new Set<string>();
  for (const slot in build.equipped) {
    const it = build.equipped[slot];
    if (!active.has(slot)) continue;
    const ps = (it as Record<string, unknown>).ps;
    if (ps == null) continue;
    const cat = SLOTS.find((s) => s.slot === slot)?.cat || slot;
    const key = cat + ':' + it.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const k = String(ps);
    c[k] = (c[k] || 0) + 1;
  }
  return c;
}
