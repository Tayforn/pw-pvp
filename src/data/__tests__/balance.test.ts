import { describe, expect, it } from 'vitest';
import {
  createRng, evaluateTeams, formTeams, hashString, penalty, signature, suggestReplacement, teamStats, unavoidable,
  type BalancePlayer, type FormTeamsOptions,
} from '../balance';
import { CLASS_ORDER, rulesFor } from '../gearRules';
import type { CharClass } from '../types';

const rules = rulesFor().balance;
const baseOpts = (over: Partial<FormTeamsOptions> = {}): FormTeamsOptions => ({
  teamSize: 6, seed: 'test-seed', rules, rulesVersion: 'balance-v1.0', restarts: 4, iterations: 3000, ...over,
});

/** Синтетична популяція: детермінована за seed, класи рівномірно, score ~ [20, 170]. */
function population(n: number, seed: string, opts: { classes?: CharClass[] } = {}): BalancePlayer[] {
  const rng = createRng('pop:' + seed);
  const classes = opts.classes ?? CLASS_ORDER;
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(3, '0')}`,
    nickname: `Nick${i}`,
    cls: classes[Math.floor(rng() * classes.length)],
    score: 20 + Math.floor(rng() * 150),
    createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, i)).toISOString(),
  }));
}

const totals = (teams: BalancePlayer[][]) => teams.map((t) => t.reduce((s, p) => s + p.score, 0));
const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
const dupsOf = (teams: BalancePlayer[][]) => teams.reduce((acc, t) => acc + teamStats(t, rules).dup, 0);

describe('formTeams', () => {
  it('детермінований: той самий вхід і seed → той самий склад; інший seed → інший', () => {
    const players = population(60, 'a');
    const r1 = formTeams(players, baseOpts());
    const r2 = formTeams(players.slice().reverse(), baseOpts()); // інший порядок входу
    const r3 = formTeams(players, baseOpts({ seed: 'other-seed' }));
    expect(signature(r1.teams)).toBe(signature(r2.teams));
    expect(r1.snapshot.inputHash).toBe(r2.snapshot.inputHash);
    expect(signature(r1.teams)).not.toBe(signature(r3.teams));
  });

  it('гравців менше ніж на 2 команди → зрозуміла помилка', () => {
    expect(() => formTeams(population(11, 'b'), baseOpts())).toThrow(/щонайменше 12/);
    expect(() => formTeams(population(7, 'b'), baseOpts())).toThrow();
  });

  it('K = ⌊N/S⌋, залишок — у резерв за політикою latest (останні за часом реєстрації)', () => {
    const players = population(15, 'c');
    const r = formTeams(players, baseOpts());
    expect(r.teams).toHaveLength(2);
    expect(r.teams.every((t) => t.length === 6)).toBe(true);
    expect(r.reserve.map((p) => p.id)).toEqual(['p012', 'p013', 'p014']);
  });

  it('teamCount задає кількість команд (double_elim), решта — в резерв', () => {
    const r = formTeams(population(30, 'd'), baseOpts({ teamCount: 4 }));
    expect(r.teams).toHaveLength(4);
    expect(r.reserve).toHaveLength(6);
    expect(r.snapshot.teamCount).toBe(4);
  });

  it('політика manual: закріплені — у резерві першими; забагато закріплених → помилка', () => {
    const players = population(14, 'e');
    const r = formTeams(players, baseOpts({ reservePolicy: 'manual', pinnedReserveIds: ['p003'] }));
    expect(r.reserve[0].id).toBe('p003');
    expect(r.reserve).toHaveLength(2);
    expect(r.teams.flat().some((p) => p.id === 'p003')).toBe(false);
    expect(() => formTeams(players, baseOpts({ reservePolicy: 'manual', pinnedReserveIds: ['p000', 'p001', 'p002'] }))).toThrow(/забагато/);
  });

  it('політика random: детермінована за seed, резерв не обов\'язково останні', () => {
    const players = population(20, 'f');
    const r1 = formTeams(players, baseOpts({ reservePolicy: 'random' }));
    const r2 = formTeams(players, baseOpts({ reservePolicy: 'random' }));
    expect(r1.reserve.map((p) => p.id)).toEqual(r2.reserve.map((p) => p.id));
    expect(r1.teams).toHaveLength(3); // 20 / 6
    expect(r1.reserve).toHaveLength(2);
  });

  it('класи не повторюються в команді, якщо це можливо; при N_c > K дублі — лише неминучі й рівномірні', () => {
    const players = population(60, 'g');
    const r = formTeams(players, baseOpts());
    const unav = unavoidable(r.teams.flat(), r.teams.length, rules);
    expect(dupsOf(r.teams)).toBe(unav.dups);

    // 10 сінів на 5 команд → рівно по 2 в кожній
    const skew = population(30, 'h', { classes: ['cleric', 'wizard', 'archer', 'barbarian', 'venomancer', 'psychic', 'seeker', 'mystic', 'blademaster'] });
    for (let i = 0; i < 10; i++) skew[i].cls = 'assassin';
    const rs = formTeams(skew, baseOpts({ teamSize: 6 }));
    const sinsPerTeam = rs.teams.map((t) => t.filter((p) => p.cls === 'assassin').length);
    expect(sinsPerTeam).toEqual([2, 2, 2, 2, 2]);
    expect(dupsOf(rs.teams)).toBe(unavoidable(rs.teams.flat(), 5, rules).dups);
  });

  it('суми команд близькі (розкид ≤ 4 % середньої суми на синтетиці)', () => {
    const players = population(60, 'i');
    const r = formTeams(players, baseOpts({ restarts: 4, iterations: 20000 }));
    const t = totals(r.teams);
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    expect(range(t)).toBeLessThanOrEqual(mean * 0.04);
  });

  it('усі score рівні → штраф 0, склад усе одно випадковий, класи унікальні', () => {
    const players = population(24, 'j').map((p) => ({ ...p, score: 100 }));
    const r1 = formTeams(players, baseOpts({ seed: 's1' }));
    const r2 = formTeams(players, baseOpts({ seed: 's2' }));
    expect(r1.penalty).toBe(0);
    expect(signature(r1.teams)).not.toBe(signature(r2.teams));
    expect(dupsOf(r1.teams)).toBe(unavoidable(r1.teams.flat(), 4, rules).dups);
  });

  it('snapshot: зміна одного гравця змінює inputHash; players відсортовані за id', () => {
    const players = population(24, 'k');
    const a = formTeams(players, baseOpts());
    const changed = players.map((p) => (p.id === 'p005' ? { ...p, score: p.score + 1 } : p));
    const b = formTeams(changed, baseOpts());
    expect(a.snapshot.inputHash).not.toBe(b.snapshot.inputHash);
    expect(a.snapshot.players.map((x) => x[0])).toEqual(players.map((p) => p.id).sort());
    expect(a.snapshot.algoVersion).toBe('teams-ls-v1');
  });
});

describe('penalty на впорядкованих статистиках', () => {
  const mk = (scores: number[]): BalancePlayer[] =>
    scores.map((s, i) => ({ id: `x${i}`, nickname: `X${i}`, cls: CLASS_ORDER[i], score: s, createdAt: '' }));

  it('приклад §15 спеки: рівні суми, але стек топів → штраф 242.4 (лише сума дала б 0)', () => {
    const A = mk([250, 245, 230, 120, 115, 110]);
    const B = mk([180, 180, 180, 180, 180, 170]);
    const unav = { dups: 0, roleSlack: { support: 1, tank: 1, ranged: 1, melee: 1, control: 1 } };
    const stats = [teamStats(A, rules), teamStats(B, rules)];
    expect(stats[0].total).toBe(1070);
    expect(stats[1].total).toBe(1070);
    expect(penalty(stats, 6, unav, rules)).toBeCloseTo(242.4, 1);
  });

  it('evaluateTeams після ручного свопу перераховує штраф і дублі', () => {
    const players = population(24, 'l');
    const r = formTeams(players, baseOpts());
    const before = evaluateTeams(r.teams, rules).penalty;
    expect(before).toBeCloseTo(r.penalty, 6);
    const swapped = r.teams.map((t) => t.slice());
    [swapped[0][0], swapped[1][0]] = [swapped[1][0], swapped[0][0]];
    const after = evaluateTeams(swapped, rules);
    expect(after.stats).toHaveLength(4);
    expect(Number.isFinite(after.penalty)).toBe(true);
  });
});

describe('suggestReplacement', () => {
  it('порядок: той самий клас → клас, якого нема в команді → решта; далі найближчий score', () => {
    const team: BalancePlayer[] = [
      { id: 't1', nickname: 'T1', cls: 'cleric', score: 100, createdAt: '' },
      { id: 't2', nickname: 'T2', cls: 'wizard', score: 90, createdAt: '' },
      { id: 't3', nickname: 'T3', cls: 'archer', score: 80, createdAt: '' },
    ];
    const missing = team[1]; // wizard 90
    const reserve: BalancePlayer[] = [
      { id: 'r1', nickname: 'R1', cls: 'archer', score: 90, createdAt: '' },   // клас уже є в команді
      { id: 'r2', nickname: 'R2', cls: 'wizard', score: 60, createdAt: '' },   // той самий клас, далеко за score
      { id: 'r3', nickname: 'R3', cls: 'assassin', score: 92, createdAt: '' }, // нового класу, близько
      { id: 'r4', nickname: 'R4', cls: 'wizard', score: 95, createdAt: '' },   // той самий клас, близько
    ];
    expect(suggestReplacement(team, missing, reserve).map((p) => p.id)).toEqual(['r4', 'r2', 'r3', 'r1']);
  });
});

describe('утиліти', () => {
  it('createRng детермінований і в [0,1)', () => {
    const a = createRng('x'), b = createRng('x');
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashString стабільний', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
    expect(hashString('abc')).toMatch(/^[0-9a-f]{32}$/);
  });
});
