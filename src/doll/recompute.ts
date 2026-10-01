// =========================================================
// ЛЯЛЬКА — перерахунок скору v2 зі знімка заявки (адмінка). item_points пише
// клієнт гравця, тож адмін перед жеребкою перераховує його зі збереженого
// character_snapshot за версією шкали турніру: validateDoc → каталоги
// (ensureCats) → scoreItems → itemBreakdown із checked: true (спека B3, «Скор
// v2 — рішення після читальної перевірки», п. 12). Модуль вантажиться
// динамічно (import()) лише в адмінці (src/data/itemPointsRecalc.ts) —
// каталог ляльки в головний бандл не йде.
// =========================================================

import { classPointsFor, currentRulesVersion, hasRulesVersion, rulesFor } from '../data/gearRules';
import { NO_SNAPSHOT_HINT } from '../data/itemPointsRecalc';
import { loadRulesFromDb } from '../data/rulesStore';
import type { Genie, ItemBreakdown, Registration } from '../data/types';
import { ensureCats, getItem } from './data/catalog';
import { SLOT_CAT, isSlotKey, validateDoc, type CharacterDoc } from './model/doc';
import { docCats } from './model/hydrate';
import { itemBreakdown, scoreItems, type ItemScore } from './model/itemScore';
import { CLS_CHAR, charLevelOf, genieOf } from './model/sheet';

export interface RecomputeOptions {
  /** Версія шкали турніру (rulesVersionFor); невідома в реєстрі — поточна, з приміткою. */
  rulesVersion: string;
  /** Розмір команди турніру — бали класу в розкладі. */
  teamSize: number | null | undefined;
}

export interface RecomputeResult {
  /** Якою версією рахували. */
  rulesVersion: string;
  /** Скор v2 з назвами речей. */
  items: ItemScore;
  itemPoints: number;
  /** Розклад для item_breakdown — уже з checked: true. */
  itemBreakdown: ItemBreakdown;
  /** Версію турніру в реєстрі не знайдено — рахували поточною. */
  versionNote: string | null;
  /** Назви сетів документа — підписи конфігурацій розкладу. */
  setNames: string[];
}

/** Документ зі знімка заявки; null — знімка немає; помилка — знімок пошкоджено. */
export function docFromSnapshot(raw: unknown): CharacterDoc | null {
  if (raw == null) return null;
  const v = validateDoc(raw);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) throw new Error(`Знімок ляльки в заявці пошкоджено (${v.ok ? '' : v.errors[0]}) — перерахувати неможливо.`);
  return doc;
}

/**
 * Бали за речі зі знімка заявки за версією шкали турніру — так само, як їх
 * рахує заявка (registration.ts): клас за розміром команди, рівень і джин у
 * розкладі (джин — з анкети заявки, бо саме її бере registrationScore; без
 * анкети — з документа). Кидає Error із поясненням: знімка немає / пошкоджено.
 */
export async function recomputeFromSnapshot(reg: Pick<Registration, 'characterSnapshot' | 'gear'>, opts: RecomputeOptions): Promise<RecomputeResult> {
  const doc = docFromSnapshot(reg.characterSnapshot);
  if (!doc) throw new Error(NO_SNAPSHOT_HINT);
  // Версії шкали з бази — щоб версія турніру знайшлась (адмінка їх уже вантажить; тут — гарантія).
  await Promise.all([ensureCats(docCats(doc)), loadRulesFromDb()]);
  const known = hasRulesVersion(opts.rulesVersion);
  const rulesVersion = known ? opts.rulesVersion : currentRulesVersion();
  const rules = rulesFor(rulesVersion);
  const items = scoreItems(doc, rules);
  const genie: Genie = reg.gear?.genie ?? genieOf(doc) ?? 'g60';
  const breakdown: ItemBreakdown = {
    ...itemBreakdown(items, rulesVersion, {
      cls: classPointsFor(rules, CLS_CHAR[doc.cls], opts.teamSize),
      lvl: rules.level[charLevelOf(doc.level)],
      genie: rules.genie[genie],
    }),
    checked: true,
  };
  return {
    rulesVersion,
    items,
    itemPoints: items.itemPoints,
    itemBreakdown: breakdown,
    versionNote: known ? null : `версії шкали «${opts.rulesVersion}» немає в реєстрі — рахували поточною (${rulesVersion})`,
    setNames: doc.sets.map((s) => s.name),
  };
}

/** Назва речі з каталогу ляльки за слотом розкладу (кільця cr/cd — категорія oq);
 * категорія ще не завантажена чи id невідомий — null (рядок буде без назви). */
export function catalogItemName(catId: number, slot: string): string | null {
  if (!isSlotKey(slot)) return null;
  const it = getItem(SLOT_CAT[slot], catId);
  return it ? String(it.name).replace(/\s+/g, ' ').trim() : null;
}

/** Довантажити категорії каталогу для рядків розкладу — щоб catalogItemName
 * знав назви (знімок для цього не потрібен). */
export async function ensureBreakdownCats(b: Pick<ItemBreakdown, 'rows'>): Promise<void> {
  const cats = new Set<string>();
  for (const [, slot] of b.rows) if (isSlotKey(slot)) cats.add(SLOT_CAT[slot]);
  await ensureCats([...cats]);
}
