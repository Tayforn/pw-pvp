import { describe, expect, it } from 'vitest';
import { thirdFromLosersFinal } from '../podium';
import type { BracketMatch, BracketSide } from '../types';

/** Мінімальний матч — у тесті важливі лише сторона, раунд і учасники. */
function m(bracketSide: BracketSide, round: number, over: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: `${bracketSide}-${round}-${over.slot ?? 1}`,
    tournamentId: 't1',
    bracketSide,
    round,
    slot: 1,
    format: 'bo1',
    participant1Id: null,
    participant2Id: null,
    winnerId: null,
    score: null,
    nextMatchId: null,
    nextMatchSlot: null,
    loserNextMatchId: null,
    loserNextMatchSlot: null,
    ...over,
  };
}

describe('третє місце в подвійній елімінації', () => {
  it('бронза — програний фіналу нижньої сітки', () => {
    const matches = [
      m('winners', 1, { participant1Id: 'a', participant2Id: 'b', winnerId: 'a' }),
      m('losers', 1, { participant1Id: 'c', participant2Id: 'd', winnerId: 'c' }),
      m('losers', 2, { participant1Id: 'b', participant2Id: 'c', winnerId: 'b' }),
      m('final', 1, { participant1Id: 'a', participant2Id: 'b', winnerId: 'a' }),
    ];
    // Фінал нижньої — losers раунд 2: виграв b (пішов у гранд-фінал), тож третій — c.
    expect(thirdFromLosersFinal(matches)).toBe('c');
  });

  it('фінал нижньої ще не зіграний — бронзи немає', () => {
    const matches = [m('losers', 2, { participant1Id: 'b', participant2Id: 'c' })];
    expect(thirdFromLosersFinal(matches)).toBeNull();
  });

  it('одинарна елімінація (немає нижньої сітки) — null', () => {
    const matches = [m('winners', 1, { participant1Id: 'a', participant2Id: 'b', winnerId: 'a' })];
    expect(thirdFromLosersFinal(matches)).toBeNull();
  });

  it('кілька матчів у найвищому раунді нижньої — не вгадуємо', () => {
    const matches = [
      m('losers', 3, { slot: 1, participant1Id: 'a', participant2Id: 'b', winnerId: 'a' }),
      m('losers', 3, { slot: 2, participant1Id: 'c', participant2Id: 'd', winnerId: 'c' }),
    ];
    expect(thirdFromLosersFinal(matches)).toBeNull();
  });
});
