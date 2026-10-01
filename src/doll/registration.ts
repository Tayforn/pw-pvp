// =========================================================
// ЛЯЛЬКА — заявка на турнір персонажем. Форма заявки (RegisterPage) у
// головному бандлі, а ляльці потрібні каталоги й формули — тож цей модуль
// вантажиться динамічно (import()), лише коли гравець обрав персонажа.
//
// Крок C скору v2: разом із анкетою (legacy-колонки заявки, gearFromCharacter)
// заявка несе itemPoints і itemBreakdown — бали за речі ляльки за версією шкали
// турніру (model/itemScore.ts). Скор заявки = клас + itemPoints + рівень + джин
// (registrationScore у gearRules.ts); адмін перераховує зі знімка.
// =========================================================

import {
  classPointsFor, currentRulesVersion, hasRulesVersion, rulesFor, tableGearPartWith, type DollRef, type GearRules,
} from '../data/gearRules';
import { loadRulesFromDb } from '../data/rulesStore';
import type { CharClass, DollPower, ItemBreakdown } from '../data/types';
import { getCharacter, listCharacters, type CharacterRecord, type CharacterSummary } from './api/characters';
import { ensureCats } from './data/catalog';
import { ensureRefData } from './data/refLoader';
import { validateDoc, type CharacterDoc } from './model/doc';
import { docCats } from './model/hydrate';
import { itemBreakdown, scoreItems, type ItemScore } from './model/itemScore';
import { powerOf } from './model/power';
import { PREVIEW_TEAM_SIZE } from './model/readiness';
import { CLS_CHAR, charLevelOf, dollFacts, gearFromCharacter, genieOf, type CharacterGear } from './model/sheet';

export type { CharacterSummary };

export interface CharacterForRegistration {
  rec: CharacterRecord;
  doc: CharacterDoc;
  result: CharacterGear;
  /** Чи йдуть свап-сети в бали (перемикач поточної версії шкали). */
  setsFromDoll: boolean;
  /** Атака й живучість — для скору з ляльки (legacy, doll_power). */
  power: DollPower;
  /** Версія шкали, якою рахували скор v2: закріплена за турніром, інакше поточна. */
  rulesVersion: string;
  /** Скор v2 «від речей» з назвами речей (для розкладу у формі). */
  items: ItemScore;
  /** Те, що піде в item_points / item_breakdown заявки. */
  itemPoints: number;
  itemBreakdown: ItemBreakdown;
  /** Чому заявку не подати (анкета неповна); null — можна. */
  blockReason: string | null;
}

export interface RegistrationOptions {
  /** Версія шкали турніру (rulesVersionFor); невідома чи відсутня — поточна. */
  rulesVersion?: string | null;
  /** Розмір команди турніру — бали класу в розкладі; без нього — 3×3. */
  teamSize?: number | null;
}

export function myCharacters(): Promise<CharacterSummary[]> {
  return listCharacters().then((r) => r.characters);
}

/** Так gearFromCharacter називає зброю й броню, яких немає на ляльці (решта missing — поля анкети). */
const DOLL_MISSING: Record<string, string> = { 'зброя на ляльці': 'зброї', 'броня на ляльці': 'броні' };

/**
 * «Заявку не подати: у персонажа немає зброї в Головному (або не заповнена
 * анкета: грейд зброї, джин).» — з missing анкети; null — усе є. Зброя й броня
 * на ляльці — окремо від полів анкети (та зникає кроком D).
 */
export function submitBlockReason(missing: readonly string[]): string | null {
  if (!missing.length) return null;
  const doll = missing.filter((m) => m in DOLL_MISSING).map((m) => DOLL_MISSING[m]);
  const sheet = missing.filter((m) => !(m in DOLL_MISSING));
  const dollText = doll.length ? `у персонажа немає ${doll.join(' і ')} в Головному` : '';
  const sheetText = sheet.length ? `не заповнена анкета: ${sheet.join(', ')}` : '';
  if (dollText && sheetText) return `Заявку не подати: ${dollText} (або ${sheetText}).`;
  return `Заявку не подати: ${dollText || sheetText}.`;
}

/** Завантажити персонажа й зібрати з нього анкету заявки й скор v2. Кидає Error з поясненням. */
export async function characterForRegistration(id: string, opts: RegistrationOptions = {}): Promise<CharacterForRegistration> {
  const rec = await getCharacter(id);
  const v = validateDoc(rec.doc);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) throw new Error('Документ персонажа пошкоджено — відкрий його на сторінці персонажа й збережи ще раз.');
  // Версії шкали з бази — щоб версія турніру знайшлась (main.tsx їх уже вантажить; тут — гарантія).
  await Promise.all([ensureRefData(), ensureCats(docCats(doc)), loadRulesFromDb()]);
  const rulesVersion = opts.rulesVersion && hasRulesVersion(opts.rulesVersion) ? opts.rulesVersion : currentRulesVersion();
  const rules = rulesFor(rulesVersion);
  const setsFromDoll = rules.setsFromDoll;
  const facts = dollFacts(doc, rules);
  const result = gearFromCharacter(doc, facts, { setsFromDoll });
  // Разом із силою в заявку йде склад каменів — адмін бачить його замість рядка таблиці.
  const power = {
    ...powerOf(doc, { pa: rules.dollScore.oppPa, pz: rules.dollScore.oppPz }),
    gems: facts.gemCounts,
    ...(facts.weaponPzGain > 0 ? { pzw: Math.round(facts.weaponPzGain * 10) / 10 } : {}),
  };
  // Скор v2: бали за речі + розклад із класом (за розміром команди), рівнем і джином —
  // ті самі складові, що registrationScore бере з анкети, тож sum сходиться зі скором.
  const items = scoreItems(doc, rules);
  const teamSize = opts.teamSize ?? PREVIEW_TEAM_SIZE;
  const genie = result.gear?.genie ?? genieOf(doc) ?? 'g60';
  const breakdown = itemBreakdown(items, rulesVersion, {
    cls: classPointsFor(rules, CLS_CHAR[doc.cls], teamSize),
    lvl: rules.level[charLevelOf(doc.level)],
    genie: rules.genie[genie],
  });
  return {
    rec, doc, result, setsFromDoll, power, rulesVersion, items,
    itemPoints: items.itemPoints, itemBreakdown: breakdown, blockReason: submitBlockReason(result.missing),
  };
}

/**
 * Еталон класу для «Шкали балів» зі збереженого персонажа: атака й живучість
 * (з типовим суперником чернетки шкали) і бали спорядження за таблицею, якщо
 * анкета персонажа повна (інакше base = 0 — адмін впише сам).
 */
export async function referenceFromCharacter(id: string, rules: GearRules): Promise<{ cls: CharClass; ref: DollRef; note: string | null }> {
  const rec = await getCharacter(id);
  const v = validateDoc(rec.doc);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) throw new Error('Документ персонажа пошкоджено.');
  await Promise.all([ensureRefData(), ensureCats(docCats(doc))]);
  const power = powerOf(doc, { pa: rules.dollScore.oppPa, pz: rules.dollScore.oppPz });
  const result = gearFromCharacter(doc, dollFacts(doc, rules), { setsFromDoll: false });
  const base = result.gear ? Math.round(tableGearPartWith(result.gear, rules, 3)) : 0;
  return {
    cls: CLS_CHAR[doc.cls],
    ref: { off: power.off, def: power.def, base, label: rec.name, ...(power.abil ? { abil: power.abil } : {}), wpa: power.wpa ?? 0 },
    note: result.gear ? null : `Анкета персонажа неповна (${result.missing.join(', ')}) — бали еталона впиши вручну.`,
  };
}
