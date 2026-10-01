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
// =========================================================

import { classPointsFor, currentRulesVersion, hasRulesVersion, rulesFor } from '../data/gearRules';
import { loadRulesFromDb } from '../data/rulesStore';
import type { DollPower, ItemBreakdown } from '../data/types';
import { getCharacter, listCharacters, type CharacterRecord, type CharacterSummary } from './api/characters';
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
    rec, doc, result, power, rulesVersion, items,
    itemPoints: items.itemPoints, itemBreakdown: breakdown, blockReason: submitBlockReason(result.missing),
  };
}
