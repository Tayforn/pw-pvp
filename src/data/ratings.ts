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
// =========================================================

import { supabase } from '../app/supabaseClient';
import type { BalanceStats, BracketSide } from './types';

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
  winner: 'A' | 'B';
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
  /** з них перемогла команда з більшою сумою */
  strongerWon: number;
  /** матчі з рівними сумами (не рахуються ні туди, ні туди) */
  ties: number;
  /** середній модуль різниці сум у матчах */
  avgDiff: number;
  /** розкид сум команд у турнірі (max − min), null — якщо сум немає */
  spread: number | null;
}

export interface BalanceReport {
  tournaments: TournamentReport[];
  decided: number;
  strongerWon: number;
  ties: number;
  /** частка перемог сильнішої за сумою команди, 0..1; null — якщо матчів немає */
  strongerWinRate: number | null;
  /** окремо для матчів, де різниця сум ≥ 5 % суми команди — там шкала мала б «бачити» різницю */
  bigDiffDecided: number;
  bigDiffStrongerWon: number;
}

export function computeBalanceReport(history: MatchRecord[], spreads: Map<string, number | null>, names: Map<string, { name: string; eventDate: string }>): BalanceReport {
  const per = new Map<string, TournamentReport>();
  let decided = 0, strongerWon = 0, ties = 0, bigDiffDecided = 0, bigDiffStrongerWon = 0;
  for (const m of history) {
    if (m.totalA === null || m.totalB === null) continue;
    let t = per.get(m.tournamentId);
    if (!t) {
      const n = names.get(m.tournamentId);
      t = { tournamentId: m.tournamentId, tournamentName: n?.name ?? m.tournamentName, eventDate: n?.eventDate ?? m.eventDate, decided: 0, strongerWon: 0, ties: 0, avgDiff: 0, spread: spreads.get(m.tournamentId) ?? null };
      per.set(m.tournamentId, t);
    }
    const diff = m.totalA - m.totalB;
    if (diff === 0) { t.ties++; ties++; continue; }
    const strongerIsA = diff > 0;
    const won = (m.winner === 'A') === strongerIsA;
    t.decided++; decided++;
    t.avgDiff += Math.abs(diff);
    if (won) { t.strongerWon++; strongerWon++; }
    const teamMean = (m.totalA + m.totalB) / 2;
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
  /** розкид сум команд за balance_stats на турнір */
  spreads: Map<string, number | null>;
  names: Map<string, { name: string; eventDate: string }>;
}

/** Усі вирішені матчі між згенерованими командами фул-рандом турнірів
 * (публічні select-політики → працює і без логіну). */
export async function fetchRatingHistory(): Promise<RatingHistory> {
  const { data: tData, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, event_date, balance_stats')
    .eq('team_mode', 'balanced_random')
    .order('event_date', { ascending: true });
  if (tErr) throw tErr;
  const tournaments = (tData ?? []) as TRow[];
  const names = new Map(tournaments.map((t) => [t.id, { name: t.name, eventDate: t.event_date }] as const));
  const spreads = new Map<string, number | null>();
  const totalsByTeamName = new Map<string, Map<string, number>>();
  for (const t of tournaments) {
    const teams = t.balance_stats?.teams ?? [];
    const totals = teams.map((x) => x.total);
    spreads.set(t.id, totals.length ? Math.max(...totals) - Math.min(...totals) : null);
    totalsByTeamName.set(t.id, new Map(teams.map((x) => [x.name, x.total] as const)));
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
    history.push({
      tournamentId: m.tournament_id, tournamentName: n.name, eventDate: n.eventDate,
      bracketSide: m.bracket_side, round: m.round, slot: m.slot,
      teamA: a.nickname, teamB: b.nickname,
      membersA: membersOf.get(a.id) ?? [], membersB: membersOf.get(b.id) ?? [],
      totalA: totals?.get(a.nickname) ?? null, totalB: totals?.get(b.nickname) ?? null,
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
