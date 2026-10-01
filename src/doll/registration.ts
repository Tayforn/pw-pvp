// =========================================================
// ЛЯЛЬКА — заявка на турнір персонажем. Форма заявки (RegisterPage) у
// головному бандлі, а ляльці потрібні каталоги й формули — тож цей модуль
// вантажиться динамічно (import()), лише коли гравець обрав персонажа.
//
// Скор v2: разом із legacy-колонками заявки (gearFromCharacter — грейди лялька
// визначає з надітих речей, джин — з блоку джина) заявка несе itemPoints і
// itemBreakdown — бали за речі ляльки за версією шкали турніру
// (model/itemScore.ts). Скор заявки = клас + itemPoints + рівень + джин
// (registrationScore у gearRules.ts); адмін перераховує зі знімка. Ручної
// анкети немає: заявку блокують лише відсутня зброя й порожній слот броні.
// Гість без Discord-ролі подається чернеткою цього браузера (draftForRegistration) —
// той самий розрахунок, лише документ не з профілю, а з локального сховища.
// =========================================================

import { classPointsFor, currentRulesVersion, hasRulesVersion, rulesFor } from '../data/gearRules';
import { loadRulesFromDb } from '../data/rulesStore';
import type { DollPower, ItemBreakdown } from '../data/types';
import { getCharacter, listCharacters, type CharacterRecord, type CharacterSummary } from './api/characters';
import { browserStorage, draftKey, loadDraft, type DraftStorage } from './api/draft';
import { ensureCats } from './data/catalog';
import { ensureRefData } from './data/refLoader';
import { validateDoc, type CharacterDoc } from './model/doc';
import { docCats } from './model/hydrate';
import { itemBreakdown, scoreItems, type ItemScore } from './model/itemScore';
import { POWER_OPPONENT, powerOf } from './model/power';
import { PREVIEW_TEAM_SIZE } from './model/readiness';
import { CLS_CHAR, charLevelOf, dollFacts, gearFromCharacter, genieOf, type CharacterGear } from './model/sheet';

export type { CharacterSummary };

export interface CharacterForRegistration {
  /** saved — збережений персонаж (вхід через Discord); draft — чернетка цього браузера (гість). */
  source: 'saved' | 'draft';
  /** Для чернетки — запис-замінник: id 'new' (сторінка /characters/new), ревізія 0. */
  rec: CharacterRecord;
  doc: CharacterDoc;
  result: CharacterGear;
  /** Атака й живучість ляльки + склад каменів і абілка — doll_power заявки:
   * довідка для адміна (попап гравця), у скор не входить. */
  power: DollPower;
  /** Версія шкали, якою рахували скор v2: закріплена за турніром, інакше поточна. */
  rulesVersion: string;
  /** Скор v2 «від речей» з назвами речей (для розкладу у формі). */
  items: ItemScore;
  /** Те, що піде в item_points / item_breakdown заявки. */
  itemPoints: number;
  itemBreakdown: ItemBreakdown;
  /** Чому заявку не подати (немає зброї, порожній слот броні); null — можна. */
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

/**
 * «Заявку не подати: у персонажа немає зброї; у Головному порожній слот броні:
 * нагрудник.» — з missing ляльки (dollMissing у sheet.ts: «зброя», «порожній
 * слот броні: …»); null — усе є.
 */
export function submitBlockReason(missing: readonly string[]): string | null {
  if (!missing.length) return null;
  const parts = missing.map((m) => (m === 'зброя' ? 'у персонажа немає зброї (ні в Головному, ні в сеті)' : `у Головному ${m}`));
  return `Заявку не подати: ${parts.join('; ')}.`;
}

/** Завантажити персонажа й зібрати з нього legacy-анкету заявки й скор v2. Кидає Error з поясненням. */
export async function characterForRegistration(id: string, opts: RegistrationOptions = {}): Promise<CharacterForRegistration> {
  const rec = await getCharacter(id);
  const v = validateDoc(rec.doc);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) throw new Error('Документ персонажа пошкоджено — відкрий його на сторінці персонажа й збережи ще раз.');
  return fromDoc('saved', rec, doc, opts);
}

// ── Чернетка цього браузера (гість без Discord-ролі) ──────────────────
// Гравець без ролі в Discord зберегти персонажа в профіль не може, тож на
// фул-рандом подається персонажем-чернеткою з /characters/new (локальне сховище
// браузера, api/draft.ts). Знімок чернетки йде в заявку так само, як знімок
// збереженого персонажа; character_id заявки — null.

/** id чернетки в адресі сторінки персонажа (/characters/new) і у виборі персонажа на заявці. */
export const DRAFT_ID = 'new';

/** Коротко про чернетку для вибору персонажа; null — чернетки немає, вона порожня чи зламана. */
export function draftCharacter(storage: DraftStorage | null = browserStorage()): CharacterSummary | null {
  const got = loadDraft(draftKey('anon', DRAFT_ID), storage);
  const d = got.doc;
  if (!d || (!d.name && d.items.length === 0 && d.sets.length === 0)) return null;
  return { id: DRAFT_ID, name: d.name, cls: d.cls, level: d.level, revision: 0, updatedAt: '', items: d.items.length, sets: d.sets.length };
}

/** Як characterForRegistration, але з чернетки цього браузера. Кидає Error з поясненням. */
export async function draftForRegistration(opts: RegistrationOptions = {}, storage: DraftStorage | null = browserStorage()): Promise<CharacterForRegistration> {
  const got = loadDraft(draftKey('anon', DRAFT_ID), storage);
  if (!got.doc) {
    throw new Error(got.error ? 'Чернетку персонажа пошкоджено (' + got.error + ') — відкрий сторінку «Персонаж» і збери його заново.' : 'У цьому браузері немає чернетки персонажа — створи її на сторінці «Персонаж».');
  }
  const doc = got.doc;
  const rec: CharacterRecord = { id: DRAFT_ID, name: doc.name, cls: doc.cls, level: doc.level, revision: 0, updatedAt: '', doc };
  return fromDoc('draft', rec, doc, opts);
}

async function fromDoc(source: 'saved' | 'draft', rec: CharacterRecord, doc: CharacterDoc, opts: RegistrationOptions): Promise<CharacterForRegistration> {
  // Версії шкали з бази — щоб версія турніру знайшлась (main.tsx їх уже вантажить; тут — гарантія).
  await Promise.all([ensureRefData(), ensureCats(docCats(doc)), loadRulesFromDb()]);
  const rulesVersion = opts.rulesVersion && hasRulesVersion(opts.rulesVersion) ? opts.rulesVersion : currentRulesVersion();
  const rules = rulesFor(rulesVersion);
  const facts = dollFacts(doc, rules);
  // Legacy-колонки заявки: сети з ляльки — лише якщо так каже версія шкали (у нових — ні, їх рахує скор v2).
  const result = gearFromCharacter(doc, facts, { setsFromDoll: rules.setsFromDoll });
  // Разом із силою в заявку йде склад каменів — адмін бачить його замість рядка таблиці.
  const power = {
    ...powerOf(doc, POWER_OPPONENT),
    gems: facts.gemCounts,
    ...(facts.weaponPzGain > 0 ? { pzw: Math.round(facts.weaponPzGain * 10) / 10 } : {}),
  };
  // Скор v2: бали за речі + розклад із класом (за розміром команди), рівнем і джином —
  // ті самі складові, що registrationScore бере з legacy-колонок, тож sum сходиться зі скором.
  const items = scoreItems(doc, rules);
  const teamSize = opts.teamSize ?? PREVIEW_TEAM_SIZE;
  const genie = genieOf(doc) ?? 'g60';
  const breakdown = itemBreakdown(items, rulesVersion, {
    cls: classPointsFor(rules, CLS_CHAR[doc.cls], teamSize),
    lvl: rules.level[charLevelOf(doc.level)],
    genie: rules.genie[genie],
  });
  return {
    source, rec, doc, result, power, rulesVersion, items,
    itemPoints: items.itemPoints, itemBreakdown: breakdown, blockReason: submitBlockReason(result.missing),
  };
}
