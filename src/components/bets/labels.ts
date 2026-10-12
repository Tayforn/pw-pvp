// =========================================================
// Підписи ставок — спільні для картки ставок гравця й таблиці суперадміна.
// =========================================================

import type { BracketMatch } from '../../data/types';
import type { Bet, BetOutcome, MarketState } from '../../data/betMath';
import { formatPrice } from '../../app/formatPrice';
import { bracketInfo, matchRef, stageName } from '../bracket/model';

/** «Матч В1.2 · Півфінал» / «Переможець турніру». */
export function marketLabel(bet: Pick<Bet, 'market' | 'matchId'>, matches: BracketMatch[]): string {
  if (bet.market === 'tournament') return 'Переможець турніру';
  const m = bet.matchId ? matches.find((x) => x.id === bet.matchId) : undefined;
  if (!m) return 'Матч (сітку перегенеровано)';
  const info = bracketInfo(matches);
  return `Матч ${matchRef(m, info.doubleElim)} · ${stageName(m, info)}`;
}

export function marketStateLabel(s: MarketState): { text: string; tone: 'good' | 'warn' | 'bad' | 'mute' } {
  switch (s.kind) {
    case 'open': return { text: 'прийом відкрито', tone: 'good' };
    case 'closed': return { text: 'прийом закрито', tone: 'warn' };
    case 'waiting': return { text: 'чекає учасників', tone: 'mute' };
    case 'decided': return { text: 'є результат', tone: 'mute' };
    case 'void': return { text: `анульовано — ${s.reason}`, tone: 'bad' };
  }
}

/** Підсумок ставки для гравця й адміна; paidOut — адмін уже позначив виплату. */
export function outcomeLabel(o: BetOutcome, paidOut: boolean): { text: string; tone: 'good' | 'warn' | 'bad' | 'mute' } {
  const done = paidOut ? ' · виплачено' : ' · до виплати';
  switch (o.kind) {
    case 'unpaid': return { text: 'очікує оплати', tone: 'warn' };
    case 'rejected': return { text: 'відхилено', tone: 'bad' };
    case 'cancelled': return { text: 'скасовано', tone: 'mute' };
    case 'active': return { text: 'оплачено · чекає результату', tone: 'good' };
    case 'lost': return { text: 'програла', tone: 'mute' };
    case 'won': return { text: `виграла ${formatPrice(o.payout)}${done}`, tone: 'good' };
    case 'refund': return { text: `повернення ${formatPrice(o.payout)} (${o.reason})${done}`, tone: 'warn' };
  }
}
