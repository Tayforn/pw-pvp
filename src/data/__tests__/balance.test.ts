import { describe, expect, it } from 'vitest';
import {
  createRng, evaluateTeams, formTeams, hashString, penalty, signature, suggestReplacement, teamStats, unavoidable,
  type BalancePlayer, type FormTeamsOptions,
} from '../balance';
import { BUILTIN_COMPOSITION, CLASS_ORDER, RECOMMENDED_COMPOSITION_WEIGHTS, playerProfile, rulesFor, type BalanceRules } from '../gearRules';
import type { Build, CharClass } from '../types';

const rules = rulesFor().balance;
/** Профіль kill/amp за класом (збірка ДД) — як playersForBalance. */
const prof = (c: CharClass, build: Build = 'dd') => playerProfile(c, build, rules.composition);
const baseOpts = (over: Partial<FormTeamsOptions> = {}): FormTeamsOptions => ({
  teamSize: 6, seed: 'test-seed', rules, rulesVersion: 'balance-v1.0', restarts: 4, iterations: 3000, ...over,
});

/** Синтетична популяція: детермінована за seed, класи рівномірно, score ~ [20, 170]. */
function population(n: number, seed: string, opts: { classes?: CharClass[] } = {}): BalancePlayer[] {
  const rng = createRng('pop:' + seed);
  const classes = opts.classes ?? CLASS_ORDER;
  return Array.from({ length: n }, (_, i) => {
    const cls = classes[Math.floor(rng() * classes.length)];
    return {
      id: `p${String(i).padStart(3, '0')}`,
      nickname: `Nick${i}`,
      cls,
      score: 20 + Math.floor(rng() * 150),
      createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, i)).toISOString(),
      ...prof(cls),
    };
  });
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
    expect(a.snapshot.algoVersion).toBe('teams-ls-v3');
    expect(a.snapshot.players[0].length).toBe(5); // id, клас, score, kill, amp
  });
});

describe('penalty на впорядкованих статистиках', () => {
  const mk = (scores: number[]): BalancePlayer[] =>
    scores.map((s, i) => ({ id: `x${i}`, nickname: `X${i}`, cls: CLASS_ORDER[i], score: s, createdAt: '', ...prof(CLASS_ORDER[i]) }));

  it('приклад §15 спеки: рівні суми, але стек топів → штраф 242.4 (лише сума дала б 0)', () => {
    const A = mk([250, 245, 230, 120, 115, 110]);
    const B = mk([180, 180, 180, 180, 180, 170]);
    const unav = { dups: 0, roleSlack: { support: 1, tank: 1, ranged: 1, melee: 1, control: 1 }, killLack: 0, singleThreat: 0 };
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
      { id: 't1', nickname: 'T1', cls: 'cleric', score: 100, createdAt: '', ...prof('cleric') },
      { id: 't2', nickname: 'T2', cls: 'wizard', score: 90, createdAt: '', ...prof('wizard') },
      { id: 't3', nickname: 'T3', cls: 'archer', score: 80, createdAt: '', ...prof('archer') },
    ];
    const missing = team[1]; // wizard 90
    const reserve: BalancePlayer[] = [
      { id: 'r1', nickname: 'R1', cls: 'archer', score: 90, createdAt: '', ...prof('archer') },   // клас уже є в команді
      { id: 'r2', nickname: 'R2', cls: 'wizard', score: 60, createdAt: '', ...prof('wizard') },   // той самий клас, далеко за score
      { id: 'r3', nickname: 'R3', cls: 'assassin', score: 92, createdAt: '', ...prof('assassin') }, // нового класу, близько
      { id: 'r4', nickname: 'R4', cls: 'wizard', score: 95, createdAt: '', ...prof('wizard') },   // той самий клас, близько
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

describe('шар «функціональність пачки» (teams-ls-v2)', () => {
  const on: BalanceRules = { ...rules, composition: { ...BUILTIN_COMPOSITION, weights: { ...RECOMMENDED_COMPOSITION_WEIGHTS } } };
  let seq = 0;
  const bp = (cls: CharClass, score: number, build: Build = 'dd'): BalancePlayer =>
    ({ id: `c${seq++}`, nickname: cls, cls, score, createdAt: '', ...prof(cls, build) });
  /** Штраф одного розкладу лише від рольових членів (без гіру: усі суми рівні). */
  const compPen = (teams: BalancePlayer[][]) => evaluateTeams(teams, on).penalty - evaluateTeams(teams, rules).penalty;
  /** Лише член «є кілер» (без twoThreats/kpRange) — для точних очікувань. */
  const onlyKiller: BalanceRules = { ...rules, composition: { ...BUILTIN_COMPOSITION, weights: { killer: 30, twoThreats: 0, kpRange: 0 } } };
  const killerPen = (teams: BalancePlayer[][]) => evaluateTeams(teams, onlyKiller).penalty - evaluateTeams(teams, rules).penalty;

  it('з нульовими вагами штраф і розклад — рівно як у v1', () => {
    const players = population(30, 'comp-off');
    const a = formTeams(players, baseOpts({ teamSize: 3 }));
    const b = formTeams(players, baseOpts({ teamSize: 3, rules: { ...rules, composition: { ...rules.composition, weights: { killer: 0, twoThreats: 0, kpRange: 0 } } } }));
    expect(signature(a.teams)).toBe(signature(b.teams));
    expect(a.penalty).toBe(b.penalty);
  });

  it('teamStats: найкращий кілер, загрози, зв\'язка з гіру й підтримки', () => {
    const st = teamStats([bp('psychic', 100), bp('barbarian', 100), bp('venomancer', 100)], on);
    expect(st.maxKill).toBe(1);
    expect(st.threats).toBe(2); // Шаман 1.0 і Танк 0.5 ≥ 0.5; Дру 0.2 — ні
    // головний ДД — Шаман (100×1.0), решта входить на secondDd; підтримка Танка й Дру з кепом 1
    expect(st.kp).toBeCloseTo(((100 + 0.5 * (100 * 0.5 + 100 * 0.2)) / 100) * 2, 5);
    const only = teamStats([bp('venomancer', 100), bp('barbarian', 100), bp('seeker', 100)], on);
    expect(only.maxKill).toBe(0.5);
    expect(only.kp).toBeCloseTo(((100 * 0.5 + 0.5 * (100 * 0.2 + 100 * 0.3)) / 100) * 2, 5);
  });

  it('зв\'язка зважена гіром: той самий клас із вищим гіром дає більшу зв\'язку', () => {
    const weak = teamStats([bp('assassin', 100), bp('seeker', 100)], on);
    const strong = teamStats([bp('assassin', 200), bp('seeker', 100)], on);
    expect(strong.kp).toBeGreaterThan(weak.kp);
    // другий ДД додає половину свого гіру×урону
    const solo = teamStats([bp('assassin', 200), bp('cleric', 100)], on);
    const duo = teamStats([bp('assassin', 200), bp('wizard', 100)], on);
    expect(duo.kp).toBeCloseTo((200 + 0.5 * 100) / 100, 5); // Маг підтримки не дає
    expect(solo.kp).toBeCloseTo(((200 + 0.5 * 100 * 0.2) / 100) * 1.5, 5); // Прист: мало урону, але підтримка 0.5
  });

  it('контрольні пачки: Шаман+Танк+Дру — 0, Дру+Танк+Страж — половинка, Прист+Страж — без кілера', () => {
    // Дві однакові за гіром команди + одна «проблемна»: суми рівні, різниця штрафу — лише роль.
    const ok = [bp('wizard', 100), bp('cleric', 100), bp('seeker', 100)];
    const good = [bp('psychic', 100), bp('barbarian', 100), bp('venomancer', 100)];
    const half = [bp('venomancer', 100), bp('barbarian', 100), bp('seeker', 100)];
    const dead = [bp('cleric', 100), bp('seeker', 100), bp('mystic', 100)];
    // killLack неминуче = 0 (кілерів вистачає: Маг, Шаман + ...), тож штраф = 30·(1 − maxKill) + інші члени
    const third = () => [bp('archer', 100), bp('assassin', 100), bp('blademaster', 100)];
    expect(killerPen([ok, good, third()])).toBeCloseTo(0, 5);
    expect(killerPen([ok, half, third()])).toBeCloseTo(30 * 0.5, 5); // кілер — Танк 0.5
    expect(killerPen([ok, dead, third()])).toBeCloseTo(30 * 0.7, 5); // найкращий — Страж/Містик 0.3
    // з усіма трьома членами порядок той самий
    expect(compPen([ok, good, third()])).toBeLessThan(compPen([ok, half, third()]));
    expect(compPen([ok, half, third()])).toBeLessThan(compPen([ok, dead, third()]));
  });

  it('неминуче не штрафується: 3 кілери на 4 пари → одна пара без кілера безкоштовна', () => {
    const teams = [
      [bp('archer', 100), bp('cleric', 100)],
      [bp('wizard', 100), bp('mystic', 100)],
      [bp('psychic', 100), bp('venomancer', 100)],
      [bp('seeker', 100), bp('barbarian', 100)],
    ];
    const ev = evaluateTeams(teams, on);
    expect(ev.unavoidable.killLack).toBeCloseTo(0.5, 5); // 4-й найкращий kill — Танк 0.5
    const lack = ev.stats.reduce((s, x) => s + Math.max(0, 1 - x.maxKill), 0);
    expect(lack).toBeCloseTo(0.5, 5); // лише Танк+Страж
    // штраф за кілера = 30·max(0, 0.5 − 0.5) = 0; лишається тільки розкид зв'язки
    const kps = ev.stats.map((x) => x.kp);
    expect(compPen(teams)).toBeCloseTo(RECOMMENDED_COMPOSITION_WEIGHTS.kpRange * (Math.max(...kps) - Math.min(...kps)), 5);
  });

  it('кон-збірка перетворює кілера на половинку', () => {
    expect(prof('assassin', 'con').kill).toBeCloseTo(0.4, 5);
    expect(prof('assassin', 'hybrid').kill).toBeCloseTo(0.7, 5);
    const st = teamStats([bp('assassin', 100, 'con'), bp('seeker', 100)], on);
    expect(st.maxKill).toBeCloseTo(0.4, 5);
    expect(st.threats).toBe(0);
  });

  it('formTeams з увімкненим шаром: пачок без кілера не більше за неминуче, коли кілерів вистачає — 0', () => {
    // 7 кілерів + 14 не-кілерів → 7 трійок, кожній по кілеру
    const killers: CharClass[] = ['archer', 'assassin', 'psychic', 'wizard', 'archer', 'assassin', 'psychic'];
    const others: CharClass[] = ['seeker', 'seeker', 'seeker', 'seeker', 'barbarian', 'barbarian', 'cleric', 'cleric', 'mystic', 'venomancer', 'blademaster', 'blademaster', 'seeker', 'mystic'];
    const rng = createRng('comp-on');
    const players: BalancePlayer[] = [...killers, ...others].map((cls, i) => ({
      id: `q${String(i).padStart(2, '0')}`, nickname: cls, cls, score: 60 + Math.floor(rng() * 150),
      createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, i)).toISOString(), ...prof(cls),
    }));
    const r = formTeams(players, baseOpts({ teamSize: 3, rules: on, restarts: 6, iterations: 6000 }));
    const stats = r.teams.map((t) => teamStats(t, on));
    expect(stats.filter((x) => x.maxKill < 0.8).length).toBe(0);
    // і кожна трійка має ≥ 2 загрози, якщо їх вистачає (7 кілерів + 2 Танки + 2 Вари = 11 < 14 → неминуче 3)
    const single = stats.filter((x) => x.threats < 2).length;
    expect(single).toBeLessThanOrEqual(unavoidable(r.teams.flat(), 7, on).singleThreat);
  });
});
