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
//   вибір — випадковий серед різних розв'язків у ε-коридорі від найкращого,
//      щоб той самий пул не давав завжди один і той самий склад.
// Чому не «10 000 випадкових → фільтр» зі спеки — див. §2.5 документа.
// =========================================================

import type { BalanceSnapshot, CharClass } from './types';
import { ROLES, type BalanceRules, type Role } from './gearRules';

export const ALGO_VERSION = 'teams-ls-v1';

export interface BalancePlayer {
  id: string;
  nickname: string;
  cls: CharClass;
  score: number;
  /** ISO — для політики резерву 'latest' */
  createdAt: string;
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
}

export interface TeamStats {
  /** префіксні суми score за спаданням: prefix[k-1] = сума k найсильніших */
  prefix: number[];
  total: number;
  /** дублікати класів у команді (Σ_c max(0, count_c − 1)) */
  dup: number;
  roleCount: Record<Role, number>;
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

// ── Статистика команди і штраф ────────────────────────────────────

/** Неминучі дублікати класів (Σ_c max(0, N_c − K)) і slack ролей:
 * нерівний поділ ролі на 1 між командами не штрафується, якщо N_r не ділиться на K. */
export function unavoidable(players: BalancePlayer[], K: number, rules: BalanceRules): { dups: number; roleSlack: Record<Role, number> } {
  const cc: Partial<Record<CharClass, number>> = {};
  for (const p of players) cc[p.cls] = (cc[p.cls] ?? 0) + 1;
  let dups = 0;
  for (const c of Object.keys(cc) as CharClass[]) dups += Math.max(0, (cc[c] ?? 0) - K);
  const rc: Partial<Record<Role, number>> = {};
  for (const p of players) { const r = rules.roleOf[p.cls]; rc[r] = (rc[r] ?? 0) + 1; }
  const roleSlack = {} as Record<Role, number>;
  for (const r of ROLES) roleSlack[r] = (rc[r] ?? 0) % K === 0 ? 0 : 1;
  return { dups, roleSlack };
}

export function teamStats(team: BalancePlayer[], rules: BalanceRules): TeamStats {
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
  return { prefix, total: s, dup, roleCount };
}

/** Balance penalty (усі члени — в балах score). Менше = краще. */
export function penalty(stats: TeamStats[], S: number, unav: { dups: number; roleSlack: Record<Role, number> }, rules: BalanceRules): number {
  const K = stats.length;
  const w = rules.weights;
  let pen = 0;
  for (let k = 0; k < S; k++) {
    let mx = -Infinity, mn = Infinity;
    for (const st of stats) { const v = st.prefix[k] ?? st.total; if (v > mx) mx = v; if (v < mn) mn = v; }
    pen += (k === S - 1 ? w.total : w.top / (k + 1)) * (mx - mn);
  }
  let mean = 0;
  for (const st of stats) mean += st.total;
  mean /= K;
  let v = 0;
  for (const st of stats) v += (st.total - mean) ** 2;
  pen += Math.sqrt(v / K);
  let dups = 0;
  for (const st of stats) dups += st.dup;
  pen += w.dup * Math.max(0, dups - unav.dups);
  for (const r of ROLES) {
    let mx = 0, mn = Infinity;
    for (const st of stats) { const c = st.roleCount[r]; if (c > mx) mx = c; if (c < mn) mn = c; }
    pen += w.role * Math.max(0, mx - mn - unav.roleSlack[r]);
  }
  return pen;
}

/** Оцінка довільного розкладу (напр. після ручних свопів у модалці). */
export function evaluateTeams(teams: BalancePlayer[][], rules: BalanceRules): { penalty: number; stats: TeamStats[]; unavoidableDups: number } {
  const K = teams.length;
  const S = Math.max(...teams.map((t) => t.length));
  const unav = unavoidable(teams.flat(), K, rules);
  const stats = teams.map((t) => teamStats(t, rules));
  return { penalty: penalty(stats, S, unav, rules), stats, unavoidableDups: unav.dups };
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
  teams: BalancePlayer[][], S: number, unav: ReturnType<typeof unavoidable>, rules: BalanceRules, rng: () => number, iters: number,
): { teams: BalancePlayer[][]; penalty: number } {
  const K = teams.length;
  const stats = teams.map((t) => teamStats(t, rules));
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
    if (pa.cls === pb.cls && pa.score === pb.score) continue;
    teams[a][i] = pb; teams[b][j] = pa;
    const sa = teamStats(teams[a], rules), sb = teamStats(teams[b], rules);
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
  const unav = unavoidable(active, K, rules);

  const sols = new Map<string, { teams: BalancePlayer[][]; penalty: number }>();
  for (let r = 0; r < R; r++) {
    const res = localSearch(constructiveDeal(active, K, S, rng), S, unav, rules, rng, I);
    const sig = signature(res.teams);
    const prev = sols.get(sig);
    if (!prev || prev.penalty > res.penalty) sols.set(sig, res);
  }
  const list = Array.from(sols.values()).sort((a, b) => a.penalty - b.penalty);
  const cands = list.filter((s) => s.penalty <= list[0].penalty + rules.epsilon).slice(0, rules.topN);
  const chosen = cands[Math.floor(rng() * cands.length)];

  const snapshotPlayers: Array<[string, CharClass, number]> = players.map((p) => [p.id, p.cls, p.score]);
  const snapshot: BalanceSnapshot = {
    algoVersion: ALGO_VERSION,
    rulesVersion: opts.rulesVersion,
    seed,
    teamSize: S,
    teamCount: K,
    reservePolicy: opts.reservePolicy ?? 'latest',
    inputHash: hashString(JSON.stringify(snapshotPlayers)),
    players: snapshotPlayers,
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

/** Розкид сум команд (max − min) — головна метрика «наскільки збалансовано». */
export function spreadOf(teams: BalancePlayer[][]): number {
  const totals = teams.map((t) => t.reduce((s, p) => s + p.score, 0));
  return totals.length ? Math.max(...totals) - Math.min(...totals) : 0;
}

/** Оцінка межі для пулу: скільки різних seed дають який розкид (щоб адмін бачив,
 * чи є сенс крутити «Перегенерувати»). Бюджет зменшений; викликати чанками
 * (див. TeamsPanel), бо formTeams блокує потік. */
export function estimateSpread(players: BalancePlayer[], opts: Omit<FormTeamsOptions, 'seed'>, seeds: string[]): number[] {
  return seeds.map((seed) => spreadOf(formTeams(players, { ...opts, seed, restarts: opts.restarts ?? 1, iterations: opts.iterations ?? 8000 }).teams));
}

/** Кандидати на заміну вибулого: спочатку той самий клас, потім клас, якого
 * нема в команді, потім решта; всередині — найближчі за score, далі за
 * порядком у резерві (перший у резерві — перший на заміну). */
export function suggestReplacement(team: BalancePlayer[], missing: BalancePlayer, reserve: BalancePlayer[]): BalancePlayer[] {
  const present = new Set(team.filter((p) => p.id !== missing.id).map((p) => p.cls));
  const rank = (p: BalancePlayer) => (p.cls === missing.cls ? 0 : present.has(p.cls) ? 2 : 1);
  return reserve
    .map((p, idx) => ({ p, idx }))
    .sort((x, y) => rank(x.p) - rank(y.p) || Math.abs(x.p.score - missing.score) - Math.abs(y.p.score - missing.score) || x.idx - y.idx)
    .map((x) => x.p);
}
