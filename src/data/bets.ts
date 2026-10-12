// =========================================================
// Ставки в юанях (міграція 0036; логіка тоталізатора — betMath.ts).
//
//  * гравець (вхід через Discord) ставить через бекенд ладдера — POST /api/pvp/bets:
//    хто ставить, знає лише Discord-сесія, тож anon-ключ сайту ставок не пише;
//  * коефіцієнти — з публічної таблиці bet_pools (лише оплачені ставки);
//  * таблиця ставок, оплата й виплата, закриття прийому, налаштування — суперадмін
//    напряму в Supabase (RLS: is_superadmin()).
// =========================================================

import { supabase } from '../app/supabaseClient';
import { isMissingColumnError } from './tournaments';
import type { BetSettings } from './types';
import type { AdminBet, Bet, BetStatus, PoolRow } from './betMath';

/** До міграції 0036 таблиць немає — публічна сторінка від цього не падає. */
const missingTable = (e: { code?: string | null; message?: string | null }) =>
  e.code === 'PGRST205' || e.code === '42P01' || /does not exist|Could not find the table/i.test(e.message ?? '');

// ── Публічно: пули ───────────────────────────────────────────

interface PoolDbRow { match_id: string | null; pick_id: string; total: number | string; bets: number }

export async function fetchBetPools(tournamentId: string): Promise<PoolRow[]> {
  const { data, error } = await supabase.from('bet_pools').select('match_id, pick_id, total, bets').eq('tournament_id', tournamentId);
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return (data as PoolDbRow[]).map((r) => ({ matchId: r.match_id, pickId: r.pick_id, total: Number(r.total), bets: r.bets }));
}

let channelSeq = 0;

/** Пули (і, для суперадміна, самі ставки — realtime поважає RLS) наживо. */
export function subscribeToBetChanges(tournamentId: string, onChange: () => void): () => void {
  const filter = `tournament_id=eq.${tournamentId}`;
  const channel = supabase
    .channel(`bets-${tournamentId}-${++channelSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bet_pools', filter }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bets', filter }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

// ── Суперадмін ───────────────────────────────────────────────

interface BetDbRow {
  id: string; tournament_id: string; market: 'match' | 'tournament'; match_id: string | null; pick_id: string | null;
  pick_name: string; stake: number | string; game_nick: string | null; status: BetStatus; created_at: string;
  paid_at: string | null; payout_at: string | null; payout_amount: number | string | null;
  player_id: string; player_nick: string; admin_note: string | null;
}

const adminBetFromRow = (r: BetDbRow): AdminBet => ({
  id: r.id, tournamentId: r.tournament_id, market: r.market, matchId: r.match_id, pickId: r.pick_id, pickName: r.pick_name,
  stake: Number(r.stake), gameNick: r.game_nick, status: r.status, createdAt: r.created_at, paidAt: r.paid_at,
  payoutAt: r.payout_at, payoutAmount: r.payout_amount == null ? null : Number(r.payout_amount),
  playerId: r.player_id, playerNick: r.player_nick, adminNote: r.admin_note,
});

export async function fetchAdminBets(tournamentId: string): Promise<AdminBet[]> {
  const { data, error } = await supabase.from('bets').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: false });
  if (error) {
    if (missingTable(error)) return [];
    throw error;
  }
  return (data as BetDbRow[]).map(adminBetFromRow);
}

/** Оплачено / відхилено / знову «очікує оплати». Час і хто — штампує база. */
export async function setBetStatus(id: string, status: Exclude<BetStatus, 'cancelled'>): Promise<void> {
  const { error } = await supabase.from('bets').update({ status }).eq('id', id);
  if (error) throw error;
}

/** Записати виплату (сума, яку адмін передав у грі); null — скасувати позначку. */
export async function setBetPayout(id: string, amount: number | null): Promise<void> {
  const { error } = await supabase.from('bets').update({ payout_amount: amount }).eq('id', id);
  if (error) throw error;
}

/** «Бій почався» — закрити прийом на матч (closed=false — відкрити знову). */
export async function setMatchBetsClosed(matchId: string, closed: boolean): Promise<void> {
  const { error } = await supabase.from('bracket_matches').update({ bets_closed_at: closed ? new Date().toISOString() : null }).eq('id', matchId);
  if (error) throw error;
}

export async function setOutrightBetsClosed(tournamentId: string, closed: boolean): Promise<void> {
  const { error } = await supabase.from('tournaments').update({ outright_bets_closed_at: closed ? new Date().toISOString() : null }).eq('id', tournamentId);
  if (error) throw error;
}

export async function updateBetSettings(tournamentId: string, s: Omit<BetSettings, 'outrightClosedAt'>): Promise<void> {
  const { error } = await supabase
    .from('tournaments')
    .update({
      bets_enabled: s.enabled,
      bet_commission_pct: s.commissionPct,
      bet_min_stake: s.minStake,
      bet_max_stake: s.maxStake,
      bet_treasurer: s.treasurer?.trim() || null,
    })
    .eq('id', tournamentId);
  if (error) {
    if (isMissingColumnError(error, 'bets_enabled')) throw new Error('Ставки ще не ввімкнено в базі — спершу виконайте міграцію 0036_bets.sql.');
    throw error;
  }
}

// ── Гравець: бекенд ладдера ─────────────────────────────────

export const BETS_URL = '/api/pvp/bets';

/** Помилка бекенда ставок: код (unauthorized, conflict, rate_limited…) і текст для гравця. */
export class BetApiError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new BetApiError('network', 0, 'Немає звʼязку з сервером — перевір інтернет і спробуй ще раз.');
  }
  if (res.ok) return (await res.json()) as T;
  let code = 'internal';
  let message = 'Сервер не зміг прийняти ставку. Спробуй пізніше.';
  try {
    const j = (await res.json()) as { error?: string; message?: string };
    if (j.error) code = j.error;
    if (j.message) message = j.message;
  } catch {
    /* не JSON — лишаємо загальний текст */
  }
  if (res.status === 401) message = 'Ставити можна лише після входу через Discord.';
  throw new BetApiError(code, res.status, message);
}

export interface PlaceBetInput {
  tournamentId: string;
  /** null — на переможця турніру */
  matchId: string | null;
  pickId: string;
  stake: number;
  gameNick?: string;
}

export async function placeBet(input: PlaceBetInput): Promise<Bet> {
  return (await request<{ bet: Bet }>('POST', BETS_URL, input)).bet;
}

/** Свої ставки на турнір; null — не увійшов (401) чи бекенд ставок не налаштовано. */
export async function fetchMyBets(tournamentId: string): Promise<Bet[] | null> {
  try {
    return (await request<{ bets: Bet[] }>('GET', `${BETS_URL}/mine?tournamentId=${encodeURIComponent(tournamentId)}`)).bets;
  } catch (e) {
    if (e instanceof BetApiError && (e.status === 401 || e.status === 503 || e.status === 404)) return null;
    throw e;
  }
}

export async function cancelMyBet(id: string): Promise<Bet> {
  return (await request<{ bet: Bet }>('POST', `${BETS_URL}/${encodeURIComponent(id)}/cancel`)).bet;
}
