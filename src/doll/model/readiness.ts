// =========================================================
// ЛЯЛЬКА — готовність персонажа до турніру (права колонка сторінки):
//  • vitShare — частка розданих очок у Тілобудові (шкала збірки в «Атрибутах»);
//  • dollScorePreview — попередній скор з ляльки прямо з документа в руках,
//    синхронно й так само, як його збере заявка (registration.ts): сила
//    Головного без бафів + склад каменів + ПЗ-зброя, еталон класу, бали й тир;
//  • readinessIssues — що ще не заповнено (без цього немає «Усе заповнено»:
//    зокрема анкета для турнірів, поки заявка бере грейди з неї) і на що
//    звернути увагу (не блокує: порожні необовʼязкові слоти, джин, старі галочки).
// Каталоги й довідники мають бути завантажені — як для dollFacts і powerOf.
// Сторінка персонажа не знає турніру, тож бали класу — для команди 3×3, як в
// еталонах; корекції адміна й Ело тут немає — це попередній скор.
// =========================================================

import { SLOTS } from '../core/constants';
import { computeActiveSlots } from '../core/stats';
import type { Item } from '../core/types';
import {
  dollGearScoreWith, tierForWith, type DollRef, type DollScoreMode, type ScoringRules,
} from '../../data/gearRules';
import { clsBit, genieWarnings } from '../../data/genie';
import type { DollPower, PlayerGear, SpecialSet, Gems, Tier } from '../../data/types';
import { attrPointsLeft, SET_SLOT_KEYS, SLOT_KEYS, type CharacterDoc, type SlotKey } from './doc';
import { CFG_MAIN, toDollState, type CharacterModel, type ItemLookup } from './hydrate';
import { PATH_LEVEL } from './passives';
import { powerOf } from './power';
import { CLS_CHAR, charLevelOf, gearFromCharacter, genieOf, vitShare, type DollFacts } from './sheet';

export { vitShare };

/** Розмір команди для балів класу на сторінці персонажа — 3×3, як в еталонах шкали. */
export const PREVIEW_TEAM_SIZE = 3;

/** Анкета заявки з того, що лялька визначила сама (грейди з речей; джин — як у
 * заявці зараз: анкета, інакше блок джина за удачею, інакше «до 60»). Для скору
 * з ляльки з неї потрібні лише клас, збірка, джин, ШГ/Вознєс і запасне; решта —
 * для підсумку. */
export function gearFromFacts(doc: CharacterDoc, facts: DollFacts, setsFromDoll: boolean): PlayerGear {
  const sets: SpecialSet[] = setsFromDoll ? facts.specialSets : [];
  const setGems: Partial<Record<SpecialSet, Gems>> = {};
  for (const k of sets) setGems[k] = facts.specialSetGems[k] ?? 'g0_9';
  return {
    charClass: CLS_CHAR[doc.cls],
    charLevel: charLevelOf(doc.level),
    build: facts.build,
    weaponGrade: facts.weaponGrade ?? 'other',
    weaponRefine: facts.weaponRefine ?? 'w0_5',
    weaponPz: facts.weaponPz,
    armorSet: facts.armorSet,
    armorRefine: facts.armorRefine ?? 'a0_4',
    gems: facts.gems,
    specialSets: sets,
    specialSetGems: setGems,
    tract: facts.tract,
    // Джин — тим самим шляхом, що й заявка зараз (gearFromCharacter): з анкети, без неї — з
    // блоку джина за удачею (genieOf). Коли заявка перейде на doc.genie (крок D), джерелом
    // стане лише genieOf(doc).
    genie: doc.sheet?.genie ?? genieOf(doc) ?? 'g60',
    shg: facts.shgRefine != null,
    shgRefine: facts.shgRefine,
    voznes: facts.voznesRefine != null,
    voznesRefine: facts.voznesRefine,
    ring1: facts.ring1,
    ring1Refine: facts.ring1 === 'r9r1' ? facts.ring1Refine ?? 0 : null,
    ring2: facts.ring2,
    ring2Refine: facts.ring2 === 'r9r1' ? facts.ring2Refine ?? 0 : null,
  };
}

export interface ScorePreview {
  /** Режим скору з ляльки у версії шкали: off — число не показуємо, shadow —
   * попереднє (у жеребці поки таблиця), on — так рахує жеребка. */
  mode: DollScoreMode;
  /** Сила Головного без бафів — як піде в заявку (з каменями і ПЗ-зброєю). */
  power: DollPower | null;
  /** Еталон класу у версії шкали; null — еталона ще немає (вбудована шкала). */
  ref: DollRef | null;
  /** Атака й живучість відносно еталона (1 — як еталон); null — немає еталона. */
  offMult: number | null;
  defMult: number | null;
  /** Скор спорядження з ляльки; null — немає еталона або сили. */
  score: number | null;
  tier: Tier | null;
  /** Анкета з ляльки — для рядка «що визначила лялька» (gearSummary / gearParts). */
  gear: PlayerGear | null;
}

const ratio = (a: number, b: number | undefined): number | null => {
  if (!b || !(b > 0)) return null;
  const r = a / b;
  return Number.isFinite(r) && r > 0 ? r : null;
};

/**
 * Попередній скор з ляльки для персонажа в редакторі. Рахує Головний без бафів
 * (пасивки класу входять), бали класу — для teamSize. Жодного NaN: чого не можна
 * порахувати, те null.
 */
export function dollScorePreview(
  doc: CharacterDoc,
  facts: DollFacts,
  rules: ScoringRules,
  teamSize: number = PREVIEW_TEAM_SIZE,
  lookup?: ItemLookup,
): ScorePreview {
  const ds = rules.dollScore;
  const gear = gearFromFacts(doc, facts, rules.setsFromDoll);
  // Так само, як у заявці (registration.ts): сила + склад каменів + ПЗ-зброя сету.
  const raw = powerOf(doc, { pa: ds.oppPa, pz: ds.oppPz }, lookup);
  const power: DollPower | null =
    Number.isFinite(raw.off) && Number.isFinite(raw.def)
      ? { ...raw, gems: facts.gemCounts, ...(facts.weaponPzGain > 0 ? { pzw: Math.round(facts.weaponPzGain * 10) / 10 } : {}) }
      : null;
  const ref = ds.refs[gear.charClass] ?? null;
  const offMult = power && ref ? ratio(power.off, ref.off) : null;
  const defMult = power && ref ? ratio(power.def, ref.def) : null;
  const s = power && ref ? dollGearScoreWith(gear, power, rules, teamSize) : null;
  const score = s != null && Number.isFinite(s) ? s : null;
  return { mode: ds.mode, power, ref, offMult, defMult, score, tier: score == null ? null : tierForWith(score, rules), gear };
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

/** Слоти броні Головного, без яких заявку не подати (ті самі 4, що дають сет броні в sheet.ts). */
const ARMOR_SLOTS: SlotKey[] = ['rv', 'tg', 'rx', 'mj'];
/** Решта слотів речей: порожній — лише нагадування (бали за них є, але заявку не блокують). */
const OPTIONAL_SLOTS: SlotKey[] = ['ft', 'wy', 'vx', 'st', 'cr', 'cd'];
const SLOT_NAME: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.slot, s.label.toLowerCase()]));
/** «зброя / броня на ляльці» з gearFromCharacter — те саме, що блокери зброї й порожніх слотів тут; не дублюємо. */
const DOLL_MISSING_DUP = new Set(['зброя на ляльці', 'броня на ляльці']);

/** «порожній слот: нагрудник» / «порожні слоти: шолом, накидка» — за незаповненими слотами Головного; '' — усі заповнені. */
function emptySlots(doc: CharacterDoc, slots: readonly SlotKey[]): string {
  const names = slots.filter((s) => !doc.main[s]).map((s) => SLOT_NAME[s] ?? s);
  if (!names.length) return '';
  return (names.length === 1 ? 'порожній слот: ' : 'порожні слоти: ') + names.join(', ');
}

/**
 * Що не так з персонажем для турніру. blockers — те, без чого плашка не стане
 * «Усе заповнено»: імʼя, нероздані (чи зайві) очки, шлях з 89 рівня, речі, що не
 * вдягаються, немає зброї, порожній слот броні, незаповнена анкета для турнірів.
 * notes — жовті нагадування: порожні необовʼязкові слоти, джина не заповнено,
 * попередження джина, старі галочки ШГ/Вознєс.
 */
export function readinessIssues(doc: CharacterDoc, model: CharacterModel, facts: DollFacts, rules: ScoringRules): ReadinessIssues {
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
  if (!facts.weaponRefine) blockers.push('зброя в Головному');
  // Броня — за порожніми слотами rv/tg/rx/mj Головного, а не за facts.armorRefine: та середня
  // бачить і намисто з поясом, тож лялька без броні, але з намистом мала б «броню».
  const armorEmpty = emptySlots(doc, ARMOR_SLOTS);
  if (armorEmpty) blockers.push(armorEmpty);
  // Заявка поки бере грейди й джина з анкети (gearFromCharacter у sheet.ts) — доки анкету не
  // заповнено, заявку не подати, і картка не має казати «готовий». Зброю й броню на ляльці
  // вже названо вище — не дублюємо.
  const sheetMissing = gearFromCharacter(doc, facts, { setsFromDoll: rules.setsFromDoll }).missing.filter((m) => !DOLL_MISSING_DUP.has(m));
  if (sheetMissing.length) blockers.push('анкета для турнірів: бракує ' + sheetMissing.join(', '));

  const notes: string[] = [];
  const optionalEmpty = emptySlots(doc, OPTIONAL_SLOTS);
  if (optionalEmpty) notes.push(optionalEmpty);
  if (genieOf(doc) == null) notes.push('джина не заповнено — за нього 0 балів');
  if (doc.genie) notes.push(...genieWarnings(doc.genie, clsBit(doc.cls)).map((w) => 'джин: ' + w));
  // TODO: показувати facts.gradeNotes («лялька не розпізнала … — зараховано як …»), коли заявка
  // перейде на грейди з речей: зараз у заявку йдуть грейди з анкети, і «зараховано як» — неправда.
  // Стара анкета мала галочки «Є ШГ / Є Вознєс»; тепер ШГ і Вознєс лялька бачить лише на речах.
  if (doc.sheet?.shg && facts.shgRefine == null) notes.push('в анкеті стояла галочка ШГ, але «Шлема героя» на ляльці немає — заявка піде без нього');
  if (doc.sheet?.voznes && facts.voznesRefine == null) notes.push('в анкеті стояла галочка Вознєс, але «Плаща вознесения» на ляльці немає — заявка піде без нього');
  return { blockers, notes };
}
