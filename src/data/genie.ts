// =========================================================
// Джин: чисті правила. Таблиця вмінь — згенерований genieSkills.ts (дані PW
// Хелпера), формули — порт pw-calc src/lib/genieCalc.ts (калькулятор
// спорідненості стихій). Модуль не імпортує нічого з src/doll: його бере й
// головний бандл (попап гравця на сторінці турніру), а важкий чанк ляльки
// він тягнути не має.
//
// Бали шкали за джина — ЗА УДАЧЕЮ (рішення власника): genieBucket(genieScoreLuck).
// Порушення ігрових правил (замалий рівень чи удача, чуже для класу вміння)
// документ персонажа не ламають — їх лише показують genieWarnings і whyBlocked.
// =========================================================

import { GENIE_SKILL_ROWS } from './genieSkills';
import type { Genie } from './types';

/** Джин у документі персонажа (doc.genie) і в знімку заявки. */
export interface GenieCfg {
  level: number; // 1..105, ціле
  luck: number; // 0..100, ціле
  skills: number[]; // ref вмінь у порядку слотів, до 8, без повторів
}

export const GENIE_MAX_LEVEL = 105;
export const GENIE_MAX_LUCK = 100;
export const GENIE_MAX_SKILLS = 8;

/** Початкові вміння: у джина буває лише одне з них. */
export const INITIAL_REFS: ReadonlySet<number> = new Set([10001, 10151, 10141, 10241]);

export interface GenieSkill {
  ref: number;
  /** Потрібний рівень джина. */
  level: number;
  /** Спорідненість: [метал, дерево, земля, вода, вогонь]. */
  aff: number[];
  /** Маска класів (0 = усі). */
  cls: number;
  /** Маска місцевості (0 = всюди): TERRAIN_LAND / TERRAIN_WATER / TERRAIN_AIR. */
  ter: number;
  /** Клітинка іконки у спрайті genie2.png. */
  page: number;
  x: number;
  y: number;
  name: string;
  /** Скільки рівнів у вміння (10; у початкових — 1). */
  levels: number;
}

/** Усі вміння в порядку дерева (сторінка → ряд → колонка). */
export const GENIE_SKILLS: GenieSkill[] = GENIE_SKILL_ROWS.map((r) => ({
  ref: r[0], level: r[1], aff: [r[2], r[3], r[4], r[5], r[6]], cls: r[7], ter: r[8], page: r[9], x: r[10], y: r[11], name: r[12], levels: r[13],
}));
const BY_REF = new Map(GENIE_SKILLS.map((s) => [s.ref, s]));

/** Вміння за ref; undefined — такого в таблиці немає. */
export function genieSkill(ref: number): GenieSkill | undefined {
  return BY_REF.get(ref);
}

export const GENIE_ELEMENTS = ['Метал', 'Дерево', 'Земля', 'Вода', 'Вогонь'] as const;
export const TERRAIN_LAND = 0x4000;
export const TERRAIN_WATER = 0x8000;
export const TERRAIN_AIR = 0x10000;

// Біт класу в масці вміння: ключ класу ляльки (doc.cls) і клас сайту (CharClass).
const CLS_BIT: Record<string, number> = {
  js: 0x1, ij: 0x2, ya: 0x4, rl: 0x8, by: 0x10, ga: 0x20, fx: 0x40, sj: 0x80, ej: 0x100, rg: 0x200,
  archer: 0x1, cleric: 0x2, barbarian: 0x4, venomancer: 0x8, blademaster: 0x10, wizard: 0x20,
  assassin: 0x40, psychic: 0x80, seeker: 0x100, mystic: 0x200,
};

/** Біт класу для масок вмінь; невідомий клас → 0 (класові обмеження тоді не діють). */
export function clsBit(cls: string): number {
  return Object.prototype.hasOwnProperty.call(CLS_BIT, cls) ? CLS_BIT[cls] : 0;
}

const known = (refs: readonly number[]): GenieSkill[] => refs.map((r) => BY_REF.get(r)).filter((s): s is GenieSkill => !!s);

/** Очки спорідненості на рівні джина: +1 за кожні 5 рівнів, після 100 — +1 за рівень (не більше +4). */
export function affPointsAtLevel(level: number): number {
  return 1 + Math.floor(level / 5) + Math.min(4, Math.max(0, level - 100));
}

/** Вимоги спорідненості набору вмінь — максимум по кожній стихії. */
export function affRequirements(refs: readonly number[]): number[] {
  const req = [0, 0, 0, 0, 0];
  for (const s of known(refs)) for (let i = 0; i < 5; i++) req[i] = Math.max(req[i], s.aff[i]);
  return req;
}

/** Мінімальний рівень джина для набору: рівень кожного вміння, кількість вмінь
 * (5/6/7/8 → 60/80/90/100) і сума очок спорідненості. */
export function minGenieLevel(refs: readonly number[]): number {
  let lvl = 1;
  for (const s of known(refs)) lvl = Math.max(lvl, s.level);
  // Слот займає й вміння, якого вже немає в таблиці, тож рахуємо всі ref.
  const n = Math.min(refs.length, GENIE_MAX_SKILLS);
  if (n >= 5) lvl = Math.max(lvl, [60, 80, 90, 100][n - 5]);
  const pts = affRequirements(refs).reduce((a, b) => a + b, 0);
  return Math.max(lvl, pts <= 21 ? (pts - 1) * 5 : pts - 21 + 100);
}

// Удача, без якої стільки слотів вмінь не відкрити: індекс — кількість вмінь.
const LUCK_BY_COUNT = [0, 0, 0, 0, 0, 51, 71, 81, 91];

/** Потрібна удача для стількох вмінь на цьому рівні (нижче за рівень/10 удача не буває). */
export function neededLucky(level: number, count: number): number {
  const lp = count > GENIE_MAX_SKILLS ? 1000 : LUCK_BY_COUNT[Math.max(0, count)];
  return Math.max(lp, Math.floor(level / 10));
}

/** Найбільша удача на рівні: до 10 за кожні 10 рівнів. Лише для підказки «макс.» — не блокує. */
export function maxLuckAtLevel(level: number): number {
  return 10 * Math.floor(level / 10);
}

export type GenieBlockCode = 'unknown' | 'full' | 'initial' | 'class' | 'level' | 'luck';
export interface GenieBlock {
  code: GenieBlockCode;
  /** Скільки треба (рівень джина, удача, межа кількості). */
  need?: number;
  /** Скільки є зараз. */
  have?: number;
}

/**
 * Чому вміння не можна ДОДАТИ до набору: null — можна (або воно вже в наборі —
 * тоді клік його прибирає). bit — clsBit класу персонажа; 0 — клас не перевіряти.
 * Порядок причин: повно → друге початкове → клас → рівень → удача.
 */
export function whyBlocked(ref: number, cfg: GenieCfg, bit: number): GenieBlock | null {
  if (cfg.skills.includes(ref)) return null;
  const s = BY_REF.get(ref);
  if (!s) return { code: 'unknown' };
  if (cfg.skills.length >= GENIE_MAX_SKILLS) return { code: 'full', need: GENIE_MAX_SKILLS, have: cfg.skills.length };
  if (INITIAL_REFS.has(ref) && cfg.skills.some((r) => INITIAL_REFS.has(r))) return { code: 'initial' };
  if (bit && s.cls && (s.cls & bit) === 0) return { code: 'class' };
  const trial = [...cfg.skills, ref];
  const lvl = minGenieLevel(trial);
  if (lvl > cfg.level) return { code: 'level', need: lvl, have: cfg.level };
  const luck = neededLucky(cfg.level, trial.length);
  if (luck > cfg.luck) return { code: 'luck', need: luck, have: cfg.luck };
  return null;
}

/**
 * Що не так із уже зібраним джином — людськими рядками для картки джина й
 * плашки стану. Порожній список — усе гаразд. Це попередження, а не помилки
 * документа: персонаж зберігається й заявка подається.
 */
export function genieWarnings(cfg: GenieCfg, bit: number): string[] {
  const out: string[] = [];
  const n = cfg.skills.length;
  if (n > GENIE_MAX_SKILLS) out.push(`у джина не більше ${GENIE_MAX_SKILLS} вмінь (зараз ${n})`);
  const lost = cfg.skills.filter((r) => !BY_REF.has(r)).length;
  if (lost) out.push(`невідомих вмінь джина: ${lost} — прибери їх і вибери заново`);
  const sel = known(cfg.skills);
  if (sel.filter((s) => INITIAL_REFS.has(s.ref)).length > 1) out.push('у джина буває лише одне початкове вміння');
  if (bit) for (const s of sel) if (s.cls && (s.cls & bit) === 0) out.push(`вміння «${s.name}» не для цього класу`);
  const lvl = minGenieLevel(cfg.skills);
  if (lvl > cfg.level) out.push(`для цих вмінь потрібен джин від ${lvl} рівня (зараз ${cfg.level})`);
  const maxLuck = maxLuckAtLevel(cfg.level);
  if (cfg.luck > maxLuck) out.push(`удача ${cfg.luck} вища, ніж буває на ${cfg.level} рівні (макс. ${maxLuck}) — перевір рівень джина`);
  const byCount = LUCK_BY_COUNT[Math.min(n, GENIE_MAX_SKILLS)];
  if (byCount > cfg.luck) out.push(`для ${n} вмінь потрібна удача від ${byCount} (зараз ${cfg.luck})`);
  else if (neededLucky(cfg.level, Math.min(n, GENIE_MAX_SKILLS)) > cfg.luck) {
    out.push(`на ${cfg.level} рівні удача джина не буває нижчою за ${Math.floor(cfg.level / 10)} (зараз ${cfg.luck})`);
  }
  return out;
}

/** Удача для балів: не нижча за ту, без якої стільки вмінь не буває (8 вмінь → від 91),
 * тож занижена удача балів не знижує. */
export function genieScoreLuck(cfg: GenieCfg): number {
  return Math.max(cfg.luck, LUCK_BY_COUNT[Math.max(0, Math.min(cfg.skills.length, GENIE_MAX_SKILLS))]);
}

/** Удача → рядок таблиці «Джин» шкали балів. */
export function genieBucket(luck: number): Genie {
  if (luck >= 100) return 'g100';
  if (luck >= 91) return 'g91_99';
  if (luck >= 81) return 'g81_90';
  if (luck >= 71) return 'g71_80';
  if (luck >= 61) return 'g61_70';
  return 'g60';
}

const clampInt = (v: unknown, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.floor(v))) : min;

/**
 * Джин зі знімка персонажа в заявці (registrations.character_snapshot — увесь
 * документ). Знімок пише клієнт прямо в базу, тож це недовірені дані: рівень і
 * удача обрізаються до меж, із вмінь лишаються тільки відомі ref без повторів,
 * перші 8. Назви й іконки показувати лише з нашої таблиці (genieSkill).
 * null — знімка чи джина в ньому немає.
 */
export function genieFromSnapshot(raw: unknown): GenieCfg | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const g = (raw as Record<string, unknown>).genie;
  if (!g || typeof g !== 'object' || Array.isArray(g)) return null;
  const o = g as Record<string, unknown>;
  const skills: number[] = [];
  if (Array.isArray(o.skills)) {
    for (const r of o.skills) {
      if (skills.length >= GENIE_MAX_SKILLS) break;
      if (typeof r === 'number' && BY_REF.has(r) && !skills.includes(r)) skills.push(r);
    }
  }
  return { level: clampInt(o.level, 1, GENIE_MAX_LEVEL), luck: clampInt(o.luck, 0, GENIE_MAX_LUCK), skills };
}
