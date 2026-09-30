// =========================================================
// ЛЯЛЬКА — dev: персонажі з golden-фікстур typical-* для сторінки /dev/doll
// (лише dev-збірка; у прод не потрапляє). Той самий шлях, що в тестах
// (model/__tests__/testDoc.ts docFrom): фікстура → DollState Хелпера →
// fromCalcDollState, — але без модулів __tests__: мінімальний «гідратор»
// фікстури тут, а речі — з каталогу застосунку (getItem), не з диска.
//
// typical.json — копія записів typical-* з core/__tests__/fixtures/manual.json
// (фікстури генерує scripts/doll-golden.ts). Що копія не розійшлась з
// оригіналом, стереже src/doll/__tests__/devFixtures.test.ts.
// =========================================================

import { SLOTS, defaultSockets } from '../core/constants';
import { defaultState, type DollState, type Item } from '../core/types';
import { ensureCats, getItem } from '../data/catalog';
import { ensureRefData } from '../data/refLoader';
import type { CharacterDoc } from '../model/doc';
import { fromCalcDollState } from '../model/importCalc';

interface DevStat {
  t: string;
  v: number;
}
interface DevSlot {
  cat: string;
  id: number;
  r?: number;
  g?: number[];
  a?: DevStat[];
  e?: DevStat[];
  w?: number;
  c?: number;
}
/** Фікстура golden-тесту — білд посиланнями (cat/id речей, id каменів, руни, кристала). */
export interface DevFixture {
  name: string;
  cls: string;
  gender: 'm' | 'f';
  level: number;
  attrs: { str: number; dex: number; vit: number; mag: number };
  titles?: Record<string, number>;
  slots: Record<string, DevSlot>;
  buffCfg?: Record<string, { on: boolean; lvl: number; side: string }>;
  extraBuffs?: number[];
}

const rows = (list: DevStat[] | undefined): Array<{ type: string; val: number }> => (list || []).map((s) => ({ type: s.t, val: s.v }));

/** Категорії каталогу, потрібні фікстурам: речі слотів + камені, руни, кристали. */
export function fixtureCats(list: DevFixture[]): string[] {
  const cats = new Set(['ob', 'wdf', 'crystal']);
  for (const fx of list) for (const s of Object.values(fx.slots)) cats.add(s.cat);
  return [...cats].sort();
}

/** Фікстура → DollState (як hydrateFixture тестів); відсутня в каталозі річ — помилка. */
function fixtureState(fx: DevFixture): DollState {
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

/** Документ персонажа з фікстури — через імпорт із Хелпера; імʼя — назва фікстури. */
export function fixtureDoc(fx: DevFixture): CharacterDoc {
  return { ...fromCalcDollState(fixtureState(fx)), name: fx.name };
}

/** Фікстури typical-* (по одній на клас) з уже завантаженими каталогом і довідниками. */
export async function loadDevFixtures(): Promise<DevFixture[]> {
  const list = (await import('./typical.json')).default as unknown as DevFixture[];
  await Promise.all([ensureRefData(), ensureCats(fixtureCats(list))]);
  return list;
}
