// =========================================================
// ЛЯЛЬКА — анкета заявки з персонажа. Більшість полів лялька визначає сама:
// клас і рівень; збірку (ДД / гібрид / кон — за часткою очок у Тілобудові);
// точку зброї, точку броні (середня, округлена вгору), точку кілець R9R1;
// камені (поштучно, бали за клас каменя з каталогу); ПЗ-зброю й свап-сети
// (сет рахується, якщо показник у ньому досягає порогу і вищий, ніж у
// Головному) разом із каменями сетів. Гравець заповнює лише те, чого в
// каталозі немає: грейд зброї й сету броні, грейди кілець, трактат, джин,
// ШГ/Вознєс — це поля «Анкети для турнірів» у персонажі (doc.sheet).
// Згодом, коли скор рахуватиметься прямо з характеристик ляльки, ці грейди
// стануть непотрібні.
// =========================================================

import { deriveIb } from '../core/buffs';
import {
  ARMOR_REFINE_ORDER, ARMOR_SET_ORDER, BUILD_ORDER, GEMS_ORDER, GENIE_ORDER, RING_ORDER, SPECIAL_SET_ORDER,
  TRACT_ORDER, WEAPON_GRADE_ORDER, WEAPON_REFINE_ORDER, GEM_CLASS_ORDER, type GemClass, type GemCounts, type ScoringRules,
} from '../../data/gearRules';
import type { ArmorRefine, Build, CharClass, CharLevel, Gems, PlayerGear, SpecialSet, WeaponRefine } from '../../data/types';
import { ATTR_BASE, gemDop } from '../core/stats';
import type { Item } from '../core/types';
import { derivedNumbers, type DerivedNumbers } from '../core/derived';
import type { CharacterDoc, ClsKey, SlotKey } from './doc';
import { CFG_MAIN, effectiveSlots, hydrate, toDollState, type CharacterModel, type ItemLookup } from './hydrate';

/** Клас ляльки → клас сайту (підписи й порядок — як в анкеті турніру). */
export const CLS_CHAR: Record<ClsKey, CharClass> = {
  by: 'blademaster', ga: 'wizard', ya: 'barbarian', rl: 'venomancer', ij: 'cleric',
  js: 'archer', fx: 'assassin', sj: 'psychic', ej: 'seeker', rg: 'mystic',
};

/** Поля, які заповнює гравець (решту дає лялька). Старі чернетки могли мати й
 * інші ключі (точка, камені, збірка) — перевірка їх приймає, мапер ігнорує. */
export type SheetFields = Pick<
  PlayerGear,
  'weaponGrade' | 'armorSet' | 'tract' | 'genie' | 'shg' | 'shgRefine' | 'voznes' | 'voznesRefine' | 'ring1' | 'ring2'
>;
export type Sheet = Partial<SheetFields> & Partial<Pick<PlayerGear, 'build' | 'weaponRefine' | 'armorRefine' | 'gems' | 'ring1Refine' | 'ring2Refine' | 'specialSetGems'>>;

const REFINE_MAX = 12;
const enumOk = (order: readonly string[], v: unknown) => typeof v === 'string' && order.includes(v);
const refineOk = (v: unknown) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= REFINE_MAX);

/** Перевірка анкети в документі: лише відомі ключі й допустимі значення. Повертає список помилок. */
export function sheetErrors(raw: unknown): string[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['анкета має бути обʼєктом'];
  const s = raw as Record<string, unknown>;
  const errs: string[] = [];
  const en: Array<[string, readonly string[]]> = [
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

// ── Що лялька рахує сама ──────────────────────────────────────────

/** Броня з гніздами під камені — «камені основного сету» (6 речей × 4 = 24). */
const ARMOR_SLOTS: SlotKey[] = ['ft', 'rv', 'tg', 'rx', 'wy', 'mj'];
/** «Круг точки» — броня, біжа й кільця разом (зброя — окремо). */
const REFINE_SLOTS: SlotKey[] = ['ft', 'vx', 'rv', 'st', 'tg', 'rx', 'wy', 'mj', 'cr', 'cd'];

/** Клас каменя за каталогом: рівень (грейд hf) і що він дає в броні. */
export function gemClass(gem: Item): GemClass {
  const grade = Number(gem.hf) || 0;
  if (grade >= 13) {
    const dop = gemDop(gem, false)?.[0];
    if (dop === 'sx') return 'campPz';
    if (dop === 'ad') return 'topPa';
    return 'topOther';
  }
  if (grade === 12) return 'g12';
  if (grade === 11) return 'g11';
  if (grade === 10) return 'g10';
  return 'low';
}

/** Бали каменів у броні конфігурації (порожні слоти сету — як у Головному). */
function gemPointsOf(model: CharacterModel, cfgId: string, rules: ScoringRules): number {
  const slots = effectiveSlots(model, cfgId, { fillFromMain: true });
  let sum = 0;
  for (const slot of ARMOR_SLOTS) {
    const iid = slots[slot];
    const h = iid ? model.items.get(iid) : undefined;
    for (const g of h?.gems ?? []) if (g) sum += rules.doll.gemPoints[gemClass(g)];
  }
  return sum;
}

/** Склад каменів у броні конфігурації: скільки каменів кожного класу. */
function gemCountsOf(model: CharacterModel, cfgId: string): GemCounts {
  const slots = effectiveSlots(model, cfgId, { fillFromMain: true });
  const out: GemCounts = {};
  for (const slot of ARMOR_SLOTS) {
    const iid = slots[slot];
    const h = iid ? model.items.get(iid) : undefined;
    for (const g of h?.gems ?? []) if (g) out[gemClass(g)] = (out[gemClass(g)] ?? 0) + 1;
  }
  return out;
}

/** Бали каменів → найближчий знизу рядок таблиці «Камні» (без проміжних значень у базі). */
export function gemsBucket(points: number, rules: ScoringRules): Gems {
  let best: Gems = 'g0_9';
  for (const g of GEMS_ORDER) if (rules.gems[g] <= Math.round(points) && rules.gems[g] >= rules.gems[best]) best = g;
  return best;
}

/** Середня точка броні, біжі й кілець конфігурації (надіте), округлена вгору. */
function avgRefineOf(model: CharacterModel, cfgId: string): number | null {
  const slots = effectiveSlots(model, cfgId, { fillFromMain: true });
  const rs: number[] = [];
  for (const slot of REFINE_SLOTS) {
    const iid = slots[slot];
    const h = iid ? model.items.get(iid) : undefined;
    if (h?.item) rs.push(h.inst.r ?? 0);
  }
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null;
}

export function armorRefineBucket(avg: number): ArmorRefine {
  const n = Math.min(REFINE_MAX, Math.ceil(avg - 1e-9));
  return n <= 4 ? 'a0_4' : (`a${n}` as ArmorRefine);
}

export function weaponRefineBucket(r: number): WeaponRefine {
  if (r >= 12) return 'w12';
  if (r === 11) return 'w11';
  if (r === 10) return 'w10';
  if (r >= 8) return 'w8_9';
  if (r >= 6) return 'w6_7';
  return 'w0_5';
}

/** Збірка з атрибутів: частка вільних очок, вкладених у Тілобудову. */
export function buildOf(doc: CharacterDoc, rules: ScoringRules): Build {
  const { str, dex, vit, mag } = doc.attrs;
  const free = str + dex + vit + mag - 4 * ATTR_BASE;
  if (free <= 0) return 'dd';
  const share = (vit - ATTR_BASE) / free;
  if (share >= rules.doll.buildVit.con) return 'con';
  if (share >= rules.doll.buildVit.hybrid) return 'hybrid';
  return 'dd';
}

/** Що лялька знає сама. */
export interface DollFacts {
  build: Build;
  weaponPz: boolean;
  /** На скільки ПЗ більше з ПЗ-зброєю сету на Головному (0 — немає ПЗ-зброї). */
  weaponPzGain: number;
  specialSets: SpecialSet[];
  /** Камені кожного знайденого сету (з речей сету). */
  specialSetGems: Partial<Record<SpecialSet, Gems>>;
  weaponRefine: WeaponRefine | null;
  armorRefine: ArmorRefine | null;
  /** Середня точка до округлення (для підказки). */
  armorRefineAvg: number | null;
  gems: Gems;
  /** Склад каменів у броні (обсяг — як у gemPoints). */
  gemCounts: GemCounts;
  gemPoints: number;
  /** Точка кілець (для R9R1): cr — кільце 1, cd — кільце 2. */
  ring1Refine: number | null;
  ring2Refine: number | null;
  /** Показники з вікна персонажа (Головний, без бафів). */
  pa: number;
  pz: number;
}

/** Пороги свап-сетів — як у підказках анкети (SPECIAL_SET_HINTS). */
const PZ_MIN = 30;
const PA_MIN = 30;
const CHANNEL_MIN = 30;

const numsOf = (model: CharacterModel, cfgId: string): DerivedNumbers => {
  const b = toDollState(model, cfgId, { fillFromMain: true });
  return derivedNumbers(b, deriveIb(b)); // у стані лише пасивки класу
};
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Усе, що лялька визначає сама. Каталоги й довідники мають бути завантажені
 * (ensureCats/ensureRefData). Обсяг (Головний чи всі сети) — rules.doll.scope.
 */
export function dollFacts(doc: CharacterDoc, rules: ScoringRules, lookup?: ItemLookup): DollFacts {
  const model = hydrate(doc, lookup);
  const main = numsOf(model, CFG_MAIN);
  const kinds = new Set<SpecialSet>();
  const kindGems: Partial<Record<SpecialSet, number>> = {};
  let weaponPzGain = 0;
  for (const set of doc.sets) {
    const n = numsOf(model, set.id);
    const got: SpecialSet[] = [];
    if (n.pz >= PZ_MIN && n.pz > main.pz) got.push('pz');
    if (n.pa >= PA_MIN && n.pa > main.pa) got.push('pa');
    // Лише спів: окремого аспд-сету немає, швидкість атаки — це Головний.
    if (n.channel >= CHANNEL_MIN && n.channel > main.channel) got.push('aspd');
    if (got.length) {
      const pts = gemPointsOf(model, set.id, rules);
      // Кілька сетів одного виду — камені беремо з найкращого.
      for (const k of got) {
        kinds.add(k);
        kindGems[k] = Math.max(kindGems[k] ?? 0, pts);
      }
    }
    const ta = set.slots.ta;
    if (ta && ta !== doc.main.ta) {
      // Лише зброя з сету на Головному — щоб ПЗ-сет з іншою зброєю не рахувався двічі.
      // Скільки ПЗ дає заміна зброї — найбільше з усіх сетів.
      const probe: CharacterDoc = { ...doc, sets: [{ id: 'wpnprobe', name: 'w', kind: 'pz', slots: { ta } }] };
      weaponPzGain = Math.max(weaponPzGain, numsOf(hydrate(probe, lookup), 'wpnprobe').pz - main.pz);
    }
  }

  const cfgs = rules.doll.scope === 'all' ? [CFG_MAIN, ...doc.sets.map((s) => s.id)] : [CFG_MAIN];
  const refines = cfgs.map((c) => avgRefineOf(model, c)).filter((x): x is number => x != null);
  const armorRefineAvg = refines.length ? avg(refines) : null;
  const gemPoints = avg(cfgs.map((c) => gemPointsOf(model, c, rules)));
  // Склад каменів — у тому ж обсязі (для «усіх сетів» — середнє, округлене).
  const counts = cfgs.map((c) => gemCountsOf(model, c));
  const gemCounts: GemCounts = {};
  for (const k of GEM_CLASS_ORDER) {
    const v = Math.round(avg(counts.map((c) => c[k] ?? 0)));
    if (v > 0) gemCounts[k] = v;
  }
  const weapon = doc.main.ta ? model.items.get(doc.main.ta) : undefined;
  const ringR = (slot: 'cr' | 'cd') => {
    const iid = doc.main[slot];
    const h = iid ? model.items.get(iid) : undefined;
    return h?.item ? h.inst.r ?? 0 : null;
  };
  const specialSets = SPECIAL_SET_ORDER.filter((s) => kinds.has(s));
  const specialSetGems: Partial<Record<SpecialSet, Gems>> = {};
  for (const k of specialSets) specialSetGems[k] = gemsBucket(kindGems[k] ?? 0, rules);

  return {
    build: buildOf(doc, rules),
    weaponPz: weaponPzGain > 0,
    weaponPzGain: Math.max(0, weaponPzGain),
    specialSets,
    specialSetGems,
    weaponRefine: weapon?.item ? weaponRefineBucket(weapon.inst.r ?? 0) : null,
    armorRefine: armorRefineAvg == null ? null : armorRefineBucket(armorRefineAvg),
    armorRefineAvg,
    gems: gemsBucket(gemPoints, rules),
    gemPoints,
    gemCounts,
    ring1Refine: ringR('cr'),
    ring2Refine: ringR('cd'),
    pa: main.pa,
    pz: main.pz,
  };
}

const SHEET_LABELS: Record<string, string> = {
  weaponGrade: 'грейд зброї', armorSet: 'сет броні', tract: 'трактат', genie: 'джин', ring1: 'кільце 1', ring2: 'кільце 2',
};

export interface CharacterGear {
  /** Повна анкета для заявки; null — бракує полів (missing). */
  gear: PlayerGear | null;
  /** Чого бракує — простими словами. */
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
  for (const k of ['weaponGrade', 'armorSet', 'tract', 'genie', 'ring1', 'ring2'] as const) {
    if (s[k] == null) missing.push(SHEET_LABELS[k]);
  }
  if (s.shg && s.shgRefine == null) missing.push('точка ШГ');
  if (s.voznes && s.voznesRefine == null) missing.push('точка Вознєса');
  if (!facts.weaponRefine) missing.push('зброя на ляльці');
  if (!facts.armorRefine) missing.push('броня на ляльці');
  if (s.ring1 && s.ring1 !== 'moon' && facts.ring1Refine == null) missing.push('кільце 1 на ляльці');
  if (s.ring2 && s.ring2 !== 'moon' && facts.ring2Refine == null) missing.push('кільце 2 на ляльці');
  const sets = opts.setsFromDoll ? facts.specialSets : [];
  const base = { attackLevel: Math.round(facts.pa), defenseLevel: Math.round(facts.pz), facts };
  if (missing.length) return { gear: null, missing, ...base };
  const setGems: Partial<Record<SpecialSet, Gems>> = {};
  for (const k of sets) setGems[k] = facts.specialSetGems[k] ?? 'g0_9';
  const gear: PlayerGear = {
    charClass: CLS_CHAR[doc.cls],
    charLevel: charLevelOf(doc.level),
    build: facts.build,
    weaponGrade: s.weaponGrade!,
    weaponRefine: facts.weaponRefine!,
    weaponPz: facts.weaponPz,
    armorSet: s.armorSet!,
    armorRefine: facts.armorRefine!,
    gems: facts.gems,
    specialSets: sets,
    specialSetGems: setGems,
    tract: s.tract!,
    genie: s.genie!,
    shg: !!s.shg,
    shgRefine: s.shg ? s.shgRefine ?? 0 : null,
    voznes: !!s.voznes,
    voznesRefine: s.voznes ? s.voznesRefine ?? 0 : null,
    ring1: s.ring1!,
    ring1Refine: s.ring1 === 'r9r1' ? facts.ring1Refine ?? 0 : null,
    ring2: s.ring2!,
    ring2Refine: s.ring2 === 'r9r1' ? facts.ring2Refine ?? 0 : null,
  };
  return { gear, missing: [], ...base };
}

/** Анкета → поля для GearFields: те, що дає лялька, підставлено (їх не редагують). */
export function sheetAsGear(doc: CharacterDoc, facts: DollFacts | null): Partial<PlayerGear> {
  const s = doc.sheet ?? {};
  return {
    weaponGrade: s.weaponGrade, armorSet: s.armorSet, tract: s.tract, genie: s.genie,
    shg: s.shg, shgRefine: s.shgRefine, voznes: s.voznes, voznesRefine: s.voznesRefine, ring1: s.ring1, ring2: s.ring2,
    charClass: CLS_CHAR[doc.cls],
    charLevel: charLevelOf(doc.level),
    build: facts?.build,
    weaponRefine: facts?.weaponRefine ?? undefined,
    armorRefine: facts?.armorRefine ?? undefined,
    gems: facts?.gems,
    weaponPz: facts?.weaponPz ?? false,
    specialSets: facts?.specialSets ?? [],
    specialSetGems: facts?.specialSetGems ?? {},
    ring1Refine: facts?.ring1Refine ?? null,
    ring2Refine: facts?.ring2Refine ?? null,
  };
}

/** Зміна з GearFields → лише поля, які заповнює гравець. */
export function sheetFromGear(g: Partial<PlayerGear>): Sheet {
  const out: Sheet = {};
  const keys: Array<keyof SheetFields> = ['weaponGrade', 'armorSet', 'tract', 'genie', 'shg', 'shgRefine', 'voznes', 'voznesRefine', 'ring1', 'ring2'];
  for (const k of keys) {
    const v = g[k];
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
