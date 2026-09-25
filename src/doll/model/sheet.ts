// =========================================================
// ЛЯЛЬКА — анкета для турнірів. Грейди речей (Нірвана / R8R / ЦГД / R9…,
// кільця, камені) у каталозі не позначені, тож ці поля гравець заповнює
// сам один раз — у персонажі, і вони їдуть у кожну заявку. Решту бере
// лялька: клас і рівень, ПЗ-зброю й свап-сети (з характеристик: сет
// рахується, якщо в ньому показник досягає порогу і вищий, ніж у Головному).
// Згодом, коли з'явиться таблиця грейдів речей, частина полів анкети
// заповнюватиметься з ляльки автоматично.
// =========================================================

import {
  ARMOR_REFINE_ORDER, ARMOR_SET_ORDER, BUILD_ORDER, GEMS_ORDER, GENIE_ORDER, RING_ORDER, SPECIAL_SET_ORDER,
  TRACT_ORDER, WEAPON_GRADE_ORDER, WEAPON_REFINE_ORDER,
} from '../../data/gearRules';
import type { CharClass, CharLevel, Gems, PlayerGear, SpecialSet } from '../../data/types';
import { derivedNumbers, type DerivedNumbers } from '../core/derived';
import type { CharacterDoc, ClsKey } from './doc';
import { CFG_MAIN, hydrate, toDollState, type CharacterModel, type ItemLookup } from './hydrate';

/** Клас ляльки → клас сайту (підписи й порядок — як в анкеті турніру). */
export const CLS_CHAR: Record<ClsKey, CharClass> = {
  by: 'blademaster', ga: 'wizard', ya: 'barbarian', rl: 'venomancer', ij: 'cleric',
  js: 'archer', fx: 'assassin', sj: 'psychic', ej: 'seeker', rg: 'mystic',
};

/** Поля, які заповнює гравець (решту дає лялька). */
export type SheetFields = Pick<
  PlayerGear,
  | 'build' | 'weaponGrade' | 'weaponRefine' | 'armorSet' | 'armorRefine' | 'gems' | 'tract' | 'genie'
  | 'shg' | 'shgRefine' | 'voznes' | 'voznesRefine' | 'ring1' | 'ring1Refine' | 'ring2' | 'ring2Refine' | 'specialSetGems'
>;
export type Sheet = Partial<SheetFields>;

const REFINE_MAX = 12;
const enumOk = (order: readonly string[], v: unknown) => typeof v === 'string' && order.includes(v);
const refineOk = (v: unknown) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= REFINE_MAX);

/** Перевірка анкети в документі: лише відомі ключі й допустимі значення. Повертає список помилок. */
export function sheetErrors(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['анкета має бути обʼєктом'];
  const s = raw as Record<string, unknown>;
  const errs: string[] = [];
  const en: Array<[keyof SheetFields, readonly string[]]> = [
    ['build', BUILD_ORDER], ['weaponGrade', WEAPON_GRADE_ORDER], ['weaponRefine', WEAPON_REFINE_ORDER], ['armorSet', ARMOR_SET_ORDER],
    ['armorRefine', ARMOR_REFINE_ORDER], ['gems', GEMS_ORDER], ['tract', TRACT_ORDER], ['genie', GENIE_ORDER],
  ];
  const known = new Set<string>(['shg', 'shgRefine', 'voznes', 'voznesRefine', 'ring1', 'ring1Refine', 'ring2', 'ring2Refine', 'specialSetGems', ...en.map(([k]) => k)]);
  for (const k of Object.keys(s)) if (!known.has(k)) errs.push(`анкета: невідоме поле «${k}»`);
  for (const [k, order] of en) if (s[k] != null && !enumOk(order, s[k])) errs.push(`анкета: некоректне значення «${k}»`);
  for (const k of ['shg', 'voznes']) if (s[k] != null && typeof s[k] !== 'boolean') errs.push(`анкета: «${k}» має бути так/ні`);
  for (const k of ['ring1', 'ring2']) if (s[k] != null && !enumOk(RING_ORDER, s[k])) errs.push(`анкета: некоректне кільце «${k}»`);
  for (const k of ['shgRefine', 'voznesRefine', 'ring1Refine', 'ring2Refine']) if (s[k] !== undefined && !refineOk(s[k])) errs.push(`анкета: точка «${k}» — від 0 до ${REFINE_MAX}`);
  if (s.specialSetGems !== undefined) {
    const g = s.specialSetGems;
    if (!g || typeof g !== 'object' || Array.isArray(g)) errs.push('анкета: камені сетів мають бути обʼєктом');
    else
      for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
        if (!enumOk(SPECIAL_SET_ORDER, k) || !enumOk(GEMS_ORDER, v)) errs.push(`анкета: камені сету «${k}» некоректні`);
      }
  }
  return errs;
}

export function charLevelOf(level: number): CharLevel {
  if (level >= 105) return 'l105';
  if (level >= 101) return (`l${level}` as CharLevel);
  return 'l90_100';
}

/** Що лялька знає сама: ПЗ-зброя, свап-сети, показники атаки й захисту Головного. */
export interface DollFacts {
  weaponPz: boolean;
  specialSets: SpecialSet[];
  /** Показники з вікна персонажа (Головний, без бафів). */
  pa: number;
  pz: number;
}

/** Пороги свап-сетів — як у підказках анкети (SPECIAL_SET_HINTS). */
const PZ_MIN = 30;
const PA_MIN = 30;
const APS_MIN = 3.33;
const CHANNEL_MIN = 30;

const numsOf = (model: CharacterModel, cfgId: string): DerivedNumbers => derivedNumbers(toDollState(model, cfgId, { fillFromMain: true }));

/**
 * Вид сету — за тим, що він реально дає: у сеті (порожні слоти — як у
 * Головному) показник досягає порогу і вищий, ніж у Головному. ПЗ-зброя —
 * інша зброя в сеті, з якою (лише її замінивши) ПЗ Головного зростає.
 * Каталоги й довідники мають бути завантажені (ensureCats/ensureRefData).
 */
export function dollFacts(doc: CharacterDoc, lookup?: ItemLookup): DollFacts {
  const model = hydrate(doc, lookup);
  const main = numsOf(model, CFG_MAIN);
  const kinds = new Set<SpecialSet>();
  let weaponPz = false;
  for (const set of doc.sets) {
    const n = numsOf(model, set.id);
    if (n.pz >= PZ_MIN && n.pz > main.pz) kinds.add('pz');
    if (n.pa >= PA_MIN && n.pa > main.pa) kinds.add('pa');
    if ((n.aps >= APS_MIN && n.aps > main.aps) || (n.channel >= CHANNEL_MIN && n.channel > main.channel)) kinds.add('aspd');
    const ta = set.slots.ta;
    if (!weaponPz && ta && ta !== doc.main.ta) {
      // Лише зброя з сету на Головному — щоб ПЗ-сет з іншою зброєю не рахувався двічі.
      const probe: CharacterDoc = { ...doc, sets: [{ id: 'wpnprobe', name: 'w', kind: 'pz', slots: { ta } }] };
      if (numsOf(hydrate(probe, lookup), 'wpnprobe').pz > main.pz) weaponPz = true;
    }
  }
  return { weaponPz, specialSets: SPECIAL_SET_ORDER.filter((s) => kinds.has(s)), pa: main.pa, pz: main.pz };
}

const SHEET_LABELS: Record<string, string> = {
  build: 'збірка', weaponGrade: 'зброя', weaponRefine: 'заточка зброї', armorSet: 'сет броні', armorRefine: 'круг точки',
  gems: 'камені', tract: 'трактат', genie: 'джин', ring1: 'кільце 1', ring2: 'кільце 2',
};

export interface CharacterGear {
  /** Повна анкета для заявки; null — у персонажі бракує полів (missing). */
  gear: PlayerGear | null;
  /** Чого бракує в анкеті персонажа — простими словами. */
  missing: string[];
  attackLevel: number;
  defenseLevel: number;
  facts: DollFacts;
}

/**
 * Анкета заявки з персонажа. setsFromDoll — чи рахувати свап-сети з ляльки
 * (перемикач у «Шкалі балів»); вимкнено — сети в заявку не йдуть, як і в
 * публічній анкеті, ПЗ-зброя — завжди з ляльки.
 */
export function gearFromCharacter(doc: CharacterDoc, facts: DollFacts, opts: { setsFromDoll: boolean }): CharacterGear {
  const s: Sheet = doc.sheet ?? {};
  const missing: string[] = [];
  for (const k of ['build', 'weaponGrade', 'weaponRefine', 'armorSet', 'armorRefine', 'gems', 'tract', 'genie', 'ring1', 'ring2'] as const) {
    if (s[k] == null) missing.push(SHEET_LABELS[k]);
  }
  if (s.shg && s.shgRefine == null) missing.push('точка ШГ');
  if (s.voznes && s.voznesRefine == null) missing.push('точка Вознєса');
  if (s.ring1 === 'r9r1' && s.ring1Refine == null) missing.push('точка кільця 1');
  if (s.ring2 === 'r9r1' && s.ring2Refine == null) missing.push('точка кільця 2');
  const sets = opts.setsFromDoll ? facts.specialSets : [];
  const setGems: Partial<Record<SpecialSet, Gems>> = {};
  for (const k of sets) {
    const g = s.specialSetGems?.[k];
    if (g) setGems[k] = g;
    else missing.push(`камені сету «${k === 'pz' ? 'ПЗ' : k === 'pa' ? 'ПА' : 'Спів / Аспд'}»`);
  }
  const base = { attackLevel: Math.round(facts.pa), defenseLevel: Math.round(facts.pz), facts };
  if (missing.length) return { gear: null, missing, ...base };
  const gear: PlayerGear = {
    charClass: CLS_CHAR[doc.cls],
    charLevel: charLevelOf(doc.level),
    build: s.build!,
    weaponGrade: s.weaponGrade!,
    weaponRefine: s.weaponRefine!,
    weaponPz: facts.weaponPz,
    armorSet: s.armorSet!,
    armorRefine: s.armorRefine!,
    gems: s.gems!,
    specialSets: sets,
    specialSetGems: setGems,
    tract: s.tract!,
    genie: s.genie!,
    shg: !!s.shg,
    shgRefine: s.shg ? s.shgRefine ?? 0 : null,
    voznes: !!s.voznes,
    voznesRefine: s.voznes ? s.voznesRefine ?? 0 : null,
    ring1: s.ring1!,
    ring1Refine: s.ring1 === 'r9r1' ? s.ring1Refine ?? 0 : null,
    ring2: s.ring2!,
    ring2Refine: s.ring2 === 'r9r1' ? s.ring2Refine ?? 0 : null,
  };
  return { gear, missing: [], ...base };
}

/** Анкета → поля анкети сайту для GearFields (клас і рівень — з ляльки). */
export function sheetAsGear(doc: CharacterDoc, facts: DollFacts | null): Partial<PlayerGear> {
  return {
    ...(doc.sheet ?? {}),
    charClass: CLS_CHAR[doc.cls],
    charLevel: charLevelOf(doc.level),
    weaponPz: facts?.weaponPz ?? false,
    specialSets: facts?.specialSets ?? [],
    specialSetGems: doc.sheet?.specialSetGems ?? {},
  };
}

/** Зміна з GearFields → лише поля анкети (клас, рівень, ПЗ-зброя, сети — з ляльки, не зберігаємо). */
export function sheetFromGear(g: Partial<PlayerGear>): Sheet {
  const out: Sheet = {};
  const keys: Array<keyof SheetFields> = [
    'build', 'weaponGrade', 'weaponRefine', 'armorSet', 'armorRefine', 'gems', 'tract', 'genie',
    'shg', 'shgRefine', 'voznes', 'voznesRefine', 'ring1', 'ring1Refine', 'ring2', 'ring2Refine', 'specialSetGems',
  ];
  for (const k of keys) {
    const v = g[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
