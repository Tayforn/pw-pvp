// =========================================================
// Фікстура golden-тесту → DollState. Фікстури зберігаються посиланнями
// (cat/id речей, id каменів, руни, кристала), тому одна й та сама функція
// збирає білд і для генератора (з каталогів calc), і для тесту (з каталогів pvp).
// Форма гнізд/списків — як у Хелпері після «надіти» (DollPage pickerEquip):
// масив гнізд довжини defaultSockets(cat) із null у порожніх.
// =========================================================

import { defaultSockets, SLOTS } from '../constants';
import { defaultState, type DollState, type Item } from '../types';

export interface FxStat {
  t: string; // код стату
  v: number;
}

export interface FxSlot {
  cat: string;
  id: number;
  r?: number; // заточка 0..12
  g?: number[]; // id каменів по гніздах, 0 = порожнє
  a?: FxStat[]; // «Характеристики» речі як у calc: непорожній список ЗАМІНЮЄ базу
  e?: FxStat[]; // гравіювання
  w?: number; // id руни шліфовки (лише зброя)
  c?: number; // id кристала (лише зброя)
}

export interface Fixture {
  name: string;
  tags?: string[]; // що саме перевіряє (для читача)
  cls: string;
  gender: 'm' | 'f';
  level: number;
  attrs: { str: number; dex: number; vit: number; mag: number };
  titles?: Record<string, number>;
  slots: Record<string, FxSlot>;
  buffCfg?: Record<string, { on: boolean; lvl: number; side: string }>;
  extraBuffs?: number[];
}

export type GetItem = (cat: string, id: number) => Item | undefined;

const rows = (list: FxStat[] | undefined): Array<{ type: string; val: number }> =>
  (list || []).map((s) => ({ type: s.t, val: s.v }));

/** Зібрати DollState із фікстури; відсутня в каталозі річ — помилка (фікстура зламана). */
export function hydrateFixture(fx: Fixture, getItem: GetItem): DollState {
  const need = (cat: string, id: number): Item => {
    const it = getItem(cat, id);
    if (!it) throw new Error(`фікстура «${fx.name}»: нема речі ${cat}/${id}`);
    return it;
  };
  const b = defaultState();
  b.cls = fx.cls;
  b.gender = fx.gender;
  b.level = fx.level;
  b.str = fx.attrs.str;
  b.dex = fx.attrs.dex;
  b.vit = fx.attrs.vit;
  b.mag = fx.attrs.mag;
  b.titles = { ...(fx.titles || {}) };
  b.buffCfg = JSON.parse(JSON.stringify(fx.buffCfg || {})) as DollState['buffCfg'];
  b.extraBuffs = [...(fx.extraBuffs || [])];
  for (const def of SLOTS) {
    const s = fx.slots[def.slot];
    if (!s) continue;
    if (s.cat !== def.cat) throw new Error(`фікстура «${fx.name}»: слот ${def.slot} очікує категорію ${def.cat}, а не ${s.cat}`);
    b.equipped[def.slot] = need(s.cat, s.id);
    const n = defaultSockets(s.cat);
    const gems: Array<Item | null> = n > 0 ? new Array<Item | null>(n).fill(null) : [];
    (s.g || []).forEach((gid, i) => {
      if (gid && i < n) gems[i] = need('ob', gid);
    });
    b.gems[def.slot] = gems;
    b.refine[def.slot] = s.r || 0;
    b.addons[def.slot] = rows(s.a);
    b.engrave[def.slot] = rows(s.e);
    b.wdf[def.slot] = s.w ? need('wdf', s.w) : null;
    b.crystal[def.slot] = s.c ? need('crystal', s.c) : null;
  }
  return b;
}
