// =========================================================
// ЛЯЛЬКА — готовність персонажа до турніру (права колонка сторінки):
//  • vitShare — частка розданих очок у Тілобудові (шкала збірки в «Атрибутах»);
//  • dollScorePreview — попередній скор v2 «від речей» прямо з документа в
//    руках, синхронно й так само, як його складе заявка (registration.ts):
//    клас + рівень + джин + бали за речі (model/itemScore.ts), без еталонів,
//    множників і режимів шкали; разом із розкладом по речах для картки;
//  • readinessIssues — чого бракує для «Усе заповнено» (імʼя, очки, шлях,
//    речі, що не вдягаються, зброя, слоти броні) і на що звернути увагу (не
//    блокує: порожні необовʼязкові слоти, джин, нерозпізнані речі, примітки
//    скору, старі галочки ШГ/Вознєс).
// Каталоги й довідники мають бути завантажені — як для dollFacts.
// Сторінка персонажа не знає турніру, тож бали класу — для команди 3×3; на
// турнірі вони за розміром команди, у жеребці ще корекції адміна.
// =========================================================

import { SLOTS } from '../core/constants';
import { computeActiveSlots } from '../core/stats';
import type { Item } from '../core/types';
import { classPointsFor, tierForWith, type ScoringRules } from '../../data/gearRules';
import { clsBit, genieWarnings } from '../../data/genie';
import type { Genie, Tier } from '../../data/types';
import { attrPointsLeft, SET_SLOT_KEYS, SLOT_KEYS, type CharacterDoc, type SlotKey } from './doc';
import { CFG_MAIN, toDollState, type CharacterModel, type ItemLookup } from './hydrate';
import { itemBreakdown, scoreItems, type ItemBreakdown, type ItemScore } from './itemScore';
import { PATH_LEVEL } from './passives';
import { CLS_CHAR, charLevelOf, dollMissing, genieOf, vitShare, type DollFacts } from './sheet';

export { vitShare };

/** Розмір команди для балів класу на сторінці персонажа — 3×3 (турнір сторінка не знає). */
export const PREVIEW_TEAM_SIZE = 3;

export interface ScorePreview {
  /** Скор v2: клас (teamSize) + рівень + джин + бали за речі, ціле — як у заявці (registrationScore). */
  score: number;
  tier: Tier;
  /** Складові скору: клас, рівень, джин і речі (itemPoints). */
  parts: { cls: number; lvl: number; genie: number; items: number };
  /** Рядок «Джин» шкали, за яким узято бали; filled — чи заповнено джина взагалі. */
  genie: Genie;
  genieFilled: boolean;
  /** Бали за речі з назвами (model/itemScore.ts). */
  items: ItemScore;
  /** Розклад у формі заявки — для спільного компонента ScoreBreakdown. */
  breakdown: ItemBreakdown;
}

/**
 * Попередній скор v2 для персонажа в редакторі — ті самі складові, що й у
 * заявці (registration.ts), за переданою версією шкали; бали класу — для
 * teamSize. Чисті числа без NaN: scoreItems дає 0 за порожню ляльку.
 */
export function dollScorePreview(doc: CharacterDoc, rules: ScoringRules, ver: string, teamSize: number = PREVIEW_TEAM_SIZE, lookup?: ItemLookup): ScorePreview {
  const items = scoreItems(doc, rules, lookup);
  const g = genieOf(doc);
  const genie: Genie = g ?? 'g60';
  const parts = {
    cls: classPointsFor(rules, CLS_CHAR[doc.cls], teamSize),
    lvl: rules.level[charLevelOf(doc.level)],
    genie: rules.genie[genie],
    items: items.itemPoints,
  };
  const score = Math.round(parts.cls + parts.lvl + parts.genie + parts.items);
  return {
    score, tier: tierForWith(score, rules), parts, genie, genieFilled: g != null, items,
    breakdown: itemBreakdown(items, ver, { cls: parts.cls, lvl: parts.lvl, genie: parts.genie }),
  };
}

/** Назви речей для розкладу (у ItemBreakdown назв немає) — з рядків scoreItems: «слот:id каталогу» → назва. */
export function itemNamesOf(items: ItemScore): (catId: number, slot: string) => string | null {
  const names = new Map<string, string>();
  for (const r of [...items.main, ...items.sets.flatMap((s) => s.rows)]) names.set(r.slot + ':' + r.catId, r.name);
  return (catId, slot) => names.get(slot + ':' + catId) ?? null;
}

export interface ReadinessIssues {
  /** Чого бракує для «Усе заповнено» (іменники для рядка «Бракує: …»). */
  blockers: string[];
  /** На що звернути увагу — не блокує ні збереження, ні заявку. */
  notes: string[];
}

/** Назва речі для рядка — без хвостових пробілів каталогу. */
const itemName = (it: Item): string => String(it.name).replace(/\s+/g, ' ').trim();
const MAX_BAD_ITEMS = 3;

/** Речі, що не вдягаються: у Головному — усі слоти, у сеті — лише власні
 * (добране з Головного й так перевірено на Головному). Невідома річ — теж. */
function badItems(doc: CharacterDoc, model: CharacterModel): string[] {
  const out: string[] = [];
  const check = (cfgId: string, where: string, slots: readonly SlotKey[], own: Partial<Record<SlotKey, string>>) => {
    const active = computeActiveSlots(toDollState(model, cfgId));
    for (const slot of slots) {
      const iid = own[slot];
      const h = iid ? model.items.get(iid) : undefined;
      if (!iid || (h?.item && active.has(slot))) continue;
      out.push((h?.item ? '«' + itemName(h.item) + '»' : 'невідома річ') + ' (' + where + ')');
    }
  };
  check(CFG_MAIN, 'Головний', SLOT_KEYS, doc.main);
  for (const set of doc.sets) check(set.id, 'сет «' + set.name + '»', SET_SLOT_KEYS, set.slots);
  return out;
}

/** Слоти речей, порожній з яких — лише нагадування (бали за них є, але заявку не блокують). */
const OPTIONAL_SLOTS: SlotKey[] = ['ft', 'wy', 'vx', 'st', 'cr', 'cd'];
const SLOT_NAME: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.slot, s.label.toLowerCase()]));

/** «порожній слот: шолом» / «порожні слоти: шолом, накидка» — за незаповненими слотами Головного; '' — усі заповнені. */
function emptySlots(doc: CharacterDoc, slots: readonly SlotKey[]): string {
  const names = slots.filter((s) => !doc.main[s]).map((s) => SLOT_NAME[s] ?? s);
  if (!names.length) return '';
  return (names.length === 1 ? 'порожній слот: ' : 'порожні слоти: ') + names.join(', ');
}

/** Назва речі в «…» — щоб не дублювати примітку скору, коли та сама річ уже є в gradeNotes. */
const quotedName = (s: string): string | undefined => /«([^»]+)»/.exec(s)?.[1];

/**
 * Що не так з персонажем для турніру. blockers — те, без чого плашка не стане
 * «Усе заповнено»: імʼя, нероздані (чи зайві) очки, шлях з 89 рівня, речі, що не
 * вдягаються, і те, без чого не подати заявку (dollMissing: жодної зброї,
 * порожній слот броні Головного). notes — жовті нагадування: порожні
 * необовʼязкові слоти, джина не заповнено, попередження джина, нерозпізнані
 * речі (gradeNotes), примітки скору v2 (items.warn: зброя в сеті дорожча, річ
 * не з сервера, кілька екземплярів), старі галочки ШГ/Вознєс без речі.
 */
export function readinessIssues(doc: CharacterDoc, model: CharacterModel, facts: DollFacts, items?: ItemScore | null): ReadinessIssues {
  const blockers: string[] = [];
  if (!doc.name.trim()) blockers.push('імʼя персонажа');
  const left = attrPointsLeft(doc.level, doc.attrs);
  if (left > 0) blockers.push('вільні очки атрибутів: ' + left);
  else if (left < 0) blockers.push('зайві очки атрибутів: роздано на ' + -left + ' більше, ніж дає рівень');
  if (doc.level >= PATH_LEVEL && !doc.path) blockers.push('шлях (Мудрець чи Демон) — з ' + PATH_LEVEL + ' рівня');
  const bad = badItems(doc, model);
  if (bad.length) {
    const more = bad.length > MAX_BAD_ITEMS ? ' і ще ' + (bad.length - MAX_BAD_ITEMS) : '';
    blockers.push('речі, що не вдягаються: ' + bad.slice(0, MAX_BAD_ITEMS).join(', ') + more);
  }
  // Зброя й броня — ті самі рядки, що блокують заявку (gearFromCharacter.missing).
  blockers.push(...dollMissing(doc, model));

  const notes: string[] = [];
  const optionalEmpty = emptySlots(doc, OPTIONAL_SLOTS);
  if (optionalEmpty) notes.push(optionalEmpty);
  if (genieOf(doc) == null) notes.push('джина не заповнено — за нього 0 балів');
  if (doc.genie) notes.push(...genieWarnings(doc.genie, clsBit(doc.cls)).map((w) => 'джин: ' + w));
  // Грейди йдуть у бали з речей, тож «лялька не розпізнала … — зараховано як …» — правда, яку гравець має бачити.
  notes.push(...facts.gradeNotes);
  if (items) {
    for (const w of items.warn) {
      const name = quotedName(w);
      const dup = /не розпізнала/.test(w) && name != null && facts.gradeNotes.some((g) => g.includes('«' + name + '»'));
      if (!dup && !notes.includes(w)) notes.push(w);
    }
  }
  // Стара анкета мала галочки «Є ШГ / Є Вознєс»; тепер ШГ і Вознєс лялька бачить лише на речах.
  if (doc.sheet?.shg && facts.shgRefine == null) notes.push('у старій анкеті стояла галочка ШГ, але «Шлема героя» на ляльці немає — заявка піде без нього');
  if (doc.sheet?.voznes && facts.voznesRefine == null) notes.push('у старій анкеті стояла галочка Вознєс, але «Плаща вознесения» на ляльці немає — заявка піде без нього');
  return { blockers, notes };
}
