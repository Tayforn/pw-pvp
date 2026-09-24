// =========================================================
// pw-pvp: Ело-рейтинг гравців з результатів матчів балансного фул-рандому
// + звіт «чи працює шкала».
//
// Рейтинг НЕ зберігається — він щоразу відтворюється з історії (усі
// вирішені матчі фул-рандом турнірів у хронологічному порядку). Тому
// скинутий/переграний результат матчу автоматично коригує рейтинг, а
// схема БД не змінюється. Ідентичність гравця — нік (без регістру), як і
// скрізь у проєкті. Історії поки мало → рейтинг входить у скор лише через
// ratingBonus (gearRules: ratingWeight/ratingCap), а не напряму.
//
// У звіті «сильніша команда» — за силою (гір + бафи тімейтів, teams-ls-v5),
// коли бафи рахувались у жеребці, інакше за гіром; розкид гіру і розкид сили
// показуються двома колонками, бо при рівній силі гір розходиться сильніше,
// і одна цифра замість другої вводила б в оману.
// =========================================================

import { supabase } from '../app/supabaseClient';
import type { BalanceStats, BracketSide } from './types';
import { rulesFor, type BalanceRules } from './gearRules';
import { teamStrengthFromSnapshot } from './balance';
import { loadRulesFromDb } from './rulesStore';

export const RATING_BASE = 1000;
export const RATING_K = 32;

/** Один вирішений матч між двома згенерованими командами. */
export interface MatchRecord {
  tournamentId: string;
  tournamentName: string;
  eventDate: string;
  bracketSide: BracketSide;
  round: number;
  slot: number;
  teamA: string;
  teamB: string;
  membersA: string[];
  membersB: string[];
  /** сума скорів на момент формування (з balance_stats), null — якщо невідомо */
  totalA: number | null;
  totalB: number | null;
  /** сила команди (гір + бафи тімейтів) зі знімка — лише коли бафи рахувались
   * у жеребці (balance_stats.buffs.enabled); інакше null, і «сильніша» — за гіром */
  strengthA: number | null;
  strengthB: number | null;
  winner: 'A' | 'B';
}

/** Розкид (max − min) між командами турніру: гіру і сили. Сила — null, коли
 * бафи в жеребці не рахувались: показувати ту саму цифру двічі означало б,
 * що «сила» щось додала. */
export interface TournamentSpreads {
  gear: number | null;
  strength: number | null;
}

/** Гір · бафи · сила кожної команди зі знімка, за назвою команди. Сила в
 * знімку не зберігається — рахується з поточного складу (після заміни RPC
 * 0022 оновлює лише склад і гір). rules — версія шкали турніру; параметр
 * потрібен тестам, у застосунку береться з реєстру за stats.rulesVersion. */
export function teamStrengthsOf(stats: BalanceStats, rules: BalanceRules = rulesFor(stats.rulesVersion).balance): Map<string, { total: number; buff: number; strength: number }> {
  const m = new Map<string, { total: number; buff: number; strength: number }>();
  for (const team of stats.teams) m.set(team.name, teamStrengthFromSnapshot(team.members, stats, rules));
  return m;
}

export function spreadsOf(stats: BalanceStats | null | undefined, rules?: BalanceRules): TournamentSpreads {
  if (!stats?.teams.length) return { gear: null, strength: null };
  const totals = stats.teams.map((x) => x.total);
  const gear = Math.max(...totals) - Math.min(...totals);
  if (!stats.buffs?.enabled) return { gear, strength: null };
  const strengths = Array.from(teamStrengthsOf(stats, rules).values(), (x) => x.strength);
  return { gear, strength: Math.max(...strengths) - Math.min(...strengths) };
}

export interface PlayerRating {
  nickname: string;
  rating: number;
  games: number;
  wins: number;
}

const key = (nick: string) => nick.trim().toLowerCase();

/** Порядок відтворення: дата турніру → створення → сторона сітки → раунд → слот. */
const SIDE_ORDER: Record<BracketSide, number> = { winners: 0, losers: 1, third_place: 2, final: 3 };

export function sortHistory(h: MatchRecord[]): MatchRecord[] {
  return h.slice().sort((a, b) =>
    a.eventDate.localeCompare(b.eventDate) || a.tournamentId.localeCompare(b.tournamentId) ||
    SIDE_ORDER[a.bracketSide] - SIDE_ORDER[b.bracketSide] || a.round - b.round || a.slot - b.slot,
  );
}

/** Командне Ело: рейтинг команди = середнє членів; кожен член отримує однакову
 * дельту K·(S − E). Чистa функція — та сама історія → той самий рейтинг. */
export function computeRatings(history: MatchRecord[]): Map<string, PlayerRating> {
  const map = new Map<string, PlayerRating>();
  const get = (nick: string): PlayerRating => {
    const k = key(nick);
    let p = map.get(k);
    if (!p) { p = { nickname: nick, rating: RATING_BASE, games: 0, wins: 0 }; map.set(k, p); }
    return p;
  };
  for (const m of sortHistory(history)) {
    if (!m.membersA.length || !m.membersB.length) continue;
    const A = m.membersA.map(get), B = m.membersB.map(get);
    const ra = A.reduce((s, p) => s + p.rating, 0) / A.length;
    const rb = B.reduce((s, p) => s + p.rating, 0) / B.length;
    const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
    const sa = m.winner === 'A' ? 1 : 0;
    const delta = RATING_K * (sa - ea);
    for (const p of A) { p.rating += delta; p.games++; if (sa === 1) p.wins++; }
    for (const p of B) { p.rating -= delta; p.games++; if (sa === 0) p.wins++; }
  }
  return map;
}

export function ratingOf(ratings: Map<string, PlayerRating>, nickname: string): PlayerRating | undefined {
  return ratings.get(key(nickname));
}

// ── Звіт «чи працює шкала» ────────────────────────────────────────

export interface TournamentReport {
  tournamentId: string;
  tournamentName: string;
  eventDate: string;
  /** вирішених матчів між командами з відомими сумами */
  decided: number;
  /** з них перемогла сильніша команда (за силою, коли бафи рахувались у жеребці, інакше за гіром) */
  strongerWon: number;
  /** матчі з рівними командами (не рахуються ні туди, ні туди) */
  ties: number;
  /** середній модуль різниці (сили або гіру — тією ж міркою, що й «сильніша») у матчах */
  avgDiff: number;
  /** розкид гіру команд у турнірі (max − min), null — якщо сум немає */
  spread: number | null;
  /** розкид сили команд (гір + бафи) з поточного складу знімка; null — бафи не рахувались */
  strengthSpread: number | null;
  /** «сильніша» тут — за силою (у жеребці рахувались бафи), а не за гіром */
  byStrength: boolean;
}

export interface BalanceReport {
  tournaments: TournamentReport[];
  decided: number;
  strongerWon: number;
  ties: number;
  /** частка перемог сильнішої команди, 0..1; null — якщо матчів немає */
  strongerWinRate: number | null;
  /** окремо для матчів, де різниця ≥ 5 % сили команди — там шкала мала б «бачити» різницю */
  bigDiffDecided: number;
  bigDiffStrongerWon: number;
}

/** Мірка, якою порівнюємо команди в матчі: сила, коли вона є у знімку (бафи
 * рахувались), інакше гір. Не змішуємо в одному турнірі — сила є або в усіх
 * командах знімка, або в жодній. */
const measureOf = (m: MatchRecord): { a: number; b: number; byStrength: boolean } | null => {
  if (m.totalA === null || m.totalB === null) return null;
  if (m.strengthA !== null && m.strengthB !== null) return { a: m.strengthA, b: m.strengthB, byStrength: true };
  return { a: m.totalA, b: m.totalB, byStrength: false };
};

export function computeBalanceReport(history: MatchRecord[], spreads: Map<string, TournamentSpreads>, names: Map<string, { name: string; eventDate: string }>): BalanceReport {
  const per = new Map<string, TournamentReport>();
  let decided = 0, strongerWon = 0, ties = 0, bigDiffDecided = 0, bigDiffStrongerWon = 0;
  for (const m of history) {
    const v = measureOf(m);
    if (!v) continue;
    let t = per.get(m.tournamentId);
    if (!t) {
      const n = names.get(m.tournamentId);
      const sp = spreads.get(m.tournamentId);
      t = {
        tournamentId: m.tournamentId, tournamentName: n?.name ?? m.tournamentName, eventDate: n?.eventDate ?? m.eventDate,
        decided: 0, strongerWon: 0, ties: 0, avgDiff: 0, spread: sp?.gear ?? null, strengthSpread: sp?.strength ?? null, byStrength: v.byStrength,
      };
      per.set(m.tournamentId, t);
    }
    const diff = v.a - v.b;
    if (diff === 0) { t.ties++; ties++; continue; }
    const strongerIsA = diff > 0;
    const won = (m.winner === 'A') === strongerIsA;
    t.decided++; decided++;
    t.avgDiff += Math.abs(diff);
    if (won) { t.strongerWon++; strongerWon++; }
    const teamMean = (v.a + v.b) / 2;
    if (teamMean > 0 && Math.abs(diff) / teamMean >= 0.05) { bigDiffDecided++; if (won) bigDiffStrongerWon++; }
  }
  const tournaments = Array.from(per.values()).map((t) => ({ ...t, avgDiff: t.decided ? Math.round((t.avgDiff / t.decided) * 10) / 10 : 0 }))
    .sort((a, b) => b.eventDate.localeCompare(a.eventDate));
  return { tournaments, decided, strongerWon, ties, strongerWinRate: decided ? strongerWon / decided : null, bigDiffDecided, bigDiffStrongerWon };
}

// ── Читання історії з БД ──────────────────────────────────────────

interface TRow { id: string; name: string; event_date: string; balance_stats: BalanceStats | null }
interface RRow { id: string; tournament_id: string; nickname: string; kind: 'player' | 'team' | null; team_registration_id: string | null }
interface MRow { tournament_id: string; bracket_side: BracketSide; round: number; slot: number; participant1_id: string | null; participant2_id: string | null; winner_id: string | null }

export interface RatingHistory {
  history: MatchRecord[];
  /** розкид гіру і сили команд за balance_stats на турнір */
  spreads: Map<string, TournamentSpreads>;
  names: Map<string, { name: string; eventDate: string }>;
}

/** Усі вирішені матчі між згенерованими командами фул-рандом турнірів
 * (публічні select-політики → працює і без логіну). */
export async function fetchRatingHistory(): Promise<RatingHistory> {
  // Сила команд рахується за версією шкали турніру (rulesFor): поки версії з
  // БД не довантажились, реєстр знає лише вбудовану v1.0 з нульовою таблицею
  // бафів — «сила» мовчки дорівнювала б гіру, а звіт писав би «за силою».
  // Виклик ідемпотентний (одна обіцянка на сесію).
  await loadRulesFromDb();
  const { data: tData, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, event_date, balance_stats')
    .eq('team_mode', 'balanced_random')
    .order('event_date', { ascending: true });
  if (tErr) throw tErr;
  const tournaments = (tData ?? []) as TRow[];
  const names = new Map(tournaments.map((t) => [t.id, { name: t.name, eventDate: t.event_date }] as const));
  const spreads = new Map<string, TournamentSpreads>();
  const totalsByTeamName = new Map<string, Map<string, number>>();
  // сила — лише коли бафи рахувались у жеребці; інакше матч порівнюється за гіром
  const strengthByTeamName = new Map<string, Map<string, number>>();
  for (const t of tournaments) {
    const stats = t.balance_stats;
    const teams = stats?.teams ?? [];
    spreads.set(t.id, spreadsOf(stats));
    totalsByTeamName.set(t.id, new Map(teams.map((x) => [x.name, x.total] as const)));
    if (stats?.buffs?.enabled) strengthByTeamName.set(t.id, new Map(Array.from(teamStrengthsOf(stats), ([name, s]) => [name, s.strength] as const)));
  }
  if (!tournaments.length) return { history: [], spreads, names };

  const ids = tournaments.map((t) => t.id);
  const [{ data: rData, error: rErr }, { data: mData, error: mErr }] = await Promise.all([
    supabase.from('registrations').select('id, tournament_id, nickname, kind, team_registration_id').in('tournament_id', ids),
    supabase.from('bracket_matches').select('tournament_id, bracket_side, round, slot, participant1_id, participant2_id, winner_id').in('tournament_id', ids).not('winner_id', 'is', null),
  ]);
  if (rErr) throw rErr;
  if (mErr) throw mErr;
  const regs = (rData ?? []) as RRow[];
  const teamRow = new Map(regs.filter((r) => r.kind === 'team').map((r) => [r.id, r] as const));
  const membersOf = new Map<string, string[]>();
  for (const r of regs) {
    if (r.kind !== 'player' || !r.team_registration_id) continue;
    const list = membersOf.get(r.team_registration_id) ?? [];
    list.push(r.nickname);
    membersOf.set(r.team_registration_id, list);
  }

  const history: MatchRecord[] = [];
  for (const m of (mData ?? []) as MRow[]) {
    if (!m.participant1_id || !m.participant2_id || !m.winner_id) continue; // баї не рахуємо
    const a = teamRow.get(m.participant1_id), b = teamRow.get(m.participant2_id);
    if (!a || !b) continue;
    const n = names.get(m.tournament_id)!;
    const totals = totalsByTeamName.get(m.tournament_id);
    const strengths = strengthByTeamName.get(m.tournament_id);
    history.push({
      tournamentId: m.tournament_id, tournamentName: n.name, eventDate: n.eventDate,
      bracketSide: m.bracket_side, round: m.round, slot: m.slot,
      teamA: a.nickname, teamB: b.nickname,
      membersA: membersOf.get(a.id) ?? [], membersB: membersOf.get(b.id) ?? [],
      totalA: totals?.get(a.nickname) ?? null, totalB: totals?.get(b.nickname) ?? null,
      strengthA: strengths?.get(a.nickname) ?? null, strengthB: strengths?.get(b.nickname) ?? null,
      winner: m.winner_id === a.id ? 'A' : 'B',
    });
  }
  return { history: sortHistory(history), spreads, names };
}

let cache: { at: number; promise: Promise<Map<string, PlayerRating>> } | null = null;

/** Рейтинги всіх гравців (кеш на 60 с; force — перечитати). */
export function fetchRatings(force = false): Promise<Map<string, PlayerRating>> {
  const now = Date.now();
  if (!force && cache && now - cache.at < 60_000) return cache.promise;
  const promise = fetchRatingHistory().then((h) => computeRatings(h.history));
  cache = { at: now, promise };
  return promise;
}
