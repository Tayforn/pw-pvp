// =========================================================
// ЛЯЛЬКА — імпорт білда з Хелпера (ключ pwDollBuild у сховищі браузера = DollState).
// Речі там лежать цілими обʼєктами каталогу; тут лишаються посилання
// (cat, id) плюс правки екземпляра. «Характеристики» Хелпера (addons —
// повний список, що ЗАМІНЮЄ базу) розкладаються: якщо вони містять усю базу
// каталогу — зберігаємо лише добавку (x); інакше — xr + весь список, і адмін
// побачить, що каталожні стати речі не збігаються.
// =========================================================

import { SLOTS, XZ } from '../core/constants';
import { ATTR_BASE, TITLE_FIELDS, flattenItemStats } from '../core/stats';
import type { BackpackEntry, DollState, Item } from '../core/types';
import {
  MAX_LEVEL, SLOT_CAT, emptyDoc, isClsKey, isDocCat, isSlotKey, validateDoc,
  type BuffCfgRow, type CharacterDoc, type ItemInst, type SlotKey, type StatRow,
} from './doc';
import { normalizeInst } from './ops';

type Row = { type: string; val: number };
const TITLE_CODES = new Set(TITLE_FIELDS.map((f) => f.code));

/** Рядки Хелпера → рядки документа. Коди лишаються як є, навіть аліаси
 * (mana/oi_eq/ab_eq/metal_eq): ядро зводить їх само, а «ab_eq» у ньому НЕ
 * дорівнює «ab_gq» (перший лягає в мертвий ключ, другий розкладається на
 * 5 стихій) — канонізація змінила б числа проти Хелпера. */
function toRows(list: Row[] | undefined): StatRow[] {
  return (list || []).filter((a) => a && typeof a.type === 'string' && a.type).map((a) => ({ t: a.type, v: Number(a.val) || 0 }));
}

/** addons Хелпера → x/xr документа (мультимножинна різниця з базою каталогу). */
export function splitAddons(item: Item, addons: Row[] | undefined): { x?: StatRow[]; xr?: boolean } {
  const rows = toRows(addons);
  if (!rows.length) return {};
  const left = rows.map(() => true);
  let allBase = true;
  for (const b of flattenItemStats(item)) {
    const i = rows.findIndex((r, k) => left[k] && r.t === b.type && r.v === b.val);
    if (i < 0) {
      allBase = false;
      break;
    }
    left[i] = false;
  }
  if (!allBase) return { x: rows, xr: true };
  const x = rows.filter((_, k) => left[k]);
  return x.length ? { x } : {};
}

function idOf(it: Item | null | undefined): number {
  return it ? Math.floor(Number(it.id)) || 0 : 0;
}

function instOf(
  iid: string,
  cat: ItemInst['cat'],
  item: Item,
  parts: { gems?: Array<Item | null>; refine?: number; addons?: Row[]; engrave?: Row[]; wdf?: Item | null; crystal?: Item | null },
): ItemInst {
  const pw = Number((item as Record<string, unknown>).pw_id);
  return normalizeInst({
    i: iid,
    cat,
    id: idOf(item),
    p: Number.isFinite(pw) && pw > 0 ? pw : undefined,
    r: parts.refine || 0,
    g: (parts.gems || []).map(idOf),
    ...splitAddons(item, parts.addons),
    e: toRows(parts.engrave),
    w: cat === 'ta' ? idOf(parts.wdf) : 0,
    c: cat === 'ta' ? idOf(parts.crystal) : 0,
  });
}

/**
 * DollState Хелпера → CharacterDoc. Кидає Error українською, якщо клас
 * не з десяти (призрак/жнець/паладин/стрілок) або результат має зламану форму.
 * Порушення лише лімітів і правил (атрибутів роздано більше, ніж дає рівень,
 * понад 100 речей тощо) — не помилка імпорту: документ повертається, а
 * validateDoc(doc) покаже, що виправити перед збереженням.
 */
export function fromCalcDollState(state: DollState): CharacterDoc {
  const s = (state || {}) as Partial<DollState>;
  const cls = String(s.cls || '');
  if (!isClsKey(cls)) {
    const sm = XZ[cls];
    throw new Error(sm >= 11 ? 'цей клас не підтримується на сервері гільдії' : 'невідомий клас «' + cls + '»');
  }
  let doc = emptyDoc(cls);
  doc.gender = s.gender === 'f' ? 'f' : 'm';
  doc.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(s.level)) || 1));
  // Не нижче базових 5, як у грі; бюджет рівня не підрізаємо — перевитрату
  // покаже редактор, а validateDoc не дасть таке зберегти (див. нижче).
  const attr = (v: unknown) => Math.max(ATTR_BASE, Math.min(9999, Math.floor(Number(v)) || 0));
  doc.attrs = { str: attr(s.str ?? 5), dex: attr(s.dex ?? 5), vit: attr(s.vit ?? 5), mag: attr(s.mag ?? 5) };
  const titles: Partial<Record<string, number>> = {};
  for (const [k, v] of Object.entries(s.titles || {})) {
    const n = Math.max(0, Math.round(Number(v) || 0));
    if (TITLE_CODES.has(k) && n) titles[k] = n;
  }
  if (Object.keys(titles).length) doc.titles = titles;

  let n = 1;
  const items: ItemInst[] = [];
  const main: Partial<Record<SlotKey, string>> = {};
  const equipped = s.equipped || {};
  for (const def of SLOTS) {
    const it = equipped[def.slot];
    if (!it || !idOf(it) || !isSlotKey(def.slot) || !isDocCat(def.cat)) continue;
    const iid = (n++).toString(36);
    items.push(
      instOf(iid, def.cat, it, {
        gems: s.gems?.[def.slot],
        refine: s.refine?.[def.slot],
        addons: s.addons?.[def.slot],
        engrave: s.engrave?.[def.slot],
        wdf: s.wdf?.[def.slot],
        crystal: s.crystal?.[def.slot],
      }),
    );
    main[def.slot] = iid;
  }
  // Рюкзак Хелпера → сироти в інвентарі (ніде не надіті).
  for (const ent of (s.backpack || []) as Array<BackpackEntry | null>) {
    if (!ent || !ent.item || !idOf(ent.item)) continue;
    const cat = ent.cat || (isSlotKey(ent.slot) ? SLOT_CAT[ent.slot] : '');
    if (!isDocCat(cat)) continue;
    const iid = (n++).toString(36);
    items.push(instOf(iid, cat, ent.item, ent));
  }
  doc = { ...doc, items, main, nextIid: n };

  // Бафи — лише перегляд; форму чистимо, щоб validateDoc не спіткнувся об сміття.
  const cfg: Record<string, BuffCfgRow> = {};
  for (const [k, c] of Object.entries(s.buffCfg || {})) {
    if (!/^\d{1,9}$/.test(k) || !c) continue;
    const side = c.side === 'rs' || c.side === 'je' ? c.side : '';
    // Рівень 0 ядро Хелпера рахує як 1 (buffVal обмежує знизу), тож і тут 0 → 1,
    // а не «|| 10»; 10 — лише коли рівня нема зовсім (як buffCfgRead ядра).
    const lvl = Math.floor(Number(c.lvl));
    cfg[k] = { on: !!c.on, lvl: Number.isFinite(lvl) ? Math.max(1, Math.min(99, lvl)) : 10, side };
  }
  const extra = [...new Set((s.extraBuffs || []).map((x) => Math.floor(Number(x))).filter((x) => Number.isFinite(x) && x >= 0))];
  if (Object.keys(cfg).length || extra.length) doc.buffs = { cfg, extra };

  const v = validateDoc(doc);
  if (v.ok) return v.doc;
  if (v.recoverable) return v.recoverable;
  throw new Error('білд Хелпера не проходить перевірку: ' + v.errors.slice(0, 3).join('; '));
}
