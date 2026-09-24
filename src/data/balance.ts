// =========================================================
// pw-pvp: формування збалансованих випадкових команд («Балансний
// фул-рандом»). Чистий модуль — без Supabase і DOM; детермінований за
// seed: той самий набір гравців + seed + версія правил → той самий
// результат (перевіряється тестом).
//
// Схема (docs/balanced-random-analysis.md §3.2):
//   0. канонізація входу (сортування за id) + seeded PRNG (sfc32/cyrb128);
//   A. конструктивний старт — гравці по бакетах за класом, роздача по колу
//      так, що клас у команді не повторюється, якщо це взагалі можливо;
//   B. локальний пошук парними свопами (simulated annealing) з інваріантом
//      «кількість дублів класу в команді не зростає»;
//   штраф — на впорядкованих статистиках (діапазони сум top-1, top-2, …),
//      без tier-порогів: ловить «стек» топів при рівних сумах;
//   + шар «функціональність пачки» (teams-ls-v2, rules.composition): є кілер,
//      дві загрози, вирівнювання kill pressure — м'які члени понад неминуче;
//   + сила команди (teams-ls-v5, rules.buffs): сила = гір + бафи тімейтів
//      (класові бафи на стати, у % сили отримувача — buffPctTo). Коли бафи
//      увімкнено, повна сума і стандартне відхилення вирівнюються за силою;
//      «профіль сили» top-k лишається на сирих скорах, бо стек топів — про
//      гір, а не про бафи. Силу в знімок не пишемо: після заміни гравця RPC
//      перераховує лише гір, тож сила рахується при читанні зі складу
//      (teamStrengthFromSnapshot) — інакше публічна цифра брехала б;
//   + правило 4 для пар (composition.pairsRule): у 2×2 замість м'яких ваг —
//      жорстка заборона другого повного ДД (і, за вибором, Друїда) топовому
//      ДД, понад неминуче для пулу (Unavoidable.pairViol); для 3+ — ваги як
//      досі. Режим обирається за розміром команди турніру S, не за team.length
//      (після «прибрати без заміни» трійка стає парою, але правила — ті самі);
//   вибір — випадковий серед різних розв'язків у ε-коридорі від найкращого,
//      щоб той самий пул не давав завжди один і той самий склад.
// Чому не «10 000 випадкових → фільтр» зі спеки — див. §2.5 документа.
// =========================================================

import type { BalanceSnapshot, CharClass } from './types';
import { ROLES, isPhysClass, type BalanceRules, type BuffRules, type BuffSide, type KxMode, type Role } from './gearRules';
import type { BuffOptions } from './ruleFlags';

export const ALGO_VERSION = 'teams-ls-v5';

/** Повний ДД — kill не нижче цього (Лук/Сін/Шаман/Маг у ДД-збірці). */
export const FULL_DD_KILL = 0.8;
/** «Друїд» для правила 4 у парах — тімейт із підсиленням не нижче цього (профіль venomancer: amp 1). */
export const DRUID_AMP = 1;
/** Жорстке правило 4 для пар: стільки за кожну пару з порушенням понад неминуче. */
export const PAIR_HARD_PENALTY = 10000;
const EPS = 1e-9;

export interface BalancePlayer {
  id: string;
  nickname: string;
  cls: CharClass;
  score: number;
  /** Профіль для рольового шару (gearRules.playerProfile: клас × збірка). */
  kill: number;
  amp: number;
  /** ISO — для політики резерву 'latest' */
  createdAt: string;
  /** Сторона шляху (мудрець / демон) для таблиці бафів за стороною; null або
   * відсутня — береться сильніша сторона. Анкета поки сторону не питає. */
  side?: BuffSide | null;
}

export type ReservePolicy = 'latest' | 'random' | 'manual';

export interface FormTeamsOptions {
  teamSize: number;
  seed: string;
  rules: BalanceRules;
  rulesVersion: string;
  /** кількість команд; дефолт ⌊N/S⌋ (double_elim потребує степінь двійки ≥ 4 — задає UI) */
  teamCount?: number;
  restarts?: number;
  iterations?: number;
  /** хто йде в резерв при N > K·S: 'latest' (дефолт) — останні за created_at;
   * 'random' — seeded; 'manual' — pinnedReserveIds, решта добирається як 'latest' */
  reservePolicy?: ReservePolicy;
  pinnedReserveIds?: string[];
  /** бафи за правилами турніру (ruleFlags.resolveBuffOptions); без них — «від
   * своєї пачки» з колонкою КХ за замовчуванням зі шкали */
  buffs?: BuffOptions;
}

/** Що саме рахувати в силі: чи бафи взагалі увімкнені (галочка у шкалі × правила
 * турніру), яку колонку КХ брати і розмір команди турніру S (частка бафів за розміром). */
export interface BuffCtx {
  enabled: boolean;
  kx: KxMode;
  S: number;
}

export function buffCtxFor(rules: BalanceRules, buffs: BuffOptions | undefined, S: number): BuffCtx {
  return {
    enabled: rules.buffs.enabled && (buffs?.source ?? 'party') === 'party',
    kx: buffs?.kx ?? rules.buffs.defaultKx,
    S,
  };
}

export interface TeamStats {
  /** префіксні суми score за спаданням: prefix[k-1] = сума k найсильніших */
  prefix: number[];
  total: number;
  /** бафи тімейтів у балах (Σ score × % бафу отримувачу) і сила = total + buff;
   * при вимкнених бафах — 0 і рівно total */
  buff: number;
  strength: number;
  /** дублікати класів у команді (Σ_c max(0, count_c − 1)) */
  dup: number;
  roleCount: Record<Role, number>;
  /** найкращий кілер пачки (0–1); 1 − maxKill = «нестача кілера» */
  maxKill: number;
  /** гравців із kill ≥ threatMinKill */
  threats: number;
  /** Правило 4: топовий ДД команди (повний ДД зі скором ≥ topDdMinScore; якщо
   * таких кілька — найсильніший) — скільки поруч інших повних ДД і наскільки
   * підтримка тімейтів перевищує дозволену. Без топового ДД — 0 і 0. */
  topDd: number;
  topSupportOver: number;
  /** найбільша «Підтримка» (amp) серед тімейтів топового ДД — для положення
   * «…і не Друїда» у парах; без топового ДД — 0 */
  topMateAmpMax: number;
  /** «зв'язка» команди: (гір×урон головного ДД + secondDd × Σ гір×урон решти) / 100,
   * помножене на (1 + Σ підтримки решти, не більше 1). Гір важливий: R9R2-сін
   * і слабкий сін — не однакові ДД (відгук гравців 18.09.2026). */
  kp: number;
}

/** Неминуче — те, за що не штрафуємо, бо цього не уникнути за будь-якого розкладу. */
export interface Unavoidable {
  dups: number;
  roleSlack: Record<Role, number>;
  /** Σ (1 − kill) по K найкращих кілерах серед активних: менше нестачі не буває */
  killLack: number;
  /** пачок з однією загрозою щонайменше: max(0, 2K − загроз серед активних) */
  singleThreat: number;
  /** Пари (S = 2, жорстке правило 4): скільки пар із порушенням неминучі —
   * ⌈max(0, топів − дозволених партнерів) / 2⌉, бо два топи в одній парі — це
   * одна команда з порушенням. При S ≠ 2 або 'legacy'/'off' — 0. */
  pairViol: number;
}

export interface FormTeamsResult {
  teams: BalancePlayer[][];
  reserve: BalancePlayer[];
  penalty: number;
  bestPenalty: number;
  /** скільки різних розв'язків потрапило в ε-коридор */
  candidates: number;
  /** скільки різних розв'язків дали рестарти */
  distinct: number;
  snapshot: BalanceSnapshot;
}

// ── PRNG: cyrb128 (seed зі строки) → sfc32 ───────────────────────

export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [(h1 ^ h2 ^ h3 ^ h4) >>> 0, (h2 ^ h1) >>> 0, (h3 ^ h1) >>> 0, (h4 ^ h1) >>> 0];
}

function sfc32(a: number, b: number, c: number, d: number): () => number {
  return function () {
    a |= 0; b |= 0; c |= 0; d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Детермінований генератор [0, 1) із рядкового seed. */
export function createRng(seed: string): () => number {
  const s = cyrb128(seed);
  const rng = sfc32(s[0], s[1], s[2], s[3]);
  for (let i = 0; i < 15; i++) rng();
  return rng;
}

/** Короткий hex-хеш рядка (для inputHash). */
export function hashString(str: string): string {
  return cyrb128(str).map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Новий випадковий seed (10 hex) — єдине місце в модулі з недетермінованою випадковістю. */
export function newSeed(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function shuffleInPlace<T>(a: T[], rng: () => number): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// ── Бафи тімейтів → сила ─────────────────────────────────────────

/** Біт класу — щоб у гарячому циклі рахувати кожен клас-дарувальник один раз без Set. */
const CLASS_BIT: Record<CharClass, number> = {
  blademaster: 1, wizard: 2, cleric: 4, archer: 8, barbarian: 16, venomancer: 32, assassin: 64, psychic: 128, seeker: 256, mystic: 512,
};

/** Частка бафів у силі для команди розміру S: '5' = 5 і більше; S < 2 (не балансний формат) — як 2. */
function sizeWeightOf(b: BuffRules, S: number): number {
  return b.sizeWeight[S >= 5 ? '5' : S <= 2 ? '2' : S === 3 ? '3' : '4'];
}

/** Скільки % сили отримує гравець від тімейтів: сума по РІЗНИХ класах
 * дарувальників (два Танки бафають як один; свій клас — 0, бо власні самобафи
 * в скор не входять), клітинка «фізикам»/«магам» за класом отримувача, сторона
 * дарувальника — лише коли bySide і сторона відома, інакше сильніша; далі
 * стеля cap, частка за розміром команди S і, якщо killScaled, × урон
 * отримувача (бафи тому, хто не б'є, майже нічого не додають). */
export function buffPctTo(
  receiver: Pick<BalancePlayer, 'cls' | 'kill'>, team: ReadonlyArray<Pick<BalancePlayer, 'cls' | 'side'>>, rules: BalanceRules, kx: KxMode, S: number,
): number {
  const b = rules.buffs;
  const phys = isPhysClass(receiver.cls);
  let seen = CLASS_BIT[receiver.cls];
  let sum = 0;
  for (const d of team) {
    const bit = CLASS_BIT[d.cls];
    if (seen & bit) continue;
    seen |= bit;
    const c = b.pct[d.cls][kx];
    const side = b.bySide ? d.side : null;
    if (side) sum += phys ? c[side].phys : c[side].mag;
    else sum += phys ? Math.max(c.rs.phys, c.je.phys) : Math.max(c.rs.mag, c.je.mag);
  }
  if (sum > b.cap) sum = b.cap;
  sum = (sum * sizeWeightOf(b, S)) / 100;
  return b.killScaled ? sum * receiver.kill : sum;
}

/** Бафи команди в балах: Σ score × % бафу кожному отримувачу / 100. */
export function teamBuffOf(team: BalancePlayer[], rules: BalanceRules, kx: KxMode, S: number): number {
  let buff = 0;
  for (const p of team) buff += (p.score * buffPctTo(p, team, rules, kx, S)) / 100;
  return buff;
}

/** Сила команди = гір + бафи (без перевірки, чи бафи увімкнені — це вирішує той, хто викликає). */
export function strengthOf(team: BalancePlayer[], rules: BalanceRules, kx: KxMode, S: number): number {
  let total = 0;
  for (const p of team) total += p.score;
  return total + teamBuffOf(team, rules, kx, S);
}

/** Розкид сили (max − min) між командами. */
export function strengthSpreadOf(teams: BalancePlayer[][], rules: BalanceRules, kx: KxMode, S: number): number {
  if (!teams.length) return 0;
  let mx = -Infinity, mn = Infinity;
  for (const t of teams) { const v = strengthOf(t, rules, kx, S); if (v > mx) mx = v; if (v < mn) mn = v; }
  return mx - mn;
}

/** Сила команди зі знімка balance_stats — рахується при читанні, бо після
 * заміни гравця RPC (0022) перераховує лише гір: клас і скор беруться з
 * members, kill — зі stats.players за registrationId (заміна з резерву там
 * є, бо знімок містить усіх), інакше з профілю класу як ДД. Без блоку buffs
 * у знімку або з вимкненими бафами — сила = гір. */
export function teamStrengthFromSnapshot(
  members: ReadonlyArray<{ charClass: CharClass; score: number; registrationId: string }>,
  stats: Pick<BalanceSnapshot, 'players' | 'teamSize' | 'buffs'>,
  rules: BalanceRules,
): { total: number; buff: number; strength: number } {
  let total = 0;
  for (const m of members) total += m.score;
  const b = stats.buffs;
  if (!b?.enabled) return { total, buff: 0, strength: total };
  const killById = new Map<string, number | undefined>();
  for (const p of stats.players) killById.set(p[0], p[3]);
  const team = members.map((m) => ({ cls: m.charClass, score: m.score, kill: killById.get(m.registrationId) ?? rules.composition.profiles[m.charClass].kill, side: null }));
  let buff = 0;
  for (const p of team) buff += (p.score * buffPctTo(p, team, rules, b.kx, stats.teamSize)) / 100;
  return { total, buff, strength: total + buff };
}

// ── Статистика команди і штраф ────────────────────────────────────

const isFullDd = (p: Pick<BalancePlayer, 'kill'>) => p.kill >= FULL_DD_KILL;
const isDruidLike = (p: Pick<BalancePlayer, 'amp'>) => p.amp >= DRUID_AMP - EPS;

/** Неминучі дублікати класів (Σ_c max(0, N_c − K)) і slack ролей:
 * нерівний поділ ролі на 1 між командами не штрафується, якщо N_r не ділиться на K.
 * S — розмір команди турніру (для pairViol); без нього — ⌊N/K⌋, коли пул ділиться рівно. */
export function unavoidable(players: BalancePlayer[], K: number, rules: BalanceRules, S?: number): Unavoidable {
  const cc: Partial<Record<CharClass, number>> = {};
  for (const p of players) cc[p.cls] = (cc[p.cls] ?? 0) + 1;
  let dups = 0;
  for (const c of Object.keys(cc) as CharClass[]) dups += Math.max(0, (cc[c] ?? 0) - K);
  const rc: Partial<Record<Role, number>> = {};
  for (const p of players) { const r = rules.roleOf[p.cls]; rc[r] = (rc[r] ?? 0) + 1; }
  const roleSlack = {} as Record<Role, number>;
  for (const r of ROLES) roleSlack[r] = (rc[r] ?? 0) % K === 0 ? 0 : 1;
  // Кожна команда має свого «найкращого кілера» — окремого гравця, тож сума
  // нестач не менша за суму по K найбільших kill (досяжно: K найкращих у різних командах).
  const kills = players.map((p) => p.kill).sort((a, b) => b - a);
  let killLack = 0;
  for (let i = 0; i < K; i++) killLack += Math.max(0, 1 - (kills[i] ?? 0));
  const comp = rules.composition;
  const threats = players.filter((p) => p.kill >= comp.threatMinKill).length;
  // Пари: топу потрібен партнер; дозволених (не повний ДД; для «…і не Друїда»
  // — ще й без Друїда) може не вистачити — тоді решта топів або сідає по двоє
  // (одна пара з порушенням на двох), або бере ДД/Друїда (одна пара на топа).
  let pairViol = 0;
  const size = S ?? (players.length % K === 0 ? players.length / K : 0);
  const pr = comp.pairsRule;
  if (size === 2 && (pr === 'noSecondDd' || pr === 'noSecondDdNoDruid')) {
    let tops = 0, okMates = 0;
    for (const p of players) {
      if (isFullDd(p)) { if (p.score >= comp.topDdMinScore) tops++; }
      else if (pr === 'noSecondDd' || !isDruidLike(p)) okMates++;
    }
    pairViol = Math.ceil(Math.max(0, tops - okMates) / 2);
  }
  return { dups, roleSlack, killLack, singleThreat: Math.max(0, 2 * K - threats), pairViol };
}

/** ctx — контекст бафів (buffCtxFor); без нього сила = гір, як у версіях до teams-ls-v5. */
export function teamStats(team: BalancePlayer[], rules: BalanceRules, ctx?: BuffCtx): TeamStats {
  const sorted = team.slice().sort((a, b) => b.score - a.score || byId(a, b));
  const prefix: number[] = [];
  let s = 0;
  for (const p of sorted) { s += p.score; prefix.push(s); }
  const clsCount: Partial<Record<CharClass, number>> = {};
  let dup = 0;
  for (const p of team) { const n = (clsCount[p.cls] ?? 0) + 1; clsCount[p.cls] = n; if (n > 1) dup++; }
  const roleCount = {} as Record<Role, number>;
  for (const r of ROLES) roleCount[r] = 0;
  for (const p of team) roleCount[rules.roleOf[p.cls]]++;
  // «Нема ким убивати» дивиться лише на клас і збірку — гір тут ні до чого.
  const comp = rules.composition;
  let maxKill = 0, threats = 0;
  for (const p of team) {
    if (p.kill > maxKill) maxKill = p.kill;
    if (p.kill >= comp.threatMinKill) threats++;
  }
  // «Зв'язка» — навпаки, зважена гіром: головний ДД = найбільший гір×урон
  // (нічия → менший id, детерміновано), підсилення беремо лише від решти
  // (Дру сама себе не множить), другий ДД входить із коефіцієнтом secondDd.
  let bestIdx = -1, bestDmg = -1;
  for (let i = 0; i < team.length; i++) {
    const d = team[i].score * team[i].kill;
    if (d > bestDmg || (d === bestDmg && bestIdx >= 0 && byId(team[i], team[bestIdx]) < 0)) { bestDmg = d; bestIdx = i; }
  }
  let restDmg = 0, ampOthers = 0;
  for (let i = 0; i < team.length; i++) {
    if (i === bestIdx) continue;
    restDmg += team[i].score * team[i].kill;
    ampOthers += team[i].amp;
  }
  const kp = ((Math.max(0, bestDmg) + comp.secondDd * restDmg) / 100) * (1 + Math.min(1, ampOthers));
  let top: BalancePlayer | null = null;
  for (const p of team) {
    if (p.kill < FULL_DD_KILL || p.score < comp.topDdMinScore) continue;
    if (!top || p.score > top.score || (p.score === top.score && byId(p, top) < 0)) top = p;
  }
  let topDd = 0, topSupportOver = 0, topMateAmpMax = 0;
  if (top) {
    let support = 0;
    for (const p of team) {
      if (p === top) continue;
      if (p.kill >= FULL_DD_KILL) topDd++;
      support += p.amp;
      if (p.amp > topMateAmpMax) topMateAmpMax = p.amp;
    }
    topSupportOver = Math.max(0, support - comp.topSupportAllow);
  }
  // Сила: бафи лише коли увімкнено — інакше рівно total, і старі версії
  // шкали дають той самий штраф біт-у-біт.
  let buff = 0;
  if (ctx?.enabled) buff = teamBuffOf(team, rules, ctx.kx, ctx.S);
  const strength = ctx?.enabled ? s + buff : s;
  return { prefix, total: s, buff, strength, dup, roleCount, maxKill, threats, kp, topDd, topSupportOver, topMateAmpMax };
}

/** Пара з порушенням правила 4 (жорстка форма): біля топового ДД є другий
 * повний ДД або, у положенні «…і не Друїда», Друїд. */
export function pairViolates(st: Pick<TeamStats, 'topDd' | 'topMateAmpMax'>, pairsRule: BalanceRules['composition']['pairsRule']): boolean {
  if (pairsRule !== 'noSecondDd' && pairsRule !== 'noSecondDdNoDruid') return false;
  return st.topDd > 0 || (pairsRule === 'noSecondDdNoDruid' && st.topMateAmpMax >= DRUID_AMP - EPS);
}

/** Balance penalty (усі члени — в балах score). Менше = краще. S — розмір
 * команди турніру: від нього залежить, чи діє жорстке правило для пар. */
export function penalty(stats: TeamStats[], S: number, unav: Unavoidable, rules: BalanceRules): number {
  const K = stats.length;
  const w = rules.weights;
  let pen = 0;
  // Профіль сили top-k — на сирих скорах; повна сума (k = S − 1) — сила.
  for (let k = 0; k < S; k++) {
    const full = k === S - 1;
    let mx = -Infinity, mn = Infinity;
    for (const st of stats) { const v = full ? st.strength : (st.prefix[k] ?? st.total); if (v > mx) mx = v; if (v < mn) mn = v; }
    pen += (full ? w.total : w.top / (k + 1)) * (mx - mn);
  }
  let mean = 0;
  for (const st of stats) mean += st.strength;
  mean /= K;
  let v = 0;
  for (const st of stats) v += (st.strength - mean) ** 2;
  pen += Math.sqrt(v / K);
  let dups = 0;
  for (const st of stats) dups += st.dup;
  pen += w.dup * Math.max(0, dups - unav.dups);
  for (const r of ROLES) {
    let mx = 0, mn = Infinity;
    for (const st of stats) { const c = st.roleCount[r]; if (c > mx) mx = c; if (c < mn) mn = c; }
    pen += w.role * Math.max(0, mx - mn - unav.roleSlack[r]);
  }
  // Шар «функціональність пачки» — окремі адитивні члени: не чіпають суми
  // (інакше алгоритм «лікував» би пачку без кілера гіром), штрафують лише
  // понад неминуче. Усі ваги 0 → рівно старий штраф (teams-ls-v1).
  const cw = rules.composition.weights;
  if (cw.killer > 0) {
    let lack = 0;
    for (const st of stats) lack += Math.max(0, 1 - st.maxKill);
    pen += cw.killer * Math.max(0, lack - unav.killLack);
  }
  if (cw.twoThreats > 0 && S >= 3) {
    let single = 0;
    for (const st of stats) if (st.threats < 2) single++;
    pen += cw.twoThreats * Math.max(0, single - unav.singleThreat);
  }
  // Правило 4: топовому ДД — ні другого повного ДД, ні підтримки понад дозволену
  // (відгук гравців: «такому челу — стража і тімейтів, які його не підсилюють»).
  // У парах ваги мертві (див. CompositionRules.pairsRule), тому при S = 2 і
  // не-'legacy' — жорстко «за фактом», понад неминуче; 'off' — без штрафу.
  const pr = rules.composition.pairsRule;
  if (S === 2 && pr !== 'legacy') {
    if (pr !== 'off') {
      let viol = 0;
      for (const st of stats) if (pairViolates(st, pr)) viol++;
      pen += PAIR_HARD_PENALTY * Math.max(0, viol - unav.pairViol);
    }
  } else if (cw.topSecondDd > 0 || cw.topSupport > 0) {
    for (const st of stats) pen += cw.topSecondDd * st.topDd + cw.topSupport * st.topSupportOver;
  }
  if (cw.kpRange > 0) {
    let mx = -Infinity, mn = Infinity;
    for (const st of stats) { if (st.kp > mx) mx = st.kp; if (st.kp < mn) mn = st.kp; }
    pen += cw.kpRange * (mx - mn);
  }
  return pen;
}

/** Оцінка довільного розкладу (напр. після ручних свопів у модалці). opts —
 * ті самі бафи й розмір команди турніру, що при формуванні, інакше штраф у
 * знімку не збігатиметься з чернеткою; без teamSize — найбільша команда. */
export function evaluateTeams(
  teams: BalancePlayer[][], rules: BalanceRules, opts?: { buffs?: BuffOptions; teamSize?: number },
): { penalty: number; stats: TeamStats[]; unavoidableDups: number; unavoidable: Unavoidable; buffs: BuffCtx } {
  const K = teams.length;
  const S = opts?.teamSize ?? Math.max(...teams.map((t) => t.length));
  const ctx = buffCtxFor(rules, opts?.buffs, S);
  const unav = unavoidable(teams.flat(), K, rules, S);
  const stats = teams.map((t) => teamStats(t, rules, ctx));
  return { penalty: penalty(stats, S, unav, rules), stats, unavoidableDups: unav.dups, unavoidable: unav, buffs: ctx };
}

// ── Крок A: конструктивний старт ─────────────────────────────────

function constructiveDeal(active: BalancePlayer[], K: number, S: number, rng: () => number): BalancePlayer[][] {
  const buckets = new Map<CharClass, BalancePlayer[]>();
  for (const p of active) {
    const b = buckets.get(p.cls);
    if (b) b.push(p); else buckets.set(p.cls, [p]);
  }
  const order = shuffleInPlace(Array.from(buckets.keys()).sort(), rng);
  // більші бакети першими: якщо N_c > K, дублі лягають максимально рівномірно
  order.sort((a, b) => buckets.get(b)!.length - buckets.get(a)!.length);
  const teams: BalancePlayer[][] = Array.from({ length: K }, () => []);
  let cursor = Math.floor(rng() * K);
  const place = (p: BalancePlayer, ok: (t: BalancePlayer[]) => boolean): boolean => {
    for (let tries = 0; tries < K; tries++) {
      const idx = (cursor + tries) % K;
      const t = teams[idx];
      if (ok(t)) { t.push(p); cursor = (idx + 1) % K; return true; }
    }
    return false;
  };
  for (const c of order) {
    for (const p of shuffleInPlace(buckets.get(c)!.slice(), rng)) {
      if (place(p, (t) => t.length < S && !t.some((q) => q.cls === c))) continue;
      if (place(p, (t) => t.length < S)) continue; // лише коли N_c > K
      throw new Error('constructiveDeal: no room');
    }
  }
  return teams;
}

// ── Крок B: локальний пошук ──────────────────────────────────────

function localSearch(
  teams: BalancePlayer[][], S: number, unav: Unavoidable, rules: BalanceRules, rng: () => number, iters: number, ctx: BuffCtx,
): { teams: BalancePlayer[][]; penalty: number } {
  const K = teams.length;
  const stats = teams.map((t) => teamStats(t, rules, ctx));
  let cur = penalty(stats, S, unav, rules);
  let best = cur;
  let bestTeams = teams.map((t) => t.slice());
  for (let it = 0; it < iters; it++) {
    const T = rules.T0 * Math.pow(rules.T1 / rules.T0, it / iters);
    const a = Math.floor(rng() * K);
    let b = Math.floor(rng() * (K - 1));
    if (b >= a) b++;
    const i = Math.floor(rng() * S), j = Math.floor(rng() * S);
    const pa = teams[a][i], pb = teams[b][j];
    // однакові з погляду штрафу гравці — своп нічого не змінює (сторона важить лише при bySide)
    if (pa.cls === pb.cls && pa.score === pb.score && pa.kill === pb.kill && pa.amp === pb.amp && (pa.side ?? null) === (pb.side ?? null)) continue;
    teams[a][i] = pb; teams[b][j] = pa;
    const sa = teamStats(teams[a], rules, ctx), sb = teamStats(teams[b], rules, ctx);
    if (sa.dup > stats[a].dup || sb.dup > stats[b].dup) { teams[a][i] = pa; teams[b][j] = pb; continue; } // інваріант класів
    const oa = stats[a], ob = stats[b];
    stats[a] = sa; stats[b] = sb;
    const next = penalty(stats, S, unav, rules);
    const d = next - cur;
    if (d <= 0 || rng() < Math.exp(-d / T)) {
      cur = next;
      if (cur < best) { best = cur; bestTeams = teams.map((t) => t.slice()); }
    } else {
      teams[a][i] = pa; teams[b][j] = pb; stats[a] = oa; stats[b] = ob;
    }
  }
  return { teams: bestTeams, penalty: best };
}

/** Канонічний підпис розкладу — однакові склади дають однаковий рядок незалежно від порядку. */
export function signature(teams: BalancePlayer[][]): string {
  return teams.map((t) => t.map((p) => p.id).sort().join(',')).sort().join('|');
}

function splitReserve(
  players: BalancePlayer[], activeCount: number, opts: FormTeamsOptions, rng: () => number,
): { active: BalancePlayer[]; reserve: BalancePlayer[] } {
  const policy = opts.reservePolicy ?? 'latest';
  if (policy === 'random') {
    const pool = shuffleInPlace(players.slice(), rng);
    return { active: pool.slice(0, activeCount), reserve: pool.slice(activeCount) };
  }
  const byTime = players.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : byId(a, b)));
  if (policy === 'manual') {
    const pinned = new Set(opts.pinnedReserveIds ?? []);
    const rest = byTime.filter((p) => !pinned.has(p.id));
    if (rest.length < activeCount) {
      throw new Error(`Закріплено в резерві забагато: лишається ${rest.length} гравців, потрібно ${activeCount}.`);
    }
    const reserve = [...byTime.filter((p) => pinned.has(p.id)), ...rest.slice(activeCount)];
    return { active: rest.slice(0, activeCount), reserve };
  }
  return { active: byTime.slice(0, activeCount), reserve: byTime.slice(activeCount) };
}

/** Головна функція: N гравців → K команд по S + резерв. Кидає Error з
 * українським текстом, якщо гравців менше ніж на 2 команди. */
export function formTeams(input: BalancePlayer[], opts: FormTeamsOptions): FormTeamsResult {
  const { teamSize: S, seed, rules } = opts;
  if (!Number.isInteger(S) || S < 1) throw new Error('Некоректний розмір команди.');
  const players = input.slice().sort(byId); // канонічний порядок → детермінізм
  const K = opts.teamCount ?? Math.floor(players.length / S);
  if (K < 2 || K * S > players.length) {
    throw new Error(`Потрібно щонайменше ${2 * S} підтверджених гравців для 2 команд по ${S} (зараз ${players.length}).`);
  }
  const R = opts.restarts ?? 8;
  const I = opts.iterations ?? Math.max(20000, 200 * players.length);
  const rng = createRng(seed + ':teams');
  const { active, reserve } = splitReserve(players, K * S, opts, rng);
  const unav = unavoidable(active, K, rules, S);
  const ctx = buffCtxFor(rules, opts.buffs, S);

  const sols = new Map<string, { teams: BalancePlayer[][]; penalty: number }>();
  for (let r = 0; r < R; r++) {
    const res = localSearch(constructiveDeal(active, K, S, rng), S, unav, rules, rng, I, ctx);
    const sig = signature(res.teams);
    const prev = sols.get(sig);
    if (!prev || prev.penalty > res.penalty) sols.set(sig, res);
  }
  const list = Array.from(sols.values()).sort((a, b) => a.penalty - b.penalty);
  const cands = list.filter((s) => s.penalty <= list[0].penalty + rules.epsilon).slice(0, rules.topN);
  const chosen = cands[Math.floor(rng() * cands.length)];

  const snapshotPlayers: Array<[string, CharClass, number, number, number]> = players.map((p) => [p.id, p.cls, p.score, p.kill, p.amp]);
  const snapshot: BalanceSnapshot = {
    algoVersion: ALGO_VERSION,
    rulesVersion: opts.rulesVersion,
    seed,
    teamSize: S,
    teamCount: K,
    reservePolicy: opts.reservePolicy ?? 'latest',
    inputHash: hashString(JSON.stringify(snapshotPlayers)),
    players: snapshotPlayers,
    // enabled — чи бафи справді рахувались (галочка у шкалі × правила турніру);
    // source окремо, щоб рядок довіри розрізняв «вимкнено у шкалі» і «вимкнено правилами»
    buffs: { enabled: ctx.enabled, source: opts.buffs?.source ?? 'party', kx: ctx.kx, bySide: rules.buffs.bySide },
    pairsRule: rules.composition.pairsRule,
  };
  return {
    teams: chosen.teams.map((t) => t.slice().sort((a, b) => b.score - a.score || byId(a, b))),
    reserve,
    penalty: chosen.penalty,
    bestPenalty: list[0].penalty,
    candidates: cands.length,
    distinct: list.length,
    snapshot,
  };
}

/** Розкид сум гіру команд (max − min). Коли бафи увімкнено, головна метрика — розкид сили (strengthSpreadOf). */
export function spreadOf(teams: BalancePlayer[][]): number {
  const totals = teams.map((t) => t.reduce((s, p) => s + p.score, 0));
  return totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
}

/** Оцінка межі для пулу: скільки різних seed дають який розкид (щоб адмін бачив,
 * чи є сенс крутити «Перегенерувати»). Розкид сили, коли бафи увімкнено, інакше
 * гіру. Бюджет зменшений; викликати чанками (див. TeamsPanel), бо formTeams блокує потік. */
export function estimateSpread(players: BalancePlayer[], opts: Omit<FormTeamsOptions, 'seed'>, seeds: string[]): number[] {
  const ctx = buffCtxFor(opts.rules, opts.buffs, opts.teamSize);
  return seeds.map((seed) => {
    const teams = formTeams(players, { ...opts, seed, restarts: opts.restarts ?? 1, iterations: opts.iterations ?? 8000 }).teams;
    return ctx.enabled ? strengthSpreadOf(teams, opts.rules, ctx.kx, ctx.S) : spreadOf(teams);
  });
}

/** Кандидати на заміну вибулого: спочатку той самий клас, потім клас, якого
 * нема в команді, потім решта; всередині — найменша зміна сили команди, якщо
 * передано ctx (бафи увімкнено), інакше найближчі за score; далі за
 * порядком у резерві (перший у резерві — перший на заміну). */
export function suggestReplacement(
  team: BalancePlayer[], missing: BalancePlayer, reserve: BalancePlayer[], ctx?: { rules: BalanceRules; kx: KxMode; S: number },
): BalancePlayer[] {
  const rest = team.filter((p) => p.id !== missing.id);
  const present = new Set(rest.map((p) => p.cls));
  const rank = (p: BalancePlayer) => (p.cls === missing.cls ? 0 : present.has(p.cls) ? 2 : 1);
  const before = ctx ? strengthOf(team, ctx.rules, ctx.kx, ctx.S) : 0;
  const closeness = ctx
    ? (p: BalancePlayer) => Math.abs(strengthOf([...rest, p], ctx.rules, ctx.kx, ctx.S) - before)
    : (p: BalancePlayer) => Math.abs(p.score - missing.score);
  return reserve
    .map((p, idx) => ({ p, idx, d: closeness(p) }))
    .sort((x, y) => rank(x.p) - rank(y.p) || x.d - y.d || x.idx - y.idx)
    .map((x) => x.p);
}
