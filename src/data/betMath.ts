// =========================================================
// Ставки в юанях — чиста логіка тоталізатора (без Supabase і DOM).
//
// Ринок — переможець матчу (matchId) або турніру (matchId null). У пул ринку йдуть
// лише ОПЛАЧЕНІ ставки (status 'paid'): публічно — з таблиці bet_pools (0036), в
// адмінці — з самих ставок (poolsFromBets), правило те саме.
//
// Виплата: переможці ділять увесь пул ринку мінус комісія пропорційно ставкам —
//   виграш = ⌊ставка × пул × (1 − комісія) / ставки на переможця⌋.
// Ніхто не поставив на переможця, або на програвших не поставив ніхто — усім
// повернення ставки. Ринок анульовано (турнір скасовано, матч зник із сітки,
// учасника прибрали) — теж повернення.
//
// Виплати НЕ зберігаються в базі — рахуються з результату щоразу (як Ело в
// ratings.ts): змінили переможця заднім числом — «до виплати» перерахується, а
// записана адміном сума виплати (payoutAmount) покаже розбіжність.
// =========================================================

import type { BracketMatch, Tournament } from './types';

export type BetMarket = 'match' | 'tournament';
export type BetStatus = 'pending' | 'paid' | 'rejected' | 'cancelled';

export interface Bet {
  id: string;
  tournamentId: string;
  market: BetMarket;
  /** null у ставки на матч — матч зник із сітки (сітку перегенеровано). */
  matchId: string | null;
  /** null — заявку учасника видалено. */
  pickId: string | null;
  /** Назва учасника на мить ставки. */
  pickName: string;
  stake: number;
  gameNick: string | null;
  status: BetStatus;
  createdAt: string;
  paidAt: string | null;
  payoutAt: string | null;
  payoutAmount: number | null;
}

/** Ставка в таблиці суперадміна — з гравцем. */
export interface AdminBet extends Bet {
  playerId: string;
  playerNick: string;
  adminNote: string | null;
}

/** Сума оплачених ставок на учасника ринку (bet_pools). */
export interface PoolRow {
  matchId: string | null;
  pickId: string;
  total: number;
  bets: number;
}

/** Пул одного ринку: учасник → сума оплачених ставок на нього. */
export function marketPool(pools: readonly PoolRow[], matchId: string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of pools) if (p.matchId === matchId) out.set(p.pickId, (out.get(p.pickId) ?? 0) + p.total);
  return out;
}

export function poolTotal(pool: ReadonlyMap<string, number>): number {
  let s = 0;
  for (const v of pool.values()) s += v;
  return s;
}

/** Пули з самих ставок (адмінка) — те саме правило, що тригер bet_pools у базі. */
export function poolsFromBets(bets: readonly Bet[]): PoolRow[] {
  const map = new Map<string, PoolRow>();
  for (const b of bets) {
    if (b.status !== 'paid' || !b.pickId) continue;
    if (b.market === 'match' && !b.matchId) continue;
    const matchId = b.market === 'tournament' ? null : b.matchId;
    const key = `${matchId ?? 'tournament'}|${b.pickId}`;
    const row = map.get(key) ?? { matchId, pickId: b.pickId, total: 0, bets: 0 };
    row.total += b.stake;
    row.bets += 1;
    map.set(key, row);
  }
  return [...map.values()];
}

const keep = (commissionPct: number) => 1 - Math.min(50, Math.max(0, commissionPct)) / 100;

/** Коефіцієнт на учасника зараз: пул × (1 − комісія) / ставки на нього. null — на нього
 * ще ніхто не ставив; 1 — на інших ніхто не ставив (виграш — повернення ставки). */
export function oddsFor(pool: ReadonlyMap<string, number>, pickId: string, commissionPct: number): number | null {
  const on = pool.get(pickId) ?? 0;
  if (on <= 0) return null;
  const total = poolTotal(pool);
  if (total <= on) return 1;
  return (total * keep(commissionPct)) / on;
}

/** Скільки отримає нова ставка `stake` на pickId, якщо результат буде зараз і пул більше не
 * зміниться (калькулятор у формі): ставка входить у пул разом з іншими. */
export function projectedPayout(pool: ReadonlyMap<string, number>, pickId: string, stake: number, commissionPct: number): number {
  if (stake <= 0) return 0;
  const on = (pool.get(pickId) ?? 0) + stake;
  const total = poolTotal(pool) + stake;
  if (total <= on) return stake;
  return Math.floor((stake * total * keep(commissionPct)) / on);
}

/** Стан ринку. */
export type MarketState =
  /** учасники ще невідомі / сітки ще немає */
  | { kind: 'waiting' }
  | { kind: 'open' }
  /** прийом закрито, результату ще немає */
  | { kind: 'closed' }
  | { kind: 'decided'; winnerId: string }
  /** ринок анульовано — оплаченим ставкам повернення */
  | { kind: 'void'; reason: string };

const acceptsBets = (t: Tournament): boolean =>
  !!t.bets?.enabled && t.visibility === 'public' && t.status !== 'draft' && t.status !== 'completed' && t.status !== 'cancelled';

/** Матч, що визначає чемпіона: гранд-фінал або останній раунд верхньої сітки (як у bracket.ts). */
export function decisiveMatch(matches: readonly BracketMatch[]): BracketMatch | undefined {
  const grandFinal = matches.find((m) => m.bracketSide === 'final');
  if (grandFinal) return grandFinal;
  const winners = matches.filter((m) => m.bracketSide === 'winners');
  if (!winners.length) return undefined;
  const maxRound = Math.max(...winners.map((m) => m.round));
  return winners.find((m) => m.round === maxRound);
}

const isReal = (m: BracketMatch) => !!m.participant1Id && !!m.participant2Id;
/** Прийом на матч закрито: кнопкою, рахунком серії (тригер у базі робить те саме) або результатом. */
const matchClosed = (m: BracketMatch) => !!m.betsClosedAt || !!m.winnerId || !!m.score;

export function matchMarketState(t: Tournament, m: BracketMatch | undefined): MarketState {
  if (t.status === 'cancelled') return { kind: 'void', reason: 'турнір скасовано' };
  if (!m) return { kind: 'void', reason: 'матчу вже немає в сітці' };
  if (m.winnerId) return isReal(m) ? { kind: 'decided', winnerId: m.winnerId } : { kind: 'void', reason: 'матч без суперника' };
  if (!isReal(m)) return { kind: 'waiting' };
  if (matchClosed(m) || !acceptsBets(t)) return { kind: 'closed' };
  return { kind: 'open' };
}

export function tournamentMarketState(t: Tournament, matches: readonly BracketMatch[]): MarketState {
  if (t.status === 'cancelled') return { kind: 'void', reason: 'турнір скасовано' };
  if (matches.length === 0) return { kind: 'waiting' };
  const decisive = decisiveMatch(matches);
  if (decisive?.winnerId) return { kind: 'decided', winnerId: decisive.winnerId };
  if (t.bets?.outrightClosedAt || matches.some((m) => isReal(m) && matchClosed(m)) || !acceptsBets(t)) return { kind: 'closed' };
  return { kind: 'open' };
}

/** Учасники ринку «переможець турніру» — усі, хто є в сітці. */
export function bracketParticipants(matches: readonly BracketMatch[]): string[] {
  const seen = new Set<string>();
  for (const m of [...matches].sort((a, b) => a.round - b.round || a.slot - b.slot)) {
    for (const p of [m.participant1Id, m.participant2Id]) if (p) seen.add(p);
  }
  return [...seen];
}

/** Чим закінчилась ставка. payout — скільки виплатити (виграш або повернення). */
export type BetOutcome =
  | { kind: 'unpaid' }
  | { kind: 'rejected' }
  | { kind: 'cancelled' }
  | { kind: 'active' }
  | { kind: 'won'; payout: number }
  | { kind: 'lost' }
  | { kind: 'refund'; payout: number; reason: string };

export function settleBet(bet: Bet, t: Tournament, matches: readonly BracketMatch[], pools: readonly PoolRow[]): BetOutcome {
  if (bet.status === 'pending') return { kind: 'unpaid' };
  if (bet.status === 'rejected') return { kind: 'rejected' };
  if (bet.status === 'cancelled') return { kind: 'cancelled' };
  const refund = (reason: string): BetOutcome => ({ kind: 'refund', payout: bet.stake, reason });
  if (!bet.pickId) return refund('учасника прибрали з турніру');

  let state: MarketState;
  let marketMatch: string | null = null;
  if (bet.market === 'match') {
    if (!bet.matchId) return refund('матч зник із сітки');
    const m = matches.find((x) => x.id === bet.matchId);
    if (m && bet.pickId !== m.participant1Id && bet.pickId !== m.participant2Id) return refund('учасника вже немає в цьому матчі');
    state = matchMarketState(t, m);
    marketMatch = bet.matchId;
  } else {
    if (matches.length > 0 && !bracketParticipants(matches).includes(bet.pickId)) return refund('учасника немає в сітці');
    state = tournamentMarketState(t, matches);
  }

  if (state.kind === 'void') return refund(state.reason);
  if (state.kind !== 'decided') return { kind: 'active' };

  const pool = marketPool(pools, marketMatch);
  const total = poolTotal(pool);
  const onWinner = pool.get(state.winnerId) ?? 0;
  if (onWinner <= 0) return refund('на переможця ніхто не ставив');
  if (onWinner >= total) return refund('на суперника ніхто не ставив');
  if (bet.pickId !== state.winnerId) return { kind: 'lost' };
  return { kind: 'won', payout: Math.floor((bet.stake * total * keep(t.bets?.commissionPct ?? 0)) / onWinner) };
}

/** Скільки виплатити за ставку (виграш чи повернення); 0 — нічого. */
export const payoutOf = (o: BetOutcome): number => (o.kind === 'won' || o.kind === 'refund' ? o.payout : 0);

/** Коефіцієнт для показу: «2.35». */
export const formatOdds = (k: number | null): string => (k == null ? '—' : k.toFixed(2));
