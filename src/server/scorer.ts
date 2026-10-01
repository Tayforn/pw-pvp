// =========================================================
// СЕРВЕР — скор заявки на фул-рандом без браузера. Точка входу для бекенда
// (pw-ladder, POST /api/pvp/registrations; esbuild бандлить цей файл разом із
// моделлю ляльки): та сама логіка, що заявка персонажем у браузері
// (src/doll/registration.ts → characterForRegistration) і перерахунок зі знімка
// в адмінці (src/doll/recompute.ts): validateDoc → DollFacts → legacy-анкета
// (gearFromCharacter) → сила (powerOf) → скор v2 (scoreItems + itemBreakdown).
//
// Без React-коду, без Vite-специфіки й без fetch: каталоги речей і довідники —
// статичні JSON-імпорти src/doll/data/json/*.json (esbuild вбудовує їх у бандл),
// підставляються в стор каталогу (setCatalogData) і в ядро (setRefData) один раз
// при першому виклику. Модулі з import.meta.glob (catalog.ts, assets.ts)
// викликають glob лише ліниво, тож у Node імпортуються без нього.
//
// Сюди НЕ можна тягнути модулі з supabaseClient (import.meta.env) чи з fetch до
// бекенда: registration.ts, rulesStore.ts, data/tournaments.ts. Тому дві дрібниці
// продубльовано — submitBlockReason (registration.ts) і колонки анкети
// (gearToRow у tournaments.ts); тест src/server/__tests__/scorer.test.ts звіряє
// обидві з оригіналами.
// =========================================================

import { BUILTIN_RULES_VERSION, classPointsFor, normalizeRules, registrationScore, rulesFor, type GearRules } from '../data/gearRules';
import { isBalancedRandom, type DollPower, type PlayerGear, type TeamMode } from '../data/types';
import { setRefData, type RefData } from '../doll/core/refdata';
import type { Item } from '../doll/core/types';
import { setCatalogData, type CatName } from '../doll/data/catalog';
import { validateDoc, type CharacterDoc } from '../doll/model/doc';
import {
  ITEM_BREAKDOWN_MAX_BYTES, breakdownBytes, itemBreakdown, scoreItems, type BreakdownRow, type ItemBreakdown, type ItemScore,
} from '../doll/model/itemScore';
import { POWER_OPPONENT, powerOf } from '../doll/model/power';
import { PREVIEW_TEAM_SIZE } from '../doll/model/readiness';
import { CLS_CHAR, charLevelOf, dollFacts, gearFromCharacter, genieOf } from '../doll/model/sheet';

// ── Каталоги (19 категорій) і довідники (7 файлів) ─────────────────────
import ftJson from '../doll/data/json/ft.json';
import vxJson from '../doll/data/json/vx.json';
import rvJson from '../doll/data/json/rv.json';
import stJson from '../doll/data/json/st.json';
import tgJson from '../doll/data/json/tg.json';
import rxJson from '../doll/data/json/rx.json';
import wyJson from '../doll/data/json/wy.json';
import mjJson from '../doll/data/json/mj.json';
import oqJson from '../doll/data/json/oq.json';
import taJson from '../doll/data/json/ta.json';
import itJson from '../doll/data/json/it.json';
import qnJson from '../doll/data/json/qn.json';
import ppJson from '../doll/data/json/pp.json';
import pkJson from '../doll/data/json/pk.json';
import gvJson from '../doll/data/json/gv.json';
import icJson from '../doll/data/json/ic.json';
import obJson from '../doll/data/json/ob.json';
import wdfJson from '../doll/data/json/wdf.json';
import crystalJson from '../doll/data/json/crystal.json';
import setsJson from '../doll/data/json/sets.json';
import buffsJson from '../doll/data/json/buffs.json';
import debuffsJson from '../doll/data/json/debuffs.json';
import buffDefaultsJson from '../doll/data/json/buff-defaults.json';
import skillsJson from '../doll/data/json/skills.json';
import fuStateJson from '../doll/data/json/fustate.json';
import labelsJson from '../doll/data/json/labels.json';

export { BUILTIN_RULES_VERSION };

const CATALOG: Record<CatName, unknown> = {
  ft: ftJson, vx: vxJson, rv: rvJson, st: stJson, tg: tgJson, rx: rxJson, wy: wyJson, mj: mjJson, oq: oqJson, ta: taJson,
  it: itJson, qn: qnJson, pp: ppJson, pk: pkJson, gv: gvJson, ic: icJson, ob: obJson, wdf: wdfJson, crystal: crystalJson,
};

let dataReady = false;
/** Каталог у стор (getItem) і довідники в ядро — один раз на процес. */
function ensureServerData(): void {
  if (dataReady) return;
  setCatalogData(CATALOG as unknown as Record<CatName, readonly Item[]>);
  setRefData({
    sets: setsJson, buffs: buffsJson, debuffs: debuffsJson, buffDefaults: buffDefaultsJson,
    skills: skillsJson, fuState: fuStateJson, labels: labelsJson,
  } as unknown as RefData);
  dataReady = true;
}

// ── Те, що в браузері живе в модулях із supabaseClient (див. шапку) ──────

/** Копія submitBlockReason з src/doll/registration.ts (тест звіряє). */
export function submitBlockReason(missing: readonly string[]): string | null {
  if (!missing.length) return null;
  const parts = missing.map((m) => (m === 'зброя' ? 'у персонажа немає зброї (ні в Головному, ні в сеті)' : `у Головному ${m}`));
  return `Заявку не подати: ${parts.join('; ')}.`;
}

/** Колонки анкети заявки (0017–0026) — копія gearToRow з src/data/tournaments.ts (тест звіряє). */
export function gearColumns(g: PlayerGear): Record<string, unknown> {
  return {
    char_class: g.charClass, char_level: g.charLevel, build: g.build, weapon_grade: g.weaponGrade, weapon_refine: g.weaponRefine, weapon_pz: g.weaponPz,
    armor_set: g.armorSet, armor_refine: g.armorRefine, gems: g.gems, special_sets: g.specialSets, special_set_gems: g.specialSetGems,
    tract: g.tract, genie: g.genie,
    shg: g.shg, shg_refine: g.shg ? g.shgRefine ?? 0 : null,
    voznes: g.voznes, voznes_refine: g.voznes ? g.voznesRefine ?? 0 : null,
    ring1: g.ring1, ring1_refine: g.ring1 === 'r9r1' ? g.ring1Refine ?? 0 : null,
    ring2: g.ring2, ring2_refine: g.ring2 === 'r9r1' ? g.ring2Refine ?? 0 : null,
  };
}

// ── Скор заявки ──────────────────────────────────────────────────────

/** item_breakdown заявки, порахованої сервером: перевірено (checked — як після
 * перерахунку в адмінці, бейджа «не перевірено» немає й жеребка не чекає),
 * server — рахував бекенд, scorer — чим саме (коміт pw-pvp у збірці бекенда). */
export type ServerItemBreakdown = ItemBreakdown & { checked: true; server: true; scorer?: string } & RegistrationTags;

/** Мітки рядка заявки, які ставить бекенд (у item_breakdown):
 * nonce — мітка спроби подачі з браузера: після тайм-ауту сайт упізнає за нею свою щойно записану заявку;
 * sig — підпис бекенда (HMAC секретом сервера) для заявки збереженим персонажем: «вже подано цим
 * персонажем» рахуються лише підписані рядки, тож рядок, підкинутий напряму анонімним ключем, нікого не блокує.
 * Мітка Discord-акаунта («одна заявка з акаунта») — не тут, а в окремій колонці account_tag (0035): розклад
 * переписує перерахунок адміна, а колонку — ні. */
export interface RegistrationTags {
  nonce?: string;
  sig?: string;
}

export interface ScoreRegistrationInput {
  /** Документ персонажа: з бази ладдера (свій персонаж) або з тіла запиту (чернетка гостя). */
  doc: unknown;
  /** balance_rules.rules версії шкали турніру (як з бази, сирий JSON); null — вбудована версія. */
  rulesRaw: unknown;
  /** Назва цієї версії (balance_rules.version) — іде в item_breakdown.ver; при rulesRaw = null ігнорується. */
  rulesVersion: string | null;
  /** Розмір команди турніру — бали класу; null/без нього — з tournament, інакше 3×3 (як заявка в браузері). */
  teamSize?: number | null;
  /** Турнір (необовʼязково): заявка персонажем — лише на балансний фул-рандом. */
  tournament?: { teamMode?: TeamMode | string | null; teamSize?: number | null } | null;
  /** Хто рахував — коміт pw-pvp, підставлений під час збірки бекенда (до 40 символів). */
  scorer?: string;
  /** Мітки бекенда для item_breakdown (nonce, sig) — входять у ліміт розміру розкладу. */
  tags?: RegistrationTags;
}

export type ScoreRegistrationResult =
  | {
      ok: true;
      /** Документ після перевірки (validateDoc; мʼякі порушення — відновлений) — це й піде в character_snapshot. */
      doc: CharacterDoc;
      /** Legacy-анкета для колонок заявки (грейди — з надітих речей). */
      gear: PlayerGear;
      /** Готові колонки рядка registrations: анкета, attack/defense_level, doll_power, item_points, item_breakdown. */
      columns: Record<string, unknown>;
      dollPower: DollPower;
      attackLevel: number;
      defenseLevel: number;
      itemPoints: number;
      itemBreakdown: ServerItemBreakdown;
      /** Якою версією шкали рахували. */
      rulesVersion: string;
      /** Скор заявки так, як його порахує жеребка (registrationScore), без корекції адміна. */
      score: number;
      /** Жовті примітки скору v2 (нерозпізнані речі, ранг 17+, зброя в сеті, дублі). */
      warn: string[];
      /** Повний результат скору v2 з назвами речей. */
      items: ItemScore;
    }
  | { ok: false; blockReason: string };

const SCORER_MAX = 40;
const TAG_MAX = 64;

/** Розклад із прапорцями сервера, не більше ITEM_BREAKDOWN_MAX_BYTES (CHECK у базі — 2048 Б):
 * спершу без «чому», потім без найдешевших рядків — як itemBreakdown. */
function serverBreakdown(base: ItemBreakdown, scorer: string | undefined, tags: RegistrationTags = {}): ServerItemBreakdown {
  const tag = scorer ? scorer.slice(0, SCORER_MAX) : undefined;
  const marks: RegistrationTags = {
    ...(tags.nonce ? { nonce: tags.nonce.slice(0, TAG_MAX) } : {}),
    ...(tags.sig ? { sig: tags.sig.slice(0, TAG_MAX) } : {}),
  };
  const make = (rows: BreakdownRow[]): ServerItemBreakdown => ({ ...base, rows, checked: true, server: true, ...(tag ? { scorer: tag } : {}), ...marks });
  let b = make(base.rows);
  if (breakdownBytes(b) <= ITEM_BREAKDOWN_MAX_BYTES) return b;
  let rows = base.rows.map((r) => r.slice(0, 4) as BreakdownRow);
  b = make(rows);
  while (breakdownBytes(b) > ITEM_BREAKDOWN_MAX_BYTES && rows.length) {
    const cheapest = rows.reduce((m, r, i) => (r[3] < rows[m][3] ? i : m), 0);
    rows = rows.filter((_, i) => i !== cheapest);
    b = make(rows);
  }
  return b;
}

/**
 * Скор заявки персонажем — серверний двійник characterForRegistration: ті самі
 * legacy-колонки (gearFromCharacter із setsFromDoll версії), сила (powerOf +
 * склад каменів + ПЗ свап-зброї), itemPoints і розклад (клас за розміром
 * команди, рівень, джин з блоку джина). ok: false — заявку не подати
 * (blockReason — текст для гравця): документ пошкоджено, турнір не фул-рандом,
 * немає зброї чи порожній слот броні.
 */
export function scoreRegistration(input: ScoreRegistrationInput): ScoreRegistrationResult {
  const t = input.tournament;
  if (t && t.teamMode != null && !isBalancedRandom({ teamMode: t.teamMode as TeamMode, teamSize: t.teamSize ?? input.teamSize ?? null })) {
    return { ok: false, blockReason: 'Заявка персонажем із ляльки — лише на турнір із балансним фул-рандомом.' };
  }
  const v = validateDoc(input.doc);
  const doc = v.ok ? v.doc : v.recoverable;
  if (!doc) {
    return { ok: false, blockReason: `Документ персонажа пошкоджено (${v.ok ? '' : v.errors[0] ?? ''}) — відкрий його на сторінці персонажа й збережи ще раз.` };
  }
  ensureServerData();

  const builtin = input.rulesRaw == null;
  const rules: GearRules = builtin ? rulesFor(BUILTIN_RULES_VERSION) : normalizeRules(input.rulesRaw);
  const rulesVersion = builtin ? BUILTIN_RULES_VERSION : (input.rulesVersion ?? '').trim() || BUILTIN_RULES_VERSION;
  const teamSize = input.teamSize ?? t?.teamSize ?? PREVIEW_TEAM_SIZE;

  const facts = dollFacts(doc, rules);
  const result = gearFromCharacter(doc, facts, { setsFromDoll: rules.setsFromDoll });
  const blockReason = submitBlockReason(result.missing);
  if (blockReason || !result.gear) return { ok: false, blockReason: blockReason ?? 'Заявку не подати: лялька не зібрала анкету.' };
  const gear = result.gear;

  const dollPower: DollPower = {
    ...powerOf(doc, POWER_OPPONENT),
    gems: facts.gemCounts,
    ...(facts.weaponPzGain > 0 ? { pzw: Math.round(facts.weaponPzGain * 10) / 10 } : {}),
  };
  const items = scoreItems(doc, rules);
  const genie = genieOf(doc) ?? 'g60';
  const breakdown = serverBreakdown(
    itemBreakdown(items, rulesVersion, {
      cls: classPointsFor(rules, CLS_CHAR[doc.cls], teamSize),
      lvl: rules.level[charLevelOf(doc.level)],
      genie: rules.genie[genie],
    }),
    input.scorer,
    input.tags,
  );
  const score = registrationScore({ gear, itemPoints: items.itemPoints }, rules, teamSize) ?? 0;
  return {
    ok: true,
    doc,
    gear,
    columns: {
      ...gearColumns(gear),
      attack_level: result.attackLevel,
      defense_level: result.defenseLevel,
      doll_power: dollPower,
      item_points: items.itemPoints,
      item_breakdown: breakdown,
    },
    dollPower,
    attackLevel: result.attackLevel,
    defenseLevel: result.defenseLevel,
    itemPoints: items.itemPoints,
    itemBreakdown: breakdown,
    rulesVersion,
    score,
    warn: [...new Set(items.warn)],
    items,
  };
}
