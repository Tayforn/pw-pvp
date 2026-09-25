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
  DollPower,
  ArmorRefine, ArmorSet, Build, CharClass, CharLevel, RingGrade, Gems, Genie, PlayerGear, SpecialSet, Tier, Tract, WeaponGrade, WeaponRefine,
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

/** Профіль класу для рольового шару: kill — власний урон (1 = реальний кілер,
 * без якого пачка не вбиває), amp — наскільки клас підсилює урон союзників
 * (Пурга/Amp/бафи). Обидва 0–1. */
export interface ClassProfile { kill: number; amp: number }

/** «Функціональність пачки» — окремий м'який шар поверх балансу за гіром
 * (розбір 17.09.2026). Сила пачки ≈ найкращий кілер × підсилювачі, а не
 * сума урону, тому:
 *  • killer — за пачку без реального кілера: (1 − max kill), понад неминуче;
 *  • twoThreats — за пачку з однією «загрозою» (kill ≥ threatMinKill), лише
 *    при S ≥ 3, понад неминуче: сфокусували єдиного ДД — пачка нічого не робить;
 *  • kpRange — за різницю kill pressure (max kill × (1 + amp тімейтів)) між
 *    командами: підсилювачі йдуть до середніх кілерів, топ отримує нейтральних.
 * Усі ваги 0 = шар вимкнено (так рахуються версії шкали до його появи). */
export interface CompositionRules {
  profiles: Record<CharClass, ClassProfile>;
  /** множник kill за збіркою гравця (анкета): кон у топ-шмоті не вбиває */
  buildKill: Record<Build, number>;
  threatMinKill: number;
  /** Частка, з якою в «зв'язку» команди входить урон другого і далі ДД:
   * другий ДД додає шкоди, але не збирається з першим в один бурст. */
  secondDd: number;
  /** Правило 4 (18.09.2026): «топовий ДД» — повний ДД зі скором не нижче цього
   * (за замовчуванням поріг рангу S). Такому не дають ні другого повного ДД,
   * ні підтримки тімейтів понад topSupportAllow (Страж 0.1 + один Прист/Танк/
   * Містик 0.5 = 0.6 можна, Друїд 1.0 — вже ні). */
  topDdMinScore: number;
  topSupportAllow: number;
  weights: { killer: number; twoThreats: number; kpRange: number; topSecondDd: number; topSupport: number };
  /** Правило 4 для пар (2×2) — окремий перемикач словами, бо у парі ваги
   * вище мертві: «дозвіл підтримки» там означає лише «Друїда не можна», а
   * вага 40 чи 100 дає побітово той самий розклад, що вимкнене правило.
   *  • 'legacy' — як для 3+: м'які ваги topSecondDd/topSupport (так рахуються
   *    версії шкали, збережені до появи поля — старі турніри біт-у-біт);
   *  • 'noSecondDd' — топовому ДД будь-кого, крім другого повного ДД; жорстко
   *    (+10 000 за пару з порушенням понад неминуче);
   *  • 'noSecondDdNoDruid' — те саме, плюс не Друїда (тімейт з amp ≥ 1);
   *  • 'off' — у парах правило 4 не діє, силу вирівнює лише сума.
   * Для команд 3+ поле не діє — там лишаються ваги. */
  pairsRule: PairsRule;
}

export type PairsRule = 'legacy' | 'noSecondDd' | 'noSecondDdNoDruid' | 'off';
export const PAIRS_RULES: PairsRule[] = ['noSecondDd', 'noSecondDdNoDruid', 'off', 'legacy'];
export const PAIRS_RULE_LABELS: Record<PairsRule, string> = {
  noSecondDd: 'Топовому ДД — будь-кого, крім другого повного ДД',
  noSecondDdNoDruid: 'Топовому ДД — будь-кого, крім другого ДД і Друїда',
  off: 'Вимкнено — у парах силу вирівнює лише сума',
  legacy: 'Як для 3+ (ваги; старі версії шкали)',
};

// ── Бафи тімейтів → «сила команди» ──────────────────────────────
//
// Сила команди = гір + бафи. Бафи — класові бафи на стати (Рев Танка, Аура
// сталі Воїна, бафи Приста …), виражені у відсотках сили ОТРИМУВАЧА: скільки
// урону/живучості клас-дарувальник додає союзнику. Це не те саме, що amp у
// профілях класів вище: amp — «наскільки клас тримає ДД живим і контролює
// ворога» (хіл, дебафи, зв'язка kp і правило 4), таблиця бафів — «наскільки
// клас підсилює стати союзника». Тому Танк і Прист є в обох: бафають (тут) і
// лікують/тримають (там) — це дві різні речі, а не подвійний облік.
// Власні самобафи в скор не входять: гравець бафає лише тімейтів.

/** Колонка таблиці: без КХ (за замовчуванням; відповідь власника) чи під КХ. */
export type KxMode = 'kx' | 'noKx';
/** Сторона шляху дарувальника: мудрець (rs) / демон (je). */
export type BuffSide = 'rs' | 'je';
/** Скільки % сили отримує фізичний / магічний союзник. */
export interface BuffCell { phys: number; mag: number }

export interface BuffRules {
  /** галочка «Враховувати бафи в силі команди» — єдиний вимикач у шкалі */
  enabled: boolean;
  /** яку колонку брати, коли правила турніру КХ не задають */
  defaultKx: KxMode;
  /** стеля сумарного бафу одному отримувачу, % (Танк 22 + Прист 15 + Воїн 10 = 47 → 40) */
  cap: number;
  /** сторона має значення: true → клітинка за стороною дарувальника (без сторони — max);
   * false → одна колонка = сильніша сторона (max(rs, je)) */
  bySide: boolean;
  /** частка бафів у силі за розміром команди, % ('5' = 5 і більше) — запобіжник
   * для масових форматів, де рівна сила сильно розводить гір */
  sizeWeight: Record<'2' | '3' | '4' | '5', number>;
  /** множити бафи на урон (kill) отримувача: Стражу, який не б'є, атакуючі бафи майже нічого не дають */
  killScaled: boolean;
  /** таблиця: дарувальник → колонка КХ → сторона → {фізикам, магам} */
  pct: Record<CharClass, Record<KxMode, Record<BuffSide, BuffCell>>>;
}

/** Параметри алгоритму формування команд (src/data/balance.ts). */
export interface BalanceRules {
  roleOf: Record<CharClass, Role>;
  composition: CompositionRules;
  /** бафи тімейтів — СУСІД composition, а не всередині: кнопка «Рекомендовані»
   * у редакторі замінює весь composition атомарно й не має мовчки вимикати бафи */
  buffs: BuffRules;
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
  /** Заявка персонажем: свап-сети, які знайшла лялька, ідуть у заявку й у бали.
   * Вимкнено — як у публічній анкеті, сети не рахуються (ПЗ-зброя — завжди). */
  setsFromDoll: boolean;
  /** Точка й камені з ляльки (заявка персонажем). */
  doll: DollGearRules;
  /** Скор прямо з характеристик ляльки (атака й живучість відносно еталона класу). */
  dollScore: DollScoreRules;
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
  /** Спільна стеля всього «запасного» спорядження: ПЗ-зброя + свап-сети + камені
   * в них разом. null — без спільної стелі (так рахуються версії до появи поля).
   * Навіщо: запасне не має важити більше за основний круг (сет R8R — 22 бали),
   * а без стелі повний набір свапів давав до 55. */
  swapTotalCap: number | null;
  tract: Record<Tract, number>;
  genie: Record<Genie, number>;
  /** рівень персонажа; версії до появи поля беруть таблицю вбудованої (анкети
   * без рівня рахуються як 90–100 = 0, тож їхні скори не змінюються) */
  level: Record<CharLevel, number>;
  /** ШГ і Вознєс: бали за саму наявність шмотки, бонус, якщо є обидві
   * (комплект), і бали за кожен рівень точки кожної. Версії, збережені до
   * появи цих полів, отримують значення вбудованої — анкет із цими шмотками
   * тоді ще не було, тож їхні скори від цього не змінюються. */
  shg: number;
  voznes: number;
  shgVoznesBonus: number;
  shgRefinePerLevel: number;
  voznesRefinePerLevel: number;
  /** Кільця: бали за грейд кожного з двох кілець і за рівень точки R9R1.
   * Версії до появи поля беруть вбудовані значення (старі анкети без кілець = 0). */
  rings: Record<RingGrade, number>;
  ringRefinePerLevel: number;
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

/** Клас каменя для балів — з каталогу ляльки: рівень (грейд) і що камінь дає в броні. */
export type GemClass = 'campPz' | 'topPa' | 'topOther' | 'g12' | 'g11' | 'g10' | 'low';
export const GEM_CLASS_ORDER: GemClass[] = ['campPz', 'topPa', 'topOther', 'g12', 'g11', 'g10', 'low'];
/** Короткі підписи класів каменів — для складу каменів у картках. */
export const GEM_CLASS_SHORT: Record<GemClass, string> = {
  campPz: 'ПЗ 13+', topPa: 'ПА 13+', topOther: 'інші 13+', g12: '12 рів.', g11: '11 рів.', g10: '10 рів.', low: '≤9 рів.',
};
/** Скільки каменів кожного класу в броні (з ляльки). */
export type GemCounts = Partial<Record<GemClass, number>>;

/** «12 рів. ×16 · ПЗ 13+ ×8» — склад каменів; '' — немає даних. */
export function gemMixLabel(c: GemCounts | null | undefined): string {
  if (!c) return '';
  return GEM_CLASS_ORDER.filter((k) => (c[k] ?? 0) > 0).map((k) => `${GEM_CLASS_SHORT[k]} ×${c[k]}`).join(' · ');
}

/** Склад каменів із бази — лише відомі класи й цілі 0..99. */
export function normalizeGemCounts(raw: unknown): GemCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const out: GemCounts = {};
  for (const k of GEM_CLASS_ORDER) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[k] = Math.min(99, Math.round(v));
  }
  return Object.keys(out).length ? out : null;
}
export const GEM_CLASS_LABELS: Record<GemClass, string> = {
  campPz: 'ПЗ-камені 13+ рівня (Лагеря, Государя, Цзин Юе…)',
  topPa: 'ПА-камені 13+ рівня (Світлого духу, Ракшаса…)',
  topOther: 'Інші камені 13+ рівня (HP, атака, спів…)',
  g12: 'Камені 12 рівня (Сюаньки, Нюйви, Пань Гу…)',
  g11: 'Камені 11 рівня',
  g10: 'Камені 10 рівня',
  low: 'Камені 9 рівня й нижче',
};

/** Звідки лялька бере точку броні й камені: лише Головний комплект чи всі
 * конфігурації (Головний + сети, середнє). */
export type DollScope = 'main' | 'all';

export interface DollGearRules {
  scope: DollScope;
  /** Бали за ОДИН камінь у броні за класом каменя; 24 гнізда броні разом —
   * це колишні «камені основного сету» (24 Лагеря = 40). */
  gemPoints: Record<GemClass, number>;
  /** Збірка з ляльки — за часткою вільних очок у Тілобудові: від hybrid — гібрид,
   * від con — кон, менше — ДД. */
  buildVit: { hybrid: number; con: number };
}

/** Бали за камінь = колишня таблиця «камені» ÷ 24 гнізда: Лагеря 40, ПА 26,
 * Сюаньки 14, 11 рівень 8, 10 рівень 4 (за повний набір). */
export const BUILTIN_DOLL_GEAR: DollGearRules = {
  scope: 'main',
  gemPoints: { campPz: 40 / 24, topPa: 26 / 24, topOther: 14 / 24, g12: 14 / 24, g11: 8 / 24, g10: 4 / 24, low: 0 },
  buildVit: { hybrid: 0.25, con: 0.5 },
};

function normalizeDollGear(raw: unknown): DollGearRules {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const gp = (d.gemPoints && typeof d.gemPoints === 'object' ? d.gemPoints : {}) as Record<string, unknown>;
  const gemPoints = {} as Record<GemClass, number>;
  for (const k of GEM_CLASS_ORDER) {
    const v = gp[k];
    gemPoints[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : BUILTIN_DOLL_GEAR.gemPoints[k];
  }
  const bv = (d.buildVit && typeof d.buildVit === 'object' ? d.buildVit : {}) as Record<string, unknown>;
  const share = (v: unknown, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : def);
  const hybrid = share(bv.hybrid, BUILTIN_DOLL_GEAR.buildVit.hybrid);
  const con = Math.max(hybrid, share(bv.con, BUILTIN_DOLL_GEAR.buildVit.con));
  return { scope: d.scope === 'all' ? 'all' : 'main', gemPoints, buildVit: { hybrid, con } };
}

/** Еталон класу для скору з ляльки: атака й живучість еталонної ляльки і
 * скільки балів спорядження вона має отримати. */
export interface DollRef {
  off: number;
  def: number;
  /** Бали спорядження еталона (без класу, джина, ШГ/Вознєса й запасного). */
  base: number;
  /** Звідки взято — ім'я персонажа (для адміна). */
  label: string;
  /** Абілка зброї еталона (код ac) — бонус гравця рахується відносно неї. */
  abil?: string;
}

/** off — не рахуємо; shadow — рахуємо й показуємо адміну, жеребка по анкеті;
 * on — у жеребці скор заявки персонажем береться з ляльки. */
export type DollScoreMode = 'off' | 'shadow' | 'on';

export interface DollScoreRules {
  mode: DollScoreMode;
  /** Бали за подвоєння сили відносно еталона. */
  perDouble: number;
  /** Частка атаки у скорі за збіркою (решта — живучість). */
  alphaByBuild: Record<Build, number>;
  /** Типовий суперник: його ПА (для живучості) і ПЗ (для атаки). */
  oppPa: number;
  oppPz: number;
  refs: Partial<Record<CharClass, DollRef>>;
  /** Бали за абілку основної зброї (код ac → бали; нема в списку — 0). Лялька
   * рахує лише стати, а абілки (зняття бафів, подвійний урон…) — ні. */
  abilityPoints: Record<string, number>;
}

/** Стартові бали за абілки топової зброї (300к репутації); решта — 0, адмін задає сам. */
export const RECOMMENDED_ABILITY_POINTS: Record<string, number> = { ka: 15, zl: 8, kl: 8 };

export const BUILTIN_DOLL_SCORE: DollScoreRules = {
  mode: 'off',
  perDouble: 50,
  alphaByBuild: { dd: 0.7, hybrid: 0.5, con: 0.3 },
  oppPa: 40,
  oppPz: 40,
  refs: {},
  abilityPoints: RECOMMENDED_ABILITY_POINTS,
};

const ABIL_CODE = /^[a-z_]{1,32}$/;
/** Бали за абілку гравця понад абілку еталона його класу. */
export function abilityBonus(r: ScoringRules, abil: string | undefined, refAbil: string | undefined): number {
  const pts = r.dollScore.abilityPoints;
  return (abil ? pts[abil] ?? 0 : 0) - (refAbil ? pts[refAbil] ?? 0 : 0);
}

function normalizeDollScore(raw: unknown): DollScoreRules {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const num = (v: unknown, def: number, min = 0) => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : def);
  const ab = (d.alphaByBuild && typeof d.alphaByBuild === 'object' ? d.alphaByBuild : {}) as Record<string, unknown>;
  const alphaByBuild = {} as Record<Build, number>;
  for (const b of ['dd', 'hybrid', 'con'] as Build[]) alphaByBuild[b] = Math.min(1, num(ab[b], BUILTIN_DOLL_SCORE.alphaByBuild[b]));
  const refs: Partial<Record<CharClass, DollRef>> = {};
  const rr = (d.refs && typeof d.refs === 'object' ? d.refs : {}) as Record<string, unknown>;
  for (const cls of Object.keys(rr)) {
    const x = rr[cls] as Record<string, unknown> | null;
    if (!x || typeof x !== 'object' || !(cls in BUILTIN_CLASS_PROFILES)) continue;
    const off = num(x.off, 0), def = num(x.def, 0);
    if (off <= 0 || def <= 0) continue;
    const abil = typeof x.abil === 'string' && ABIL_CODE.test(x.abil) ? x.abil : undefined;
    refs[cls as CharClass] = { off, def, base: num(x.base, 0, -1000), label: typeof x.label === 'string' ? x.label.slice(0, 40) : '', ...(abil ? { abil } : {}) };
  }
  let abilityPoints: Record<string, number> = { ...BUILTIN_DOLL_SCORE.abilityPoints };
  if (d.abilityPoints && typeof d.abilityPoints === 'object') {
    abilityPoints = {};
    for (const [k, v] of Object.entries(d.abilityPoints as Record<string, unknown>)) {
      if (ABIL_CODE.test(k) && typeof v === 'number' && Number.isFinite(v)) abilityPoints[k] = Math.max(-100, Math.min(100, Math.round(v)));
    }
  }
  const mode = d.mode === 'shadow' || d.mode === 'on' ? d.mode : 'off';
  return { mode, perDouble: num(d.perDouble, BUILTIN_DOLL_SCORE.perDouble), alphaByBuild, oppPa: num(d.oppPa, BUILTIN_DOLL_SCORE.oppPa), oppPz: num(d.oppPz, BUILTIN_DOLL_SCORE.oppPz), refs, abilityPoints };
}

/** Вбудована версія — фолбек і шаблон для нових версій. */
export const BUILTIN_RULES_VERSION = 'balance-v1.0';

/** Профілі класів (узгоджено з власником і відгуками гравців 17.09.2026):
 * кілери — Лук/Сін/Шаман/Маг; Танк — половинка (Армагеддон) і підсилювач
 * фізиків (бафи); Дру — головний підсилювач (Пурга/Amp), урону мало;
 * Страж — нейтральний наповнювач; Прист/Містик — сапорт. */
export const BUILTIN_CLASS_PROFILES: Record<CharClass, ClassProfile> = {
  archer: { kill: 1, amp: 0 }, assassin: { kill: 1, amp: 0 }, psychic: { kill: 1, amp: 0 }, wizard: { kill: 1, amp: 0 },
  barbarian: { kill: 0.5, amp: 0.5 }, blademaster: { kill: 0.5, amp: 0.3 }, seeker: { kill: 0.3, amp: 0.1 },
  cleric: { kill: 0.2, amp: 0.5 }, mystic: { kill: 0.3, amp: 0.5 }, venomancer: { kill: 0.2, amp: 1 },
};
/** Рекомендовані ваги шару (кнопка в редакторі); у вбудованій версії — нулі,
 * щоб версії, збережені до появи шару, рахувались як раніше. */
/** Підібрано на живому турнірі (24 гравці, 8×3): усі 20 seed без порушень, розкид гіру 15–19.
 * topSupport 100 (було 40): у 3×3 дає ті самі 20/20, але не «продає» Друїда
 * топу за 16 балів гіру (синтез 24.09.2026). */
export const RECOMMENDED_COMPOSITION_WEIGHTS = { killer: 30, twoThreats: 10, kpRange: 10, topSecondDd: 60, topSupport: 100 };
/** «Профіль сили» (weights.top) заважає правилу 4 у малих командах — рекомендовано 0.25 замість 1. */
export const RECOMMENDED_TOP_PROFILE_WEIGHT = 0.25;
/** Рекомендоване положення правила 4 для пар — окремою константою, щоб кнопка
 * «Рекомендовані» могла взяти його разом із вагами. */
export const RECOMMENDED_PAIRS_RULE: PairsRule = 'noSecondDd';
export const BUILTIN_COMPOSITION: CompositionRules = {
  profiles: BUILTIN_CLASS_PROFILES,
  buildKill: { dd: 1, hybrid: 0.7, con: 0.4 },
  threatMinKill: 0.5,
  secondDd: 0.5,
  topDdMinScore: 225,
  topSupportAllow: 0.6,
  weights: { killer: 0, twoThreats: 0, kpRange: 0, topSecondDd: 0, topSupport: 0 },
  // 'legacy' у вбудованій: версії до появи поля рахують пари як 3+ (біт-у-біт)
  pairsRule: 'legacy',
};

/** Профіль гравця для алгоритму: клас × збірка (без збірки — як ДД). */
export function playerProfile(cls: CharClass, build: Build | null | undefined, comp: CompositionRules): ClassProfile {
  const p = comp.profiles[cls];
  return { kill: p.kill * comp.buildKill[build ?? 'dd'], amp: p.amp };
}

/** Фізичні класи (Лучник, Сін, Воїн, Танк, Страж): на їхніх R9 / R9R1 абілка
 * важить більше, ніж +ПА РЦГД, і бафи вони отримують за колонкою «фізикам».
 * Решта — маги (Маг, Прист, Шаман, Друїд, Містик). */
export const PHYS_CLASSES: CharClass[] = ['archer', 'assassin', 'blademaster', 'barbarian', 'seeker'];
/** @deprecated стара назва — те саме, що PHYS_CLASSES */
export const PHYSICAL_CLASSES: CharClass[] = PHYS_CLASSES;
const CASTER_CLASSES: CharClass[] = ['wizard', 'cleric', 'psychic', 'venomancer', 'mystic'];
const PHYS_SET = new Set<CharClass>(PHYS_CLASSES);
export function isPhysClass(cls: CharClass): boolean {
  return PHYS_SET.has(cls);
}

const cell = (phys: number, mag: number): BuffCell => ({ phys, mag });
/** Рядок таблиці: [без КХ мудрець, без КХ демон, під КХ мудрець, під КХ демон].
 * Клітинки копіюються, щоб жодні дві клітинки не були одним об'єктом — інакше
 * правка чернетки в редакторі зіпсувала б вбудовану й рекомендовану таблиці. */
const buffRow = (nRs: BuffCell, nJe: BuffCell, kRs: BuffCell, kJe: BuffCell): Record<KxMode, Record<BuffSide, BuffCell>> =>
  ({ noKx: { rs: { ...nRs }, je: { ...nJe } }, kx: { rs: { ...kRs }, je: { ...kJe } } });
/** Однакова клітинка в усіх чотирьох колонках (клас без залежності від сторони/КХ). */
const buffFlat = (c: BuffCell) => buffRow(c, c, c, c);
const ZERO_CELL = cell(0, 0);

/** Рекомендована таблиця бафів (шлях 11-го рівня, найсильніша сторона; за
 * відповіддю власника шлях на 100+ є у всіх). Одиниця — % сили отримувача.
 * Числа Танка/Приста/Воїна — з рушія ляльки (pathscan), під КХ для Танка/Воїна
 * — ПРИПУЩЕННЯ; Страж 2/2 підтверджено власником.
 * Друїд 20/20 — ПРИПУЩЕННЯ (питання власнику): Пурга / Amp / дебафи як
 * підсилення урону союзника, КХ на них не впливає. Без цього рядка жеребка у
 * 2×2 завжди садить найслабшого Друїда до найсильнішого ДД (розкид сили 44), а
 * правило 4 при цьому мусить його забороняти — рядок 20 % знімає конфлікт.
 * Містик 0: його хіли вже в «Підтримці» (amp 0.5), бафів на стати він не дає. */
export const RECOMMENDED_BUFFS_PCT: Record<CharClass, Record<KxMode, Record<BuffSide, BuffCell>>> = {
  barbarian: buffRow(cell(22, 16), cell(21, 16), cell(15, 10), cell(14, 10)),
  cleric: buffRow(cell(15, 19), cell(15, 19), cell(11, 16), cell(11, 16)),
  blademaster: buffRow(cell(10, 8), cell(8, 7), cell(8, 6), cell(7, 6)),
  seeker: buffFlat(cell(2, 2)),
  mystic: buffFlat(ZERO_CELL),
  wizard: buffFlat(cell(1, 0)),
  archer: buffFlat(cell(1, 1)),
  assassin: buffFlat(ZERO_CELL),
  psychic: buffFlat(ZERO_CELL),
  venomancer: buffFlat(cell(20, 20)),
};

const zeroBuffsPct = (): BuffRules['pct'] => {
  const out = {} as BuffRules['pct'];
  for (const c of Object.keys(BUILTIN_CLASS_PROFILES) as CharClass[]) out[c] = buffFlat(ZERO_CELL);
  return out;
};

/** Вбудований блок бафів — вимкнено й нулі: версії шкали, збережені до появи
 * блоку, рахують силу = гір, тобто рівно як раніше. */
export const BUILTIN_BUFFS: BuffRules = {
  enabled: false,
  defaultKx: 'noKx',
  cap: 40,
  bySide: false,
  sizeWeight: { '2': 100, '3': 100, '4': 100, '5': 100 },
  killScaled: false,
  pct: zeroBuffsPct(),
};

const isKx = (x: unknown): x is KxMode => x === 'kx' || x === 'noKx';

/** Блок бафів із JSON версії: відсутній/зламаний → BUILTIN_BUFFS (вимкнено);
 * кожна клітинка окремо — число або 0, щоб напівзаповнена таблиця не ламала підрахунок. */
export function normalizeBuffs(raw: unknown): BuffRules {
  if (!raw || typeof raw !== 'object') return { ...BUILTIN_BUFFS, sizeWeight: { ...BUILTIN_BUFFS.sizeWeight }, pct: zeroBuffsPct() };
  const b = raw as Record<string, unknown>;
  const rawPct = (b.pct && typeof b.pct === 'object' ? b.pct : {}) as Record<string, unknown>;
  const pct = {} as BuffRules['pct'];
  for (const c of Object.keys(BUILTIN_CLASS_PROFILES) as CharClass[]) {
    const byKx = (rawPct[c] && typeof rawPct[c] === 'object' ? rawPct[c] : {}) as Record<string, unknown>;
    const row = {} as Record<KxMode, Record<BuffSide, BuffCell>>;
    for (const kx of ['noKx', 'kx'] as KxMode[]) {
      const bySide = (byKx[kx] && typeof byKx[kx] === 'object' ? byKx[kx] : {}) as Record<string, unknown>;
      const sides = {} as Record<BuffSide, BuffCell>;
      for (const side of ['rs', 'je'] as BuffSide[]) {
        const v = (bySide[side] && typeof bySide[side] === 'object' ? bySide[side] : {}) as Record<string, unknown>;
        sides[side] = { phys: isNum(v.phys) ? v.phys : 0, mag: isNum(v.mag) ? v.mag : 0 };
      }
      row[kx] = sides;
    }
    pct[c] = row;
  }
  const sw = (b.sizeWeight && typeof b.sizeWeight === 'object' ? b.sizeWeight : {}) as Record<string, unknown>;
  const sizeWeight = {} as BuffRules['sizeWeight'];
  for (const k of ['2', '3', '4', '5'] as const) sizeWeight[k] = isNum(sw[k]) ? sw[k] : BUILTIN_BUFFS.sizeWeight[k];
  return {
    enabled: b.enabled === true,
    defaultKx: isKx(b.defaultKx) ? b.defaultKx : BUILTIN_BUFFS.defaultKx,
    cap: isNum(b.cap) ? b.cap : BUILTIN_BUFFS.cap,
    bySide: b.bySide === true,
    sizeWeight,
    killScaled: b.killScaled === true,
    pct,
  };
}

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
  setsFromDoll: false,
  doll: BUILTIN_DOLL_GEAR,
  dollScore: BUILTIN_DOLL_SCORE,
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
  swapTotalCap: null,
  tract: { t1_3: 0, t4_5: 2, t6: 5, t7: 8, t8: 15, emperor: 20 },
  // джин за рівнем: 100/100 — не панацея, але й 71+/81+ уже щось важать
  genie: { g60: 0, g61_70: 2, g71_80: 4, g81_90: 6, g91_99: 8, g100: 10 },
  // рівень: до 100 — 0, далі кожен рівень дорожчає
  level: { l90_100: 0, l101: 1, l102: 2, l103: 4, l104: 7, l105: 10 },
  // ШГ 15 і Вознєс 10 за наявність, +5 за обидві разом, +1 за кожен рівень точки кожної
  shg: 15,
  voznes: 10,
  shgVoznesBonus: 5,
  shgRefinePerLevel: 1,
  voznesRefinePerLevel: 1,
  // кільця (за кожне з двох): Луна і нижче 0 · ПКС/Долоня 3 · Срібний місяць/Північна зірка 6 · R9 9 · R9R1 12 + 1 за рівень точки
  rings: { moon: 0, pks: 3, silver: 6, r9: 9, r9r1: 12 },
  ringRefinePerLevel: 1,
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
    composition: BUILTIN_COMPOSITION,
    buffs: BUILTIN_BUFFS,
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

const isPairsRule = (x: unknown): x is PairsRule => typeof x === 'string' && (PAIRS_RULES as string[]).includes(x);

/** Шар «функціональність пачки»: відсутній у версії → вбудований (ваги 0 = вимкнено).
 * pairsRule відсутній/зламаний → 'legacy', щоб старі версії рахували пари як досі. */
export function normalizeComposition(raw: unknown): CompositionRules {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rawProf = (c.profiles && typeof c.profiles === 'object' ? c.profiles : {}) as Record<string, unknown>;
  const profiles = {} as Record<CharClass, ClassProfile>;
  for (const cls of Object.keys(BUILTIN_CLASS_PROFILES) as CharClass[]) {
    const p = (rawProf[cls] && typeof rawProf[cls] === 'object' ? rawProf[cls] : {}) as Record<string, unknown>;
    profiles[cls] = { kill: isNum(p.kill) ? p.kill : BUILTIN_CLASS_PROFILES[cls].kill, amp: isNum(p.amp) ? p.amp : BUILTIN_CLASS_PROFILES[cls].amp };
  }
  const w = (c.weights && typeof c.weights === 'object' ? c.weights : {}) as Record<string, unknown>;
  return {
    profiles,
    buildKill: numTable(c.buildKill, BUILTIN_COMPOSITION.buildKill),
    threatMinKill: isNum(c.threatMinKill) ? c.threatMinKill : BUILTIN_COMPOSITION.threatMinKill,
    secondDd: isNum(c.secondDd) ? c.secondDd : BUILTIN_COMPOSITION.secondDd,
    topDdMinScore: isNum(c.topDdMinScore) ? c.topDdMinScore : BUILTIN_COMPOSITION.topDdMinScore,
    topSupportAllow: isNum(c.topSupportAllow) ? c.topSupportAllow : BUILTIN_COMPOSITION.topSupportAllow,
    weights: {
      killer: isNum(w.killer) ? w.killer : 0,
      twoThreats: isNum(w.twoThreats) ? w.twoThreats : 0,
      kpRange: isNum(w.kpRange) ? w.kpRange : 0,
      topSecondDd: isNum(w.topSecondDd) ? w.topSecondDd : 0,
      topSupport: isNum(w.topSupport) ? w.topSupport : 0,
    },
    pairsRule: isPairsRule(c.pairsRule) ? c.pairsRule : 'legacy',
  };
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
    setsFromDoll: r.setsFromDoll === true,
    doll: normalizeDollGear(r.doll),
    dollScore: normalizeDollScore(r.dollScore),
    armorRefine: numTable(r.armorRefine, BUILTIN.armorRefine),
    gems: numTable(r.gems, BUILTIN.gems),
    specialSetGemsFactor: isNum(r.specialSetGemsFactor) ? r.specialSetGemsFactor : BUILTIN.specialSetGemsFactor,
    specialSetGemsCap: isNum(r.specialSetGemsCap) ? r.specialSetGemsCap : BUILTIN.specialSetGemsCap,
    specialSets: numTable(r.specialSets, BUILTIN.specialSets),
    specialSetsExtra: isNum(r.specialSetsExtra) ? r.specialSetsExtra : BUILTIN.specialSetsExtra,
    specialSetsCap: isNum(r.specialSetsCap) ? r.specialSetsCap : BUILTIN.specialSetsCap,
    swapTotalCap: isNum(r.swapTotalCap) && r.swapTotalCap >= 0 ? r.swapTotalCap : null,
    tract: numTable(r.tract, BUILTIN.tract),
    genie: numTable(r.genie, BUILTIN.genie),
    level: numTable(r.level, BUILTIN.level),
    shg: isNum(r.shg) ? r.shg : BUILTIN.shg,
    voznes: isNum(r.voznes) ? r.voznes : BUILTIN.voznes,
    shgVoznesBonus: isNum(r.shgVoznesBonus) ? r.shgVoznesBonus : BUILTIN.shgVoznesBonus,
    shgRefinePerLevel: isNum(r.shgRefinePerLevel) ? r.shgRefinePerLevel : BUILTIN.shgRefinePerLevel,
    voznesRefinePerLevel: isNum(r.voznesRefinePerLevel) ? r.voznesRefinePerLevel : BUILTIN.voznesRefinePerLevel,
    rings: numTable(r.rings, BUILTIN.rings),
    ringRefinePerLevel: isNum(r.ringRefinePerLevel) ? r.ringRefinePerLevel : BUILTIN.ringRefinePerLevel,
    ratingWeight: isNum(r.ratingWeight) ? r.ratingWeight : BUILTIN.ratingWeight,
    ratingCap: isNum(r.ratingCap) ? r.ratingCap : BUILTIN.ratingCap,
    tiers: validTiers ? tiers : BUILTIN.tiers.map((t) => ({ ...t })),
    balance: {
      roleOf: { ...BUILTIN.balance.roleOf, ...((b.roleOf && typeof b.roleOf === 'object' ? b.roleOf : {}) as Partial<Record<CharClass, Role>>) },
      composition: normalizeComposition(b.composition),
      buffs: normalizeBuffs(b.buffs),
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

/** Рекомендована спільна стеля запасного спорядження (порядку сету R8R). */
export const RECOMMENDED_SWAP_TOTAL_CAP = 25;

/** Усе «запасне» разом: ПЗ-зброя + свап-сети + камені в них, не більше спільної стелі. */
export function swapScore(g: Pick<PlayerGear, 'weaponPz' | 'specialSets' | 'specialSetGems'>, r: ScoringRules): number {
  const sum = (g.weaponPz ? r.weaponPz : 0) + specialSetGemsScore(g, r) + specialSetsScore(g.specialSets, r);
  return r.swapTotalCap == null ? sum : Math.min(r.swapTotalCap, sum);
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

/** Кільця: грейд кожного з двох + точка для R9R1. Без кілець (старі анкети) — 0. */
export function ringsScore(g: Pick<PlayerGear, 'ring1' | 'ring1Refine' | 'ring2' | 'ring2Refine'>, r: ScoringRules): number {
  const one = (grade: RingGrade | null, refine: number | null) => {
    if (!grade) return 0;
    const lvl = grade === 'r9r1' ? Math.max(0, Math.min(ITEM_REFINE_MAX, Math.round(refine ?? 0))) : 0;
    return r.rings[grade] + r.ringRefinePerLevel * lvl;
  };
  return one(g.ring1, g.ring1Refine) + one(g.ring2, g.ring2Refine);
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
    swapScore(g, r) +
    r.armorSet[g.armorSet] +
    r.armorRefine[g.armorRefine] +
    r.gems[g.gems] +
    r.tract[g.tract] +
    r.genie[g.genie] +
    r.level[g.charLevel ?? 'l90_100'] +
    shgVoznesScore(g, r) +
    ringsScore(g, r)
  );
}

/**
 * Скор із ляльки: бали класу + бали спорядження з атаки й живучості відносно
 * еталона класу (+ бонус за абілку зброї понад еталон) + джин + ШГ/Вознєс +
 * запасне (сети, ПЗ-зброя). Грейди зброї,
 * броні, камені, точки, кільця, трактат і рівень уже сидять у характеристиках.
 * null — немає еталона для класу.
 */
export function dollGearScoreWith(g: PlayerGear, power: DollPower, r: ScoringRules, teamSize: number | null | undefined): number | null {
  const ref = r.dollScore.refs[g.charClass];
  if (!ref || power.off <= 0 || power.def <= 0) return null;
  const alpha = r.dollScore.alphaByBuild[g.build ?? 'dd'];
  const rel = alpha * Math.log2(power.off / ref.off) + (1 - alpha) * Math.log2(power.def / ref.def);
  const gearPart = Math.max(0, ref.base + r.dollScore.perDouble * rel + abilityBonus(r, power.abil, ref.abil));
  return Math.round(classPointsFor(r, g.charClass, teamSize) + gearPart + r.genie[g.genie] + shgVoznesScore(g, r) + swapScore(g, r));
}

/** Бали спорядження еталона за таблицею — те, що скор з ляльки замінює (без класу, джина, ШГ/Вознєса, запасного). */
export function tableGearPartWith(g: PlayerGear, r: ScoringRules, teamSize: number | null | undefined): number {
  return computeGearScoreWith(g, r, teamSize) - classPointsFor(r, g.charClass, teamSize) - r.genie[g.genie] - shgVoznesScore(g, r) - swapScore(g, r);
}

export function computeGearScore(g: PlayerGear, version: string | null | undefined, teamSize: number | null | undefined): number {
  return computeGearScoreWith(g, rulesFor(version), teamSize);
}

export function maxGearScoreOf(r: ScoringRules): number {
  const mx = (o: Record<string, number>) => Math.max(...Object.values(o));
  const maxWeapon = Math.max(mx(r.weaponGrade), ...Object.values(r.weaponGradeByClass).map((o) => (Object.keys(o).length ? mx(o as Record<string, number>) : 0)));
  const maxClass = Math.max(...SIZE_BUCKETS.map((s) => mx(r.classPointsBySize[s])));
  const swapMax = r.weaponPz + r.specialSetGemsCap + r.specialSetsCap;
  return maxClass + maxWeapon + mx(r.weaponRefine) + (r.swapTotalCap == null ? swapMax : Math.min(r.swapTotalCap, swapMax)) + mx(r.armorSet) + mx(r.armorRefine) + mx(r.gems) + mx(r.tract) + mx(r.genie) + mx(r.level)
    + r.shg + r.voznes + r.shgVoznesBonus + ITEM_REFINE_MAX * (r.shgRefinePerLevel + r.voznesRefinePerLevel)
    + 2 * (mx(r.rings) + ITEM_REFINE_MAX * r.ringRefinePerLevel);
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

export const SPECIAL_SET_LABELS: Record<SpecialSet, string> = { pz: 'ПЗ-сет', pa: 'ПА-сет', aspd: 'Спів-сет' };
export const SPECIAL_SET_HINTS: Record<SpecialSet, string> = {
  pz: 'сумарний показник захисту у комплекті ≥ 30 (без бафів)',
  pa: 'сумарний показник атаки у комплекті ≥ 30 (без бафів)',
  aspd: '−30 % часу співу з предметів (без бафів)',
};
export const SPECIAL_SET_ORDER: SpecialSet[] = ['pz', 'pa', 'aspd'];

export const TRACT_LABELS: Record<Tract, string> = {
  t1_3: '1–3 грейд', t4_5: '4–5 грейд', t6: '6 грейд (Пань Гу)', t7: '7 грейд', t8: '8 грейд (Гегемонія)', emperor: 'Імператор і вище',
};
export const TRACT_ORDER: Tract[] = ['t1_3', 't4_5', 't6', 't7', 't8', 'emperor'];

export const GENIE_LABELS: Record<Genie, string> = { g60: 'до 60', g61_70: '61–70', g71_80: '71–80', g81_90: '81–90', g91_99: '91–99', g100: '100/100' };
export const GENIE_ORDER: Genie[] = ['g60', 'g61_70', 'g71_80', 'g81_90', 'g91_99', 'g100'];

export const BUILD_LABELS: Record<Build, string> = { dd: 'ДД', hybrid: 'Гібрид', con: 'Кон' };
export const BUILD_ORDER: Build[] = ['dd', 'hybrid', 'con'];

export const CHAR_LEVEL_LABELS: Record<CharLevel, string> = { l90_100: '90–100', l101: '101', l102: '102', l103: '103', l104: '104', l105: '105' };
export const CHAR_LEVEL_ORDER: CharLevel[] = ['l90_100', 'l101', 'l102', 'l103', 'l104', 'l105'];

export const ROLE_LABELS: Record<Role, string> = { support: 'Сапорт', tank: 'Танк', ranged: 'Дальній ДД', melee: 'Ближній ДД', control: 'Контроль' };

export const RING_LABELS: Record<RingGrade, string> = {
  moon: 'Луна і нижче', pks: 'ПКС / Долоня', silver: 'Срібний місяць / Північна зірка', r9: 'R9', r9r1: 'R9R1',
};
export const RING_ORDER: RingGrade[] = ['moon', 'pks', 'silver', 'r9', 'r9r1'];

/** «R9R1 +5, R9» / '' — кільця для підсумку анкети. */
export function ringsLabel(g: Pick<PlayerGear, 'ring1' | 'ring1Refine' | 'ring2' | 'ring2Refine'>): string {
  const one = (grade: RingGrade | null, refine: number | null) => (grade ? `${RING_LABELS[grade].split(' / ')[0]}${grade === 'r9r1' ? ` +${refine ?? 0}` : ''}` : '');
  return [one(g.ring1, g.ring1Refine), one(g.ring2, g.ring2Refine)].filter(Boolean).join(', ');
}

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
/** Спорядження по полях — для карток (попап «Лялька актуальна?»). Ті самі підписи, що в gearSummary. */
export function gearParts(g: PlayerGear, gemsMix?: string): Array<{ key: string; label: string; value: string }> {
  const out: Array<{ key: string; label: string; value: string }> = [
    { key: 'weapon', label: 'Зброя', value: `${WEAPON_GRADE_LABELS[g.weaponGrade]} ${WEAPON_REFINE_LABELS[g.weaponRefine]}${g.weaponPz ? ' + ПЗ-зброя' : ''}` },
    { key: 'armor', label: 'Броня', value: `${ARMOR_SET_LABELS[g.armorSet]} ${ARMOR_REFINE_LABELS[g.armorRefine]}` },
    { key: 'gems', label: 'Камені', value: gemsMix ? `${gemsMix} → бали як «${shortGems(g.gems)}»` : shortGems(g.gems) },
    { key: 'tract', label: 'Трактат', value: TRACT_LABELS[g.tract].replace(/ \(.*\)$/, '').replace(' грейд', '') },
    { key: 'genie', label: 'Джин', value: GENIE_LABELS[g.genie] },
  ];
  const items = shgVoznesLabel(g);
  if (items) out.push({ key: 'shg', label: 'ШГ / Вознєс', value: items });
  const rings = ringsLabel(g);
  if (rings) out.push({ key: 'rings', label: 'Кільця', value: rings });
  return out;
}

export function gearSummary(g: PlayerGear, version?: string | null, gemsMix?: string): string {
  void version;
  const parts: string[] = [];
  if (g.charLevel) parts.push(`Рівень ${CHAR_LEVEL_LABELS[g.charLevel]}`);
  if (g.build && g.build !== 'dd') parts.push(`Збірка: ${BUILD_LABELS[g.build]}`);
  parts.push(`${WEAPON_GRADE_LABELS[g.weaponGrade]} ${WEAPON_REFINE_LABELS[g.weaponRefine]}${g.weaponPz ? ' + ПЗ-зброя' : ''}`);
  parts.push(`${ARMOR_SET_LABELS[g.armorSet]} ${ARMOR_REFINE_LABELS[g.armorRefine]}`);
  parts.push(gemsMix ? `Камені ${gemsMix} (бали як «${shortGems(g.gems)}»)` : `Камні ${shortGems(g.gems)}`);
  if (g.specialSets.length) {
    parts.push(SPECIAL_SET_ORDER.filter((s) => g.specialSets.includes(s)).map((s) => `${SPECIAL_SET_LABELS[s]} (${shortGems(g.specialSetGems[s] ?? 'g0_9')})`).join(', '));
  }
  parts.push(`Тракт ${TRACT_LABELS[g.tract].replace(/ \(.*\)$/, '').replace(' грейд', '')}`);
  parts.push(`Джин ${GENIE_LABELS[g.genie]}`);
  const items = shgVoznesLabel(g);
  if (items) parts.push(items);
  const rings = ringsLabel(g);
  if (rings) parts.push(`Кільця ${rings}`);
  return parts.join(' · ');
}
