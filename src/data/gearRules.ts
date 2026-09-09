// =========================================================
// pw-pvp: таблиці балів «Tournament Gear Score» для балансного
// фул-рандому + мапа ролей і параметри алгоритму — усе версіоноване.
//
// Версії живуть у реєстрі: вбудована 'balance-v1.0' — у коді нижче (вона ж
// фолбек і шаблон), решта — з таблиці balance_rules (0019), яку суперадмін
// поповнює з адмінки («Шкала балів»). Версії незмінні: турнір при формуванні
// команд фіксує balance_rules_version, і його score мають рахуватись так само
// й через рік (спека §26). Поточна версія для нових турнірів — найновіша.
// Обґрунтування чисел v1.0 — docs/balanced-random-analysis.md §3.1.
// =========================================================

import type {
  ArmorRefine, ArmorSet, CharClass, Gems, Genie, PlayerGear, SpecialSet, Tier, Tract, WeaponGrade, WeaponRefine,
} from './types';

export type Role = 'support' | 'tank' | 'ranged' | 'melee' | 'control';
export const ROLES: Role[] = ['support', 'tank', 'ranged', 'melee', 'control'];

export interface BalanceWeights {
  /** різниця сум команд */
  total: number;
  /** «профіль сили»: діапазони сум top-k з вагою top/k */
  top: number;
  /** м'який баланс ролей (за одиницю нерівномірності понад slack) */
  role: number;
  /** guard: дублікати класів понад неминучі (за побудовою завжди 0) */
  dup: number;
}

/** Параметри алгоритму формування команд (src/data/balance.ts). */
export interface BalanceRules {
  roleOf: Record<CharClass, Role>;
  weights: BalanceWeights;
  /** температура відпалу на старті / в кінці, у балах score */
  T0: number;
  T1: number;
  /** ε-коридор випадкового вибору серед майже рівних розв'язків, у балах */
  epsilon: number;
  /** не більше стількох кандидатів у коридорі */
  topN: number;
}

/** Таблиці балів — те, що редагує адмін. */
export interface ScoringRules {
  weaponGrade: Record<WeaponGrade, number>;
  weaponRefine: Record<WeaponRefine, number>;
  /** бали за ПЗ-зброю — запасну зброю з показником захисту, на яку свапаються,
   * щоб отримувати менше шкоди; не залежить від грейду основної зброї */
  weaponPz: number;
  armorSet: Record<ArmorSet, number>;
  /** сети, які в формі не показуються, поки ні в кого немає (feature flag) */
  hiddenArmorSets: ArmorSet[];
  armorRefine: Record<ArmorRefine, number>;
  /** камені у броні — за вартістю по зростанню; максимум = 24 камені по 2 ПЗ */
  gems: Record<Gems, number>;
  specialSets: Record<SpecialSet, number>;
  /** бонус за кожен додатковий сет понад найсильніший (гнучкість свапу) */
  specialSetsExtra: number;
  specialSetsCap: number;
  tract: Record<Tract, number>;
  genie: Record<Genie, number>;
  /** пороги tier, за спаданням; останній — D з min = -Infinity (у JSON — null) */
  tiers: { min: number; tier: Tier }[];
}

export interface GearRules extends ScoringRules {
  balance: BalanceRules;
}

/** Вбудована версія — фолбек і шаблон для нових версій. */
export const BUILTIN_RULES_VERSION = 'balance-v1.0';

const BUILTIN: GearRules = {
  // ПА фіксований за грейдом (ЦГД 30, РЦГД 50, R9 30, R9R1 40, R9R2 50) — вшито в бали.
  // Рідкість на сервері (8 міс.): ЦГД ~5, РЦГД ~20, R9 1, R9R1 2, R9R2 2 — тому
  // великі розриви R8R → ЦГД (+15) і РЦГД → R9R2 (+15), решта лінійки між ними.
  weaponGrade: { other: 0, nirvana: 5, r8r: 10, cgd: 25, r9: 32, r9r1: 40, rcgd: 45, r9r2: 60 },
  weaponRefine: { w0_5: 0, w6_7: 4, w8_9: 8, w10: 12, w11: 18, w12: 25 },
  weaponPz: 15,
  armorSet: { other: 0, nirvana: 5, nirvana_r8_mix: 10, r8: 15, r8r: 22, r9: 35 },
  hiddenArmorSets: ['r9'],
  armorRefine: { a0_4: 0, a5: 3, a6: 7, a7: 11, a8: 17, a9: 23, a10: 27, a11: 29, a12: 30 },
  // 24 камені; повні Лагеря = 48 ПЗ (≈ різниця між топовим і слабким грейдом зброї) → max 40
  gems: { g0_9: 0, g10: 4, g11: 8, xuan: 14, xuan_pa: 20, pa: 26, xuan_camp: 33, camp: 40 },
  // свап-комплекти в тих самих слотах: активний один, решта — гнучкість
  specialSets: { pz: 15, pa: 12, aspd: 8 },
  specialSetsExtra: 5,
  specialSetsCap: 20,
  tract: { t1_3: 0, t4_5: 2, t6: 5, t7: 8, t8: 15, emperor: 20 },
  genie: { top: 10, lower: 0 },
  // max 255 → S ≥ 200 · A 160 · B 115 · C 75 · D
  tiers: [
    { min: 200, tier: 'S' },
    { min: 160, tier: 'A' },
    { min: 115, tier: 'B' },
    { min: 75, tier: 'C' },
    { min: -Infinity, tier: 'D' },
  ],
  balance: {
    roleOf: {
      cleric: 'support', mystic: 'support',
      barbarian: 'tank',
      archer: 'ranged', wizard: 'ranged', psychic: 'ranged',
      blademaster: 'melee', assassin: 'melee', seeker: 'melee',
      venomancer: 'control',
    },
    weights: { total: 1, top: 1, role: 3, dup: 1000 },
    T0: 6,
    T1: 0.05,
    epsilon: 5,
    topN: 10,
  },
};

// ── Реєстр версій ────────────────────────────────────────────────

export interface RulesVersionInfo {
  version: string;
  note: string | null;
  createdAt: string | null;
  builtin: boolean;
}

const registry = new Map<string, GearRules>([[BUILTIN_RULES_VERSION, BUILTIN]]);
const versionInfo = new Map<string, RulesVersionInfo>([[BUILTIN_RULES_VERSION, { version: BUILTIN_RULES_VERSION, note: 'вбудована (docs/balanced-random-analysis.md §3.1)', createdAt: null, builtin: true }]]);
let currentVersion = BUILTIN_RULES_VERSION;

/** Версія для нових турнірів — найновіша зареєстрована (вбудована, поки БД не завантажено). */
export function currentRulesVersion(): string {
  return currentVersion;
}

export function rulesFor(version?: string | null): GearRules {
  return registry.get(version ?? currentVersion) ?? registry.get(currentVersion) ?? BUILTIN;
}

export function hasRulesVersion(version: string): boolean {
  return registry.has(version);
}

export function listRulesVersions(): RulesVersionInfo[] {
  return Array.from(versionInfo.values()).sort((a, b) => (a.createdAt ?? '') < (b.createdAt ?? '') ? -1 : (a.createdAt ?? '') > (b.createdAt ?? '') ? 1 : 0);
}

/** Реєструє версію (з БД або щойно збережену). makeCurrent — якщо вона найновіша. */
export function registerRules(info: RulesVersionInfo, rules: GearRules, makeCurrent: boolean): void {
  registry.set(info.version, rules);
  versionInfo.set(info.version, info);
  if (makeCurrent) currentVersion = info.version;
}

/** Наступна назва версії: balance-v1.0 → balance-v1.1 → … (мінор +1 до найбільшого). */
export function nextRulesVersion(): string {
  let major = 1, minor = 0;
  for (const v of registry.keys()) {
    const m = /^balance-v(\d+)\.(\d+)$/.exec(v);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > major || (a === major && b > minor)) { major = a; minor = b; }
  }
  return `balance-v${major}.${minor + 1}`;
}

// ── Серіалізація / валідація JSON з БД ─────────────────────────────

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function numTable<K extends string>(src: unknown, template: Record<K, number>): Record<K, number> {
  const out = { ...template };
  if (src && typeof src === 'object') {
    for (const k of Object.keys(template) as K[]) {
      const v = (src as Record<string, unknown>)[k];
      if (isNum(v)) out[k] = v;
    }
  }
  return out;
}

/** Розбирає JSON версії: невідомі/зламані поля беруться з вбудованої, тож
 * старий або неповний запис ніколи не зламає підрахунок. Tier D у JSON — min null. */
export function normalizeRules(raw: unknown): GearRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (r.balance && typeof r.balance === 'object' ? r.balance : {}) as Record<string, unknown>;
  const tiersRaw = Array.isArray(r.tiers) ? r.tiers : [];
  const tiers: { min: number; tier: Tier }[] = [];
  for (const t of tiersRaw as { min?: unknown; tier?: unknown }[]) {
    if (t && typeof t.tier === 'string' && ['S', 'A', 'B', 'C', 'D'].includes(t.tier)) {
      tiers.push({ min: isNum(t.min) ? t.min : -Infinity, tier: t.tier as Tier });
    }
  }
  const validTiers = tiers.length === 5 && tiers[4].tier === 'D' && tiers.every((t, i) => i === 0 || t.min < tiers[i - 1].min);
  const hidden = Array.isArray(r.hiddenArmorSets) ? (r.hiddenArmorSets.filter((s) => typeof s === 'string' && s in BUILTIN.armorSet) as ArmorSet[]) : BUILTIN.hiddenArmorSets;
  return {
    weaponGrade: numTable(r.weaponGrade, BUILTIN.weaponGrade),
    weaponRefine: numTable(r.weaponRefine, BUILTIN.weaponRefine),
    weaponPz: isNum(r.weaponPz) ? r.weaponPz : BUILTIN.weaponPz,
    armorSet: numTable(r.armorSet, BUILTIN.armorSet),
    hiddenArmorSets: hidden,
    armorRefine: numTable(r.armorRefine, BUILTIN.armorRefine),
    gems: numTable(r.gems, BUILTIN.gems),
    specialSets: numTable(r.specialSets, BUILTIN.specialSets),
    specialSetsExtra: isNum(r.specialSetsExtra) ? r.specialSetsExtra : BUILTIN.specialSetsExtra,
    specialSetsCap: isNum(r.specialSetsCap) ? r.specialSetsCap : BUILTIN.specialSetsCap,
    tract: numTable(r.tract, BUILTIN.tract),
    genie: numTable(r.genie, BUILTIN.genie),
    tiers: validTiers ? tiers : BUILTIN.tiers.map((t) => ({ ...t })),
    balance: {
      roleOf: { ...BUILTIN.balance.roleOf, ...((b.roleOf && typeof b.roleOf === 'object' ? b.roleOf : {}) as Partial<Record<CharClass, Role>>) },
      weights: numTable(b.weights, BUILTIN.balance.weights),
      T0: isNum(b.T0) ? b.T0 : BUILTIN.balance.T0,
      T1: isNum(b.T1) ? b.T1 : BUILTIN.balance.T1,
      epsilon: isNum(b.epsilon) ? b.epsilon : BUILTIN.balance.epsilon,
      topN: isNum(b.topN) ? b.topN : BUILTIN.balance.topN,
    },
  };
}

/** У JSON -Infinity не існує — tier D пишемо з min: null. */
export function serializeRules(rules: GearRules): unknown {
  return { ...rules, tiers: rules.tiers.map((t) => ({ tier: t.tier, min: Number.isFinite(t.min) ? t.min : null })) };
}

/** Глибока копія для чернетки редактора. */
export function cloneRules(rules: GearRules): GearRules {
  return normalizeRules(JSON.parse(JSON.stringify(serializeRules(rules))));
}

// ── Підрахунок ───────────────────────────────────────────────────

export function specialSetsScore(sets: SpecialSet[], rules: ScoringRules): number {
  const uniq = Array.from(new Set(sets));
  if (uniq.length === 0) return 0;
  const best = Math.max(...uniq.map((s) => rules.specialSets[s]));
  return Math.min(rules.specialSetsCap, best + rules.specialSetsExtra * (uniq.length - 1));
}

export function computeGearScoreWith(g: PlayerGear, r: ScoringRules): number {
  return (
    r.weaponGrade[g.weaponGrade] +
    r.weaponRefine[g.weaponRefine] +
    (g.weaponPz ? r.weaponPz : 0) +
    r.armorSet[g.armorSet] +
    r.armorRefine[g.armorRefine] +
    r.gems[g.gems] +
    specialSetsScore(g.specialSets, r) +
    r.tract[g.tract] +
    r.genie[g.genie]
  );
}

export function computeGearScore(g: PlayerGear, version?: string | null): number {
  return computeGearScoreWith(g, rulesFor(version));
}

export function maxGearScoreOf(r: ScoringRules): number {
  const mx = (o: Record<string, number>) => Math.max(...Object.values(o));
  return mx(r.weaponGrade) + mx(r.weaponRefine) + r.weaponPz + mx(r.armorSet) + mx(r.armorRefine) + mx(r.gems) + r.specialSetsCap + mx(r.tract) + mx(r.genie);
}

export function maxGearScore(version?: string | null): number {
  return maxGearScoreOf(rulesFor(version));
}

export function tierForWith(score: number, r: ScoringRules): Tier {
  return (r.tiers.find((t) => score >= t.min) ?? r.tiers[r.tiers.length - 1]).tier;
}

export function tierFor(score: number, version?: string | null): Tier {
  return tierForWith(score, rulesFor(version));
}

// ── Підписи (лише українською — рішення власника) і порядок опцій у select-ах ──

export const CLASS_LABELS: Record<CharClass, string> = {
  blademaster: 'Воїн', wizard: 'Маг', cleric: 'Прист', archer: 'Лучник', barbarian: 'Танк',
  venomancer: 'Друїд', assassin: 'Сін', psychic: 'Шаман', seeker: 'Страж', mystic: 'Містик',
};
export const CLASS_ORDER: CharClass[] = ['blademaster', 'wizard', 'cleric', 'archer', 'barbarian', 'venomancer', 'assassin', 'psychic', 'seeker', 'mystic'];

export const WEAPON_GRADE_LABELS: Record<WeaponGrade, string> = {
  other: 'Інше / нижче Нірвани', nirvana: 'Нірвана', r8r: 'R8R', cgd: 'ЦГД', r9: 'R9', r9r1: 'R9R1', rcgd: 'РЦГД', r9r2: 'R9R2',
};
export const WEAPON_GRADE_ORDER: WeaponGrade[] = ['other', 'nirvana', 'r8r', 'cgd', 'r9', 'r9r1', 'rcgd', 'r9r2'];

export const WEAPON_REFINE_LABELS: Record<WeaponRefine, string> = { w0_5: '+0–5', w6_7: '+6–7', w8_9: '+8–9', w10: '+10', w11: '+11', w12: '+12' };
export const WEAPON_REFINE_ORDER: WeaponRefine[] = ['w0_5', 'w6_7', 'w8_9', 'w10', 'w11', 'w12'];

export const ARMOR_SET_LABELS: Record<ArmorSet, string> = {
  other: 'Інше / нижче Нірвани', nirvana: 'Нірвана', nirvana_r8_mix: 'Нірвана / R8 (мікс)', r8: 'R8', r8r: 'R8R', r9: 'R9',
};
export const ARMOR_SET_ORDER: ArmorSet[] = ['other', 'nirvana', 'nirvana_r8_mix', 'r8', 'r8r', 'r9'];

export const ARMOR_REFINE_LABELS: Record<ArmorRefine, string> = {
  a0_4: '+0–4', a5: '+5', a6: '+6', a7: '+7', a8: '+8', a9: '+9', a10: '+10', a11: '+11', a12: '+12',
};
export const ARMOR_REFINE_ORDER: ArmorRefine[] = ['a0_4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12'];

export const GEMS_LABELS: Record<Gems, string> = {
  g0_9: '0–9', g10: '10', g11: '11', xuan: 'Сюаньки', xuan_pa: 'Сюаньки / ПА (мішанина)', pa: 'ПА',
  xuan_camp: 'Сюаньки / Лагеря (мішанина)', camp: 'Лагеря',
};
export const GEMS_ORDER: Gems[] = ['g0_9', 'g10', 'g11', 'xuan', 'xuan_pa', 'pa', 'xuan_camp', 'camp'];

export const SPECIAL_SET_LABELS: Record<SpecialSet, string> = { pz: 'ПЗ-сет', pa: 'ПА-сет', aspd: 'Спів / Аспід' };
export const SPECIAL_SET_HINTS: Record<SpecialSet, string> = {
  pz: 'сумарний показник захисту у комплекті ≥ 30 (без бафів)',
  pa: 'сумарний показник атаки у комплекті ≥ 30 (без бафів)',
  aspd: 'швидкість атаки ≥ 3.33 уд/с або −30 % часу активації з предметів (без бафів)',
};
export const SPECIAL_SET_ORDER: SpecialSet[] = ['pz', 'pa', 'aspd'];

export const TRACT_LABELS: Record<Tract, string> = {
  t1_3: '1–3 грейд', t4_5: '4–5 грейд', t6: '6 грейд (Пань Гу)', t7: '7 грейд', t8: '8 грейд (Гегемонія)', emperor: 'Імператор і вище',
};
export const TRACT_ORDER: Tract[] = ['t1_3', 't4_5', 't6', 't7', 't8', 'emperor'];

export const GENIE_LABELS: Record<Genie, string> = { top: '100/100', lower: '100−' };
export const GENIE_ORDER: Genie[] = ['top', 'lower'];

export const ROLE_LABELS: Record<Role, string> = { support: 'Сапорт', tank: 'Танк', ranged: 'Дальній ДД', melee: 'Ближній ДД', control: 'Контроль' };

/** Компактний рядок для адмінки/публічної сторінки: «ЦГД +10 · R8R +8 · Камні ПА · ПЗ-сет · Тракт 8 · Джин 100/100». */
export function gearSummary(g: PlayerGear, version?: string | null): string {
  void version;
  const parts: string[] = [];
  parts.push(`${WEAPON_GRADE_LABELS[g.weaponGrade]} ${WEAPON_REFINE_LABELS[g.weaponRefine]}${g.weaponPz ? ' + ПЗ-зброя' : ''}`);
  parts.push(`${ARMOR_SET_LABELS[g.armorSet]} ${ARMOR_REFINE_LABELS[g.armorRefine]}`);
  parts.push(`Камні ${GEMS_LABELS[g.gems].replace(/ \(.*\)$/, '')}`);
  if (g.specialSets.length) parts.push(SPECIAL_SET_ORDER.filter((s) => g.specialSets.includes(s)).map((s) => SPECIAL_SET_LABELS[s]).join(', '));
  parts.push(`Тракт ${TRACT_LABELS[g.tract].replace(/ \(.*\)$/, '').replace(' грейд', '')}`);
  parts.push(`Джин ${GENIE_LABELS[g.genie]}`);
  return parts.join(' · ');
}
