// =========================================================
// Логіка сітки (components/bracket/model.ts): шлях команди по сітці (порядок
// матчів, перехід перемогою / пониженням у нижню, рахунок з погляду команди),
// пʼєдестал і підсумок команди, склади (знімок жеребки → рядки гравців →
// member_nicknames), скорочення складу до «+N», пошук за ніком у складі.
// Фікстура — подвійна елімінація на 8 команд з результатами завершеного
// турніру «до Битви скринь» (генератор той самий, що на /dev/bracket).
// =========================================================

import { describe, expect, it } from 'vitest';
import type { BalanceStats, BracketMatch, Registration } from '../../data/types';
import { applyWinner, doubleElim, fakeTeams, singleElim } from '../../pages/DevBracketPage';
import {
  bracketInfo, matchRef, podiumIds, rosterFor, searchParticipants, shortRoster, stageName, stepScore, teamPath, teamStanding,
} from '../bracket/model';

const T = (n: number) => `team-${n}`;
const REGS = fakeTeams(8, 3, 't');

/** Результати реального турніру: [матч, переможець, рахунок «p1-p2»]. */
const PLAYS: [string, number, string][] = [
  ['w1-0', 1, '2-0'], ['w1-1', 3, '2-0'], ['w1-2', 2, '1-2'], ['w1-3', 6, '1-2'],
  ['w2-0', 1, '2-1'], ['w2-1', 6, '0-2'], ['w3-0', 6, '1-2'],
  ['l1-0', 5, '1-2'], ['l1-1', 7, '2-1'], ['l2-0', 3, '0-2'], ['l2-1', 7, '2-0'], ['l3-0', 3, '2-0'], ['l4-0', 3, '2-1'],
  ['gf', 3, '2-3'],
];

function played(upTo = PLAYS.length): BracketMatch[] {
  let ms = doubleElim([T(1), T(8), T(3), T(5), T(7), T(2), T(4), T(6)]).map((m) => ({ ...m, format: m.bracketSide === 'final' ? 'bo5' : 'bo3' }));
  for (const [id, w, score] of PLAYS.slice(0, upTo)) ms = applyWinner(ms, id, T(w), score);
  return ms;
}

describe('teamPath — шлях команди по сітці', () => {
  const ms = played();
  const info = bracketInfo(ms);

  it('чемпіон із нижньої: порядок матчів, перехід пониженням, рахунок зі свого боку', () => {
    const path = teamPath(T(3), ms);
    expect(path.map((s) => matchRef(s.m, true))).toEqual(['В1.2', 'В2.1', 'Н2.1', 'Н3.1', 'Н4.1', 'ГФ']);
    expect(path.map((s) => s.outcome)).toEqual(['win', 'loss', 'win', 'win', 'win', 'win']);
    expect(path.map((s) => s.via)).toEqual(['start', 'win', 'drop', 'win', 'win', 'win']);
    // у В2.1 команда — другий слот (рахунок «2-1» на користь першого)
    expect(path.map(stepScore)).toEqual(['2:0', '1:2', '2:0', '2:0', '2:1', '3:2']);
    expect(path[2].fromId).toBe('w2-0');
    expect(path[1].opponentId).toBe(T(1));
  });

  it('BO1 — без рахунку в кроці, лише результат', () => {
    const se = applyWinner(singleElim([T(1), T(2), T(3), T(4)], false), 'w1-0', T(1), '1-0');
    const [step] = teamPath(T(1), se);
    expect(step.outcome).toBe('win');
    expect(stepScore(step)).toBe('');
  });

  it('пʼєдестал і підсумок: 1 — ГФ, 2 — програний ГФ, 3 — програний фіналу нижньої', () => {
    const podium = podiumIds(ms, info);
    expect(podium).toEqual({ first: T(3), second: T(6), third: T(1) });
    expect(teamStanding(T(3), teamPath(T(3), ms), podium, true)).toMatchObject({ place: 1, label: 'Чемпіон' });
    expect(teamStanding(T(6), teamPath(T(6), ms), podium, true)).toMatchObject({ place: 2, label: '2 місце' });
    expect(teamStanding(T(1), teamPath(T(1), ms), podium, true)).toMatchObject({ place: 3, label: '3 місце' });
    expect(teamStanding(T(7), teamPath(T(7), ms), podium, true)).toMatchObject({ place: null, label: 'вибув у Н3.1', tone: 'bad' });
  });

  it('турнір триває: «грає ГФ», «чекає суперника», пʼєдесталу немає', () => {
    const live = played(PLAYS.length - 1);
    const podium = podiumIds(live);
    expect(podium.first).toBeNull();
    expect(teamStanding(T(3), teamPath(T(3), live), podium, true).label).toBe('грає ГФ');
    const waiting = played(7); // зіграна вся верхня: переможець В3.1 чекає в ГФ
    expect(teamStanding(T(6), teamPath(T(6), waiting), podiumIds(waiting), true).label).toBe('чекає суперника · ГФ');
  });

  it('назви етапів', () => {
    const byId = (id: string) => ms.find((m) => m.id === id)!;
    expect(stageName(byId('w3-0'), info)).toBe('Фінал верхньої сітки');
    expect(stageName(byId('l4-0'), info)).toBe('Фінал нижньої сітки');
    expect(stageName(byId('l2-1'), info)).toBe('Нижня сітка · раунд 2');
    expect(stageName(byId('gf'), info)).toBe('Гранд-фінал');
    const se = singleElim([T(1), T(2), T(3), T(4), T(5), T(6), T(7), T(8)], true);
    const seInfo = bracketInfo(se);
    expect(seInfo.doubleElim).toBe(false);
    expect(stageName(se.find((m) => m.id === 'w2-0')!, seInfo)).toBe('Півфінал');
    expect(stageName(se.find((m) => m.id === 'third')!, seInfo)).toBe('Матч за 3-тє місце');
    expect(matchRef(se.find((m) => m.id === 'w1-2')!, false)).toBe('1.3');
  });
});

describe('rosterFor — склад учасника', () => {
  const player = (id: string, nickname: string, team: string, cls: 'cleric' | 'barbarian' | null): Registration => ({
    ...REGS[0], id, nickname, kind: 'player', teamRegistrationId: team, memberNicknames: null,
    gear: cls ? ({ charClass: cls } as Registration['gear']) : null,
  });
  const team = { ...REGS[0], id: 'tm', nickname: 'Команда 1', memberNicknames: ['Eddie', 'Free', 'Neo'] };

  it('знімок жеребки: порядок і ранги зі знімка, нік — із живого рядка гравця', () => {
    const regs = [team, player('p2', 'Free', 'tm', 'barbarian'), player('p1', 'Eddie-renamed', 'tm', 'cleric')];
    const stats: BalanceStats['teams'] = [{
      name: 'Команда 1', total: 0, members: [
        { registrationId: 'p1', nickname: 'Eddie', charClass: 'cleric', score: 214, tier: 'A' },
        { registrationId: 'p2', nickname: 'Free', charClass: 'barbarian', score: 156, tier: 'B' },
      ],
    }];
    expect(rosterFor('tm', regs, stats)).toEqual([
      { nickname: 'Eddie-renamed', cls: 'Прист', tier: 'A' },
      { nickname: 'Free', cls: 'Танк', tier: 'B' },
    ]);
  });

  it('без знімка — рядки гравців у порядку member_nicknames; без них — member_nicknames', () => {
    const regs = [team, player('p2', 'Free', 'tm', 'barbarian'), player('p1', 'Eddie', 'tm', null), player('p3', 'Neo', 'tm', 'cleric')];
    expect(rosterFor('tm', regs, null)).toEqual([{ nickname: 'Eddie', cls: undefined }, { nickname: 'Free', cls: 'Танк' }, { nickname: 'Neo', cls: 'Прист' }]);
    expect(rosterFor('tm', [team], null).map((m) => m.nickname)).toEqual(['Eddie', 'Free', 'Neo']);
  });

  it('соло й невідомий учасник — порожньо', () => {
    expect(rosterFor('solo', [{ ...REGS[0], id: 'solo', kind: 'player', memberNicknames: null }], null)).toEqual([]);
    expect(rosterFor('nope', REGS, null)).toEqual([]);
    expect(rosterFor(null, REGS, null)).toEqual([]);
  });
});

describe('shortRoster — склад у картці з «+N»', () => {
  const names = ['EddieMunson', '~FreeKill~', 'NeO[N]'];
  const fitsUpTo = (n: number) => (text: string) => text.length <= n;

  it('вміщається — повністю', () => {
    expect(shortRoster(names, fitsUpTo(100))).toEqual({ shown: 'EddieMunson, ~FreeKill~, NeO[N]', more: 0 });
  });

  it('не вміщається — скільки влазить, решта «+N»; перший нік лишається завжди', () => {
    expect(shortRoster(names, fitsUpTo(26))).toEqual({ shown: 'EddieMunson, ~FreeKill~', more: 1 });
    expect(shortRoster(names, fitsUpTo(15))).toEqual({ shown: 'EddieMunson', more: 2 });
    expect(shortRoster(names, fitsUpTo(3))).toEqual({ shown: 'EddieMunson', more: 2 });
    expect(shortRoster([], fitsUpTo(3))).toEqual({ shown: '', more: 0 });
  });

  it('у списку (картка ширша, «+N» не потрібен) — завжди весь склад, навіть довгий: обріже CSS-трикрапка', () => {
    const long = ['EddieMunson', '~FreeKill~', 'NeO[N]', 'under_armour (Sergey)', 'Infernoman(Арсен)'];
    expect(shortRoster(long, () => true)).toEqual({ shown: long.join(', '), more: 0 });
  });
});

describe('searchParticipants — пошук гравця або команди', () => {
  const ids = REGS.map((r) => r.id);
  const rosterOf = (id: string) => rosterFor(id, REGS, null);

  it('за ніком у складі — команда й нік, що збігся (без регістру)', () => {
    const nick = REGS[2].memberNicknames![1];
    expect(searchParticipants(nick.toUpperCase(), ids, REGS, rosterOf)).toEqual([{ id: T(3), nick }]);
  });

  it('за назвою команди — без ніку; кілька збігів — усі', () => {
    expect(searchParticipants('команда 7', ids, REGS, rosterOf)).toEqual([{ id: T(7) }]);
    expect(searchParticipants('Команда', ids, REGS, rosterOf)).toHaveLength(8);
    expect(searchParticipants('   ', ids, REGS, rosterOf)).toEqual([]);
  });
});
