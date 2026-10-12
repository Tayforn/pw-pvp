import { describe, expect, it } from 'vitest';
import {
  bracketParticipants, marketPool, matchMarketState, oddsFor, payoutOf, poolsFromBets, projectedPayout, settleBet,
  tournamentMarketState, type Bet, type PoolRow,
} from '../betMath';
import { formatPrice, parsePriceInput, formatPriceInputMask } from '../../app/formatPrice';
import type { BracketMatch, BracketSide, Tournament } from '../types';

function m(id: string, bracketSide: BracketSide, round: number, over: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id, tournamentId: 't1', bracketSide, round, slot: 0, format: 'bo1',
    participant1Id: null, participant2Id: null, winnerId: null, score: null,
    nextMatchId: null, nextMatchSlot: null, loserNextMatchId: null, loserNextMatchSlot: null,
    betsClosedAt: null, ...over,
  };
}

const tournament = (over: Partial<Tournament> = {}, bets: Partial<NonNullable<Tournament['bets']>> = {}): Tournament => ({
  id: 't1', seriesId: null, name: 'Cup', eventDate: '2026-10-12', status: 'in_progress', rulesMd: null, prizesMd: null,
  bracketType: 'single_elim', bracketSize: 4, teamSize: null, createdBy: null, visibility: 'public', thirdPlaceMatch: false,
  bracketNewLook: true, teamMode: 'fixed', balanceSeed: null, bracketSeed: null, balanceRulesVersion: null, balanceStats: null,
  ruleFlags: null,
  bets: { enabled: true, commissionPct: 0, minStake: 1_000_000, maxStake: null, treasurer: 'Bank', outrightClosedAt: null, ...bets },
  ...over,
});

let seq = 0;
const bet = (over: Partial<Bet>): Bet => ({
  id: `b${++seq}`, tournamentId: 't1', market: 'match', matchId: 'm1', pickId: 'a', pickName: 'A', stake: 10_000_000,
  gameNick: null, status: 'paid', createdAt: '2026-10-12T10:00:00Z', paidAt: null, payoutAt: null, payoutAmount: null, ...over,
});

// півфінали a–b, c–d і фінал
const semis = (over1: Partial<BracketMatch> = {}, overF: Partial<BracketMatch> = {}) => [
  m('m1', 'winners', 1, { participant1Id: 'a', participant2Id: 'b', ...over1 }),
  m('m2', 'winners', 1, { slot: 1, participant1Id: 'c', participant2Id: 'd' }),
  m('mf', 'winners', 2, overF),
];

describe('коефіцієнти тоталізатора', () => {
  const pool = new Map([['a', 30_000_000], ['b', 10_000_000]]);

  it('коеф. = пул × (1 − комісія) / ставки на учасника', () => {
    expect(oddsFor(pool, 'a', 0)).toBeCloseTo(40 / 30);
    expect(oddsFor(pool, 'b', 0)).toBe(4);
    expect(oddsFor(pool, 'b', 5)).toBeCloseTo(3.8);
  });

  it('на учасника ніхто не ставив — коефіцієнта немає; лише на одного — 1 (повернення)', () => {
    expect(oddsFor(pool, 'c', 0)).toBeNull();
    expect(oddsFor(new Map([['a', 5]]), 'a', 10)).toBe(1);
  });

  it('калькулятор: нова ставка входить у пул', () => {
    // 2ч на b: на b стає 3ч, пул 6ч → 2 × 6 / 3 = 4ч
    expect(projectedPayout(pool, 'b', 20_000_000, 0)).toBe(40_000_000);
    expect(projectedPayout(new Map(), 'a', 5_000_000, 0)).toBe(5_000_000);
    expect(projectedPayout(pool, 'a', 0, 0)).toBe(0);
  });

  it('пули з самих ставок — лише оплачені, ставка на зниклий матч — у жоден пул', () => {
    const rows = poolsFromBets([
      bet({ pickId: 'a', stake: 3 }), bet({ pickId: 'a', stake: 4 }), bet({ pickId: 'b', stake: 5, status: 'pending' }),
      bet({ market: 'tournament', matchId: null, pickId: 'c', stake: 6 }), bet({ matchId: null, pickId: 'a', stake: 100 }),
    ]);
    expect(marketPool(rows, 'm1')).toEqual(new Map([['a', 7]]));
    expect(marketPool(rows, null)).toEqual(new Map([['c', 6]]));
  });
});

describe('стан ринку', () => {
  it('матч: чекає учасників → відкрито → закрито (кнопка / рахунок) → результат; bye — анульовано', () => {
    const t = tournament();
    expect(matchMarketState(t, m('x', 'winners', 2, { participant1Id: 'a' })).kind).toBe('waiting');
    expect(matchMarketState(t, semis()[0]).kind).toBe('open');
    expect(matchMarketState(t, semis({ betsClosedAt: '2026-10-12T11:00:00Z' })[0]).kind).toBe('closed');
    expect(matchMarketState(t, semis({ score: '1-0' })[0]).kind).toBe('closed');
    expect(matchMarketState(t, semis({ winnerId: 'b' })[0])).toEqual({ kind: 'decided', winnerId: 'b' });
    expect(matchMarketState(t, m('x', 'winners', 1, { participant1Id: 'a', winnerId: 'a' })).kind).toBe('void');
    expect(matchMarketState(t, undefined).kind).toBe('void');
    expect(matchMarketState(tournament({ status: 'cancelled' }), semis()[0]).kind).toBe('void');
    // ставки вимкнено чи турнір unlisted — прийом закрито
    expect(matchMarketState(tournament({}, { enabled: false }), semis()[0]).kind).toBe('closed');
    expect(matchMarketState(tournament({ visibility: 'unlisted' }), semis()[0]).kind).toBe('closed');
  });

  it('турнір: відкрито до першого закритого справжнього матчу; чемпіон — переможець фіналу', () => {
    const t = tournament();
    expect(tournamentMarketState(t, []).kind).toBe('waiting');
    expect(tournamentMarketState(t, semis()).kind).toBe('open');
    expect(tournamentMarketState(tournament({}, { outrightClosedAt: 'x' }), semis()).kind).toBe('closed');
    expect(tournamentMarketState(t, semis({ score: '1-0' })).kind).toBe('closed');
    expect(tournamentMarketState(t, semis({ winnerId: 'a' }, { participant1Id: 'a', participant2Id: 'c', winnerId: 'c' })))
      .toEqual({ kind: 'decided', winnerId: 'c' });
    expect(bracketParticipants(semis())).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('розрахунок ставки', () => {
  const pools: PoolRow[] = [
    { matchId: 'm1', pickId: 'a', total: 30_000_000, bets: 2 },
    { matchId: 'm1', pickId: 'b', total: 10_000_000, bets: 1 },
  ];

  it('виграш — частка пулу мінус комісія; програш — нуль', () => {
    const decided = semis({ winnerId: 'b' });
    const won = settleBet(bet({ pickId: 'b', stake: 10_000_000 }), tournament({}, { commissionPct: 5 }), decided, pools);
    expect(won).toEqual({ kind: 'won', payout: 38_000_000 });
    expect(settleBet(bet({ pickId: 'a', stake: 20_000_000 }), tournament(), decided, pools)).toEqual({ kind: 'lost' });
    // частка округлюється вниз
    const odd = settleBet(bet({ pickId: 'a', stake: 10_000_000 }), tournament(), semis({ winnerId: 'a' }), pools);
    expect(odd).toEqual({ kind: 'won', payout: 13_333_333 });
  });

  it('до результату — у грі; неоплачена, відхилена, скасована — без виплати', () => {
    expect(settleBet(bet({}), tournament(), semis(), pools).kind).toBe('active');
    expect(settleBet(bet({ status: 'pending' }), tournament(), semis({ winnerId: 'a' }), pools).kind).toBe('unpaid');
    expect(settleBet(bet({ status: 'rejected' }), tournament(), semis(), pools).kind).toBe('rejected');
    expect(payoutOf(settleBet(bet({ status: 'cancelled' }), tournament(), semis(), pools))).toBe(0);
  });

  it('повернення: ніхто не ставив на переможця чи на суперника, ринок анульовано', () => {
    const onlyA: PoolRow[] = [{ matchId: 'm1', pickId: 'a', total: 30_000_000, bets: 2 }];
    expect(settleBet(bet({ pickId: 'a', stake: 7 }), tournament(), semis({ winnerId: 'a' }), onlyA)).toMatchObject({ kind: 'refund', payout: 7 });
    expect(settleBet(bet({ pickId: 'a', stake: 7 }), tournament(), semis({ winnerId: 'b' }), onlyA)).toMatchObject({ kind: 'refund', payout: 7 });
    expect(settleBet(bet({ matchId: null, stake: 7 }), tournament(), semis(), pools)).toMatchObject({ kind: 'refund', reason: 'матч зник із сітки' });
    expect(settleBet(bet({ pickId: null, stake: 7 }), tournament(), semis(), pools)).toMatchObject({ kind: 'refund' });
    expect(settleBet(bet({ pickId: 'c', stake: 7 }), tournament(), semis(), pools)).toMatchObject({ kind: 'refund', reason: 'учасника вже немає в цьому матчі' });
    expect(settleBet(bet({ stake: 7 }), tournament({ status: 'cancelled' }), semis({ winnerId: 'a' }), pools)).toMatchObject({ kind: 'refund', reason: 'турнір скасовано' });
  });

  it('переможець турніру: пул ринку турніру, учасник поза сіткою — повернення', () => {
    const outright: PoolRow[] = [
      { matchId: null, pickId: 'c', total: 20_000_000, bets: 1 },
      { matchId: null, pickId: 'a', total: 20_000_000, bets: 1 },
    ];
    const done = semis({ winnerId: 'a' }, { participant1Id: 'a', participant2Id: 'c', winnerId: 'c' });
    expect(settleBet(bet({ market: 'tournament', matchId: null, pickId: 'c', stake: 20_000_000 }), tournament(), done, outright))
      .toEqual({ kind: 'won', payout: 40_000_000 });
    expect(settleBet(bet({ market: 'tournament', matchId: null, pickId: 'z', stake: 5 }), tournament(), done, outright))
      .toMatchObject({ kind: 'refund', reason: 'учасника немає в сітці' });
  });
});

describe('суми в юанях (як у гільдії)', () => {
  it('10 000 000 = 1ч, 20кк = 2ч, 25.6ч', () => {
    expect(formatPrice(10_000_000)).toBe('1ч');
    expect(formatPrice(20_000_000)).toBe('2ч');
    expect(formatPrice(256_000_000)).toBe('25.6ч');
    expect(formatPrice(1_500_000)).toBe('1.5кк');
    expect(formatPrice(999_999)).toBe('1кк');
    expect(parsePriceInput(formatPriceInputMask('10000000'))).toBe(10_000_000);
  });
});
