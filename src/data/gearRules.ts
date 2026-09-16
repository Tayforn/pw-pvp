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

/** Колонки матриці «клас × розмір паті»: 2, 3, 4, 5 і «6+» (6 і більше). */
export const SIZE_BUCKETS = ['2', '3', '4', '5', '6'] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];
export const SIZE_BUCKET_LABELS: Record<SizeBucket, string> = { '2': '2', '3': '3', '4': '4', '5': '5', '6': '6+' };

/** Розмір команди → колонка матриці: 1 і менше (не балансний формат) — як 2,
 * 6 і більше — «6+». */
export function sizeBucket(teamSize: number | null | undefined): SizeBucket {
  const n = Math.floor(teamSize ?? 0);
  if (n >= 6) return '6';
  if (n <= 2) return '2';
  return String(n) as SizeBucket;
}

/** Один ряд балів за клас → однаково для всіх розмірів паті. */
export function sameForAllSizes(points: Record<CharClass, number>): Record<SizeBucket, Record<CharClass, number>> {
  const out = {} as Record<SizeBucket, Record<CharClass, number>>;
  for (const s of SIZE_BUCKETS) out[s] = { ...points };
  return out;
}

/** Таблиці балів — те, що редагує адмін. */
export interface ScoringRules {
  /** бали за сам клас — за розміром паті: сила класу залежить від формату (сін
   * тягне 2×2 / 3×3, у 6×6 важливіші прист, маг, танк). Колонка = розмір команди
   * турніру (sizeBucket). Спека це не радила, бо сила класу залежить від складу
   * пачки, але власник хоче балансувати і за цим — усі нулі = вимкнено */
  classPointsBySize: Record<SizeBucket, Record<CharClass, number>>;
  /** бали за грейд зброї за замовчуванням (для класів без окремого значення) */
  weaponGrade: Record<WeaponGrade, number>;
  /** перевизначення за класом: R9-лінійка нерівна між класами (абілки на фізичних
   * R9/R9R1 важать більше за +ПА РЦГД, у інтовиків — навпаки); порожньо = дефолт */
  weaponGradeByClass: Record<CharClass, Partial<Record<WeaponGrade, number>>>;
  weaponRefine: Record<WeaponRefine, number>;
  /** бали за ПЗ-зброю — запасну зброю з показником захисту, на яку свапаються,
   * щоб отримувати менше шкоди; не залежить від грейду основної зброї */
  weaponPz: number;
  armorSet: Record<ArmorSet, number>;
  /** сети, які в формі не показуються, поки ні в кого немає (feature flag) */
  hiddenArmorSets: ArmorSet[];
  armorRefine: Record<ArmorRefine, number>;
  /** камені в основному сеті — за вартістю по зростанню; максимум = 24 камені по 2 ПЗ */
  gems: Record<Gems, number>;
  /** камені у свап-сетах: частка від таблиці gems за кожен відмічений сет … */
  specialSetGemsFactor: number;
  /** … і стеля на їх суму */
  specialSetGemsCap: number;
  specialSets: Record<SpecialSet, number>;
  /** бонус за кожен додатковий сет понад найсильніший (гнучкість свапу) */
  specialSetsExtra: number;
  specialSetsCap: number;
  tract: Record<Tract, number>;
  genie: Record<Genie, number>;
  /** ШГ і Вознєс: бали за саму наявність шмотки, бонус, якщо є обидві
   * (комплект), і бали за кожен рівень точки кожної. Версії, збережені до
   * появи цих полів, отримують значення вбудованої — анкет із цими шмотками
   * тоді ще не було, тож їхні скори від цього не змінюються. */
  shg: number;
  voznes: number;
  shgVoznesBonus: number;
  shgRefinePerLevel: number;
  voznesRefinePerLevel: number;
  /** Ело-рейтинг з результатів матчів (src/data/ratings.ts): бали за кожні 100
   * пунктів рейтингу понад/нижче 1000 … */
  ratingWeight: number;
  /** … але не більше ± цього (щоб рейтинг не переважив гір, поки історії мало) */
  ratingCap: number;
  /** пороги tier, за спаданням; останній — D з min = -Infinity (у JSON — null) */
  tiers: { min: number; tier: Tier }[];
}

export interface GearRules extends ScoringRules {
  balance: BalanceRules;
}

/** Вбудована версія — фолбек і шаблон для нових версій. */
export const BUILTIN_RULES_VERSION = 'balance-v1.0';

/** Фізичні класи: на їхніх R9 / R9R1 абілка важить більше, ніж +ПА РЦГД. */
export const PHYSICAL_CLASSES: CharClass[] = ['archer', 'barbarian', 'assassin', 'blademaster', 'seeker'];
const CASTER_CLASSES: CharClass[] = ['wizard', 'cleric', 'psychic', 'venomancer', 'mystic'];

const byClass = (physical: Partial<Record<WeaponGrade, number>>, caster: Partial<Record<WeaponGrade, number>>): Record<CharClass, Partial<Record<WeaponGrade, number>>> => {
  const out = {} as Record<CharClass, Partial<Record<WeaponGrade, number>>>;
  for (const c of PHYSICAL_CLASSES) out[c] = { ...physical };
  for (const c of CASTER_CLASSES) out[c] = { ...caster };
  return out;
};

/** Рекомендована матриця за розміром паті (оцінка для 1.4.6, до 10): сін, шаман,
 * друїд сильніші в малих форматах; прист, маг, танк, воїн, містик — у масових;
 * лучник і страж рівні скрізь. Пресет у редакторі («Рекомендовані за розміром»),
 * у вбудовану версію не входить, щоб не зсунути скори турнірів на v1.0. */
export const RECOMMENDED_CLASS_POINTS_BY_SIZE: Record<SizeBucket, Record<CharClass, number>> = {
  '2': { assassin: 10, psychic: 9, archer: 8, venomancer: 8, seeker: 7, wizard: 6, cleric: 5, barbarian: 5, mystic: 5, blademaster: 5 },
  '3': { assassin: 9, psychic: 8, archer: 8, venomancer: 7, seeker: 7, wizard: 7, cleric: 7, barbarian: 6, mystic: 6, blademaster: 6 },
  '4': { assassin: 8, psychic: 8, archer: 8, venomancer: 6, seeker: 7, wizard: 8, cleric: 8, barbarian: 7, mystic: 7, blademaster: 7 },
  '5': { assassin: 7, psychic: 7, archer: 8, venomancer: 5, seeker: 7, wizard: 9, cleric: 9, barbarian: 8, mystic: 8, blademaster: 8 },
  '6': { assassin: 6, psychic: 7, archer: 8, venomancer: 5, seeker: 7, wizard: 10, cleric: 10, barbarian: 9, mystic: 8, blademaster: 9 },
};

const BUILTIN: GearRules = {
  // стартова оцінка сили класу в ПвП 1.4.6 (до 10), однакова для всіх розмірів
  // паті — власник задає залежність від розміру в адмінці (є пресет)
  classPointsBySize: sameForAllSizes({ assassin: 10, psychic: 8, archer: 8, wizard: 7, cleric: 7, barbarian: 6, seeker: 6, mystic: 6, venomancer: 5, blademaster: 5 }),
  // ПА фіксований за грейдом (ЦГД 30, РЦГД 50, R9 30, R9R1 40, R9R2 50) — вшито в бали.
  // Рідкість на сервері (8 міс.): ЦГД ~5, РЦГД ~20, R9 1, R9R1 2, R9R2 2 — тому
  // великі розриви R8R → ЦГД (+15) і РЦГД → R9R2 (+15), решта лінійки між ними.
  weaponGrade: { other: 0, nirvana: 5, r8r: 10, cgd: 25, r9: 32, r9r1: 40, rcgd: 45, r9r2: 60 },
  // Відгук гільдії: R9-лінійка нерівна за класами — у фізиків (лук/танк/сін…) R9R1 з
  // абілкою вигідніша за РЦГД, у інтовиків стати R9R1 слабкі й РЦГД вигідніша.
  weaponGradeByClass: byClass({ r9: 36, r9r1: 50 }, { r9: 30, r9r1: 38 }),
  weaponRefine: { w0_5: 0, w6_7: 4, w8_9: 8, w10: 12, w11: 18, w12: 25 },
  weaponPz: 15,
  // чистий R8 прибрано (гірший за Нірвану); мікс = Нірвана з частинами R8R — посередині між ними
  armorSet: { other: 0, nirvana: 5, nirvana_r8_mix: 14, r8r: 22, r9: 35 },
  hiddenArmorSets: ['r9'],
  armorRefine: { a0_4: 0, a5: 3, a6: 7, a7: 11, a8: 17, a9: 23, a10: 27, a11: 29, a12: 30 },
  // 24 камені; повні Лагеря = 48 ПЗ (≈ різниця між топовим і слабким грейдом зброї) → max 40
  gems: { g0_9: 0, g10: 4, g11: 8, xuan: 14, xuan_pa: 20, pa: 26, xuan_camp: 33, camp: 40 },
  // камені у свап-сетах: половина таблиці за кожен сет, разом не більше 20
  specialSetGemsFactor: 0.5,
  specialSetGemsCap: 20,
  // свап-комплекти в тих самих слотах: активний один, решта — гнучкість
  specialSets: { pz: 15, pa: 12, aspd: 8 },
  specialSetsExtra: 5,
  specialSetsCap: 20,
  tract: { t1_3: 0, t4_5: 2, t6: 5, t7: 8, t8: 15, emperor: 20 },
  // джин за рівнем: 100/100 — не панацея, але й 71+/81+ уже щось важать
  genie: { g60: 0, g61_70: 2, g71_80: 4, g81_90: 6, g91_99: 8, g100: 10 },
  // ШГ 15 і Вознєс 10 за наявність, +5 за обидві разом, +1 за кожен рівень точки кожної
  shg: 15,
  voznes: 10,
  shgVoznesBonus: 5,
  shgRefinePerLevel: 1,
  voznesRefinePerLevel: 1,
  // Ело: +5 балів за кожні 100 пунктів понад 1000, не більше ±20 (рейтинг росте повільно: K=32)
  ratingWeight: 5,
  ratingCap: 20,
  // max 285 → S ≥ 225 · A 175 · B 130 · C 85 · D
  tiers: [
    { min: 225, tier: 'S' },
    { min: 175, tier: 'A' },
    { min: 130, tier: 'B' },
    { min: 85, tier: 'C' },
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
/** Матриця «клас × розмір»: нове поле classPointsBySize; старі версії мали один
 * ряд classPoints — розкладаємо його на всі розміри (скори тих версій не
 * змінюються). Відсутнє/зламане — з вбудованої. */
function classMatrix(r: Record<string, unknown>): Record<SizeBucket, Record<CharClass, number>> {
  const legacy = r.classPoints && typeof r.classPoints === 'object' ? numTable(r.classPoints, BUILTIN.classPointsBySize['2']) : null;
  const src = r.classPointsBySize && typeof r.classPointsBySize === 'object' ? (r.classPointsBySize as Record<string, unknown>) : null;
  const out = {} as Record<SizeBucket, Record<CharClass, number>>;
  for (const s of SIZE_BUCKETS) out[s] = numTable(src?.[s], legacy ?? BUILTIN.classPointsBySize[s]);
  return out;
}

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
  // перевизначення за класом: беремо лише числа для відомих класів/грейдів; відсутнє = дефолт
  const byCls = {} as Record<CharClass, Partial<Record<WeaponGrade, number>>>;
  const rawByCls = (r.weaponGradeByClass && typeof r.weaponGradeByClass === 'object' ? r.weaponGradeByClass : BUILTIN.weaponGradeByClass) as Record<string, unknown>;
  for (const c of Object.keys(BUILTIN.balance.roleOf) as CharClass[]) {
    const src = rawByCls[c];
    const out: Partial<Record<WeaponGrade, number>> = {};
    if (src && typeof src === 'object') {
      for (const g of Object.keys(BUILTIN.weaponGrade) as WeaponGrade[]) {
        const v = (src as Record<string, unknown>)[g];
        if (isNum(v)) out[g] = v;
      }
    }
    byCls[c] = out;
  }
  return {
    classPointsBySize: classMatrix(r),
    weaponGrade: numTable(r.weaponGrade, BUILTIN.weaponGrade),
    weaponGradeByClass: byCls,
    weaponRefine: numTable(r.weaponRefine, BUILTIN.weaponRefine),
    weaponPz: isNum(r.weaponPz) ? r.weaponPz : BUILTIN.weaponPz,
    armorSet: numTable(r.armorSet, BUILTIN.armorSet),
    hiddenArmorSets: hidden,
    armorRefine: numTable(r.armorRefine, BUILTIN.armorRefine),
    gems: numTable(r.gems, BUILTIN.gems),
    specialSetGemsFactor: isNum(r.specialSetGemsFactor) ? r.specialSetGemsFactor : BUILTIN.specialSetGemsFactor,
    specialSetGemsCap: isNum(r.specialSetGemsCap) ? r.specialSetGemsCap : BUILTIN.specialSetGemsCap,
    specialSets: numTable(r.specialSets, BUILTIN.specialSets),
    specialSetsExtra: isNum(r.specialSetsExtra) ? r.specialSetsExtra : BUILTIN.specialSetsExtra,
    specialSetsCap: isNum(r.specialSetsCap) ? r.specialSetsCap : BUILTIN.specialSetsCap,
    tract: numTable(r.tract, BUILTIN.tract),
    genie: numTable(r.genie, BUILTIN.genie),
    shg: isNum(r.shg) ? r.shg : BUILTIN.shg,
    voznes: isNum(r.voznes) ? r.voznes : BUILTIN.voznes,
    shgVoznesBonus: isNum(r.shgVoznesBonus) ? r.shgVoznesBonus : BUILTIN.shgVoznesBonus,
    shgRefinePerLevel: isNum(r.shgRefinePerLevel) ? r.shgRefinePerLevel : BUILTIN.shgRefinePerLevel,
    voznesRefinePerLevel: isNum(r.voznesRefinePerLevel) ? r.voznesRefinePerLevel : BUILTIN.voznesRefinePerLevel,
    ratingWeight: isNum(r.ratingWeight) ? r.ratingWeight : BUILTIN.ratingWeight,
    ratingCap: isNum(r.ratingCap) ? r.ratingCap : BUILTIN.ratingCap,
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

/** Бали за грейд зброї для конкретного класу: перевизначення або дефолт. */
export function weaponGradeScore(cls: CharClass, grade: WeaponGrade, r: ScoringRules): number {
  return r.weaponGradeByClass[cls]?.[grade] ?? r.weaponGrade[grade];
}

/** Камені у свап-сетах: factor × таблиця за кожен відмічений сет, разом ≤ cap. */
export function specialSetGemsScore(g: Pick<PlayerGear, 'specialSets' | 'specialSetGems'>, r: ScoringRules): number {
  const sum = Array.from(new Set(g.specialSets)).reduce((s, set) => s + r.specialSetGemsFactor * r.gems[g.specialSetGems[set] ?? 'g0_9'], 0);
  return Math.min(r.specialSetGemsCap, Math.round(sum));
}

/** Точка ШГ / Вознєса в анкеті: 0–12. */
export const ITEM_REFINE_MAX = 12;

/** ШГ і Вознєс: наявність + точка кожної, і бонус за обидві разом. */
export function shgVoznesScore(g: Pick<PlayerGear, 'shg' | 'shgRefine' | 'voznes' | 'voznesRefine'>, r: ScoringRules): number {
  const lvl = (n: number | null) => Math.max(0, Math.min(ITEM_REFINE_MAX, Math.round(n ?? 0)));
  return (
    (g.shg ? r.shg + r.shgRefinePerLevel * lvl(g.shgRefine) : 0) +
    (g.voznes ? r.voznes + r.voznesRefinePerLevel * lvl(g.voznesRefine) : 0) +
    (g.shg && g.voznes ? r.shgVoznesBonus : 0)
  );
}

/** Бали за клас для команди такого розміру. */
export function classPointsFor(r: ScoringRules, cls: CharClass, teamSize: number | null | undefined): number {
  return r.classPointsBySize[sizeBucket(teamSize)][cls];
}

/** teamSize — розмір команди турніру: від нього залежать бали за клас. */
export function computeGearScoreWith(g: PlayerGear, r: ScoringRules, teamSize: number | null | undefined): number {
  return (
    classPointsFor(r, g.charClass, teamSize) +
    weaponGradeScore(g.charClass, g.weaponGrade, r) +
    r.weaponRefine[g.weaponRefine] +
    (g.weaponPz ? r.weaponPz : 0) +
    r.armorSet[g.armorSet] +
    r.armorRefine[g.armorRefine] +
    r.gems[g.gems] +
    specialSetGemsScore(g, r) +
    specialSetsScore(g.specialSets, r) +
    r.tract[g.tract] +
    r.genie[g.genie] +
    shgVoznesScore(g, r)
  );
}

export function computeGearScore(g: PlayerGear, version: string | null | undefined, teamSize: number | null | undefined): number {
  return computeGearScoreWith(g, rulesFor(version), teamSize);
}

export function maxGearScoreOf(r: ScoringRules): number {
  const mx = (o: Record<string, number>) => Math.max(...Object.values(o));
  const maxWeapon = Math.max(mx(r.weaponGrade), ...Object.values(r.weaponGradeByClass).map((o) => (Object.keys(o).length ? mx(o as Record<string, number>) : 0)));
  const maxClass = Math.max(...SIZE_BUCKETS.map((s) => mx(r.classPointsBySize[s])));
  return maxClass + maxWeapon + mx(r.weaponRefine) + r.weaponPz + mx(r.armorSet) + mx(r.armorRefine) + mx(r.gems) + r.specialSetGemsCap + r.specialSetsCap + mx(r.tract) + mx(r.genie)
    + r.shg + r.voznes + r.shgVoznesBonus + ITEM_REFINE_MAX * (r.shgRefinePerLevel + r.voznesRefinePerLevel);
}

export function maxGearScore(version?: string | null): number {
  return maxGearScoreOf(rulesFor(version));
}

/** Бонус до скору за Ело-рейтинг: (rating − 1000) / 100 × ratingWeight, обмежено ± ratingCap. */
export function ratingBonus(rating: number | undefined, r: ScoringRules): number {
  if (rating === undefined || r.ratingWeight === 0) return 0;
  const raw = ((rating - 1000) / 100) * r.ratingWeight;
  return Math.round(Math.max(-r.ratingCap, Math.min(r.ratingCap, raw)));
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
  other: 'Інше / нижче Нірвани', nirvana: 'Нірвана', nirvana_r8_mix: 'Нірвана / R8R (мікс)', r8r: 'R8R', r9: 'R9',
};
export const ARMOR_SET_ORDER: ArmorSet[] = ['other', 'nirvana', 'nirvana_r8_mix', 'r8r', 'r9'];

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

export const GENIE_LABELS: Record<Genie, string> = { g60: 'до 60', g61_70: '61–70', g71_80: '71–80', g81_90: '81–90', g91_99: '91–99', g100: '100/100' };
export const GENIE_ORDER: Genie[] = ['g60', 'g61_70', 'g71_80', 'g81_90', 'g91_99', 'g100'];

export const ROLE_LABELS: Record<Role, string> = { support: 'Сапорт', tank: 'Танк', ranged: 'Дальній ДД', melee: 'Ближній ДД', control: 'Контроль' };

/** «ШГ +7, Вознєс +5» / «ШГ +7» / '' — для підсумку анкети. */
export function shgVoznesLabel(g: Pick<PlayerGear, 'shg' | 'shgRefine' | 'voznes' | 'voznesRefine'>): string {
  const parts: string[] = [];
  if (g.shg) parts.push(`ШГ +${g.shgRefine ?? 0}`);
  if (g.voznes) parts.push(`Вознєс +${g.voznesRefine ?? 0}`);
  return parts.join(', ');
}

const shortGems = (gems: Gems) => GEMS_LABELS[gems].replace(/ \(.*\)$/, '');

/** Компактний рядок для адмінки/публічної сторінки:
 * «ЦГД +10 · R8R +8 · Камні ПА · ПЗ-сет (Лагеря), Спів / Аспід (0–9) · Тракт 8 · Джин 100/100». */
export function gearSummary(g: PlayerGear, version?: string | null): string {
  void version;
  const parts: string[] = [];
  parts.push(`${WEAPON_GRADE_LABELS[g.weaponGrade]} ${WEAPON_REFINE_LABELS[g.weaponRefine]}${g.weaponPz ? ' + ПЗ-зброя' : ''}`);
  parts.push(`${ARMOR_SET_LABELS[g.armorSet]} ${ARMOR_REFINE_LABELS[g.armorRefine]}`);
  parts.push(`Камні ${shortGems(g.gems)}`);
  if (g.specialSets.length) {
    parts.push(SPECIAL_SET_ORDER.filter((s) => g.specialSets.includes(s)).map((s) => `${SPECIAL_SET_LABELS[s]} (${shortGems(g.specialSetGems[s] ?? 'g0_9')})`).join(', '));
  }
  parts.push(`Тракт ${TRACT_LABELS[g.tract].replace(/ \(.*\)$/, '').replace(' грейд', '')}`);
  parts.push(`Джин ${GENIE_LABELS[g.genie]}`);
  const items = shgVoznesLabel(g);
  if (items) parts.push(items);
  return parts.join(' · ');
}
