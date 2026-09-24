import { describe, expect, it } from 'vitest';
import {
  ALGO_VERSION, PAIR_HARD_PENALTY, buffPctTo, createRng, estimateSpread, evaluateTeams, formTeams, hashString, pairViolates, penalty, signature,
  strengthOf, strengthSpreadOf, suggestReplacement, teamBuffOf, teamStats, teamStrengthFromSnapshot, unavoidable,
  type BalancePlayer, type FormTeamsOptions,
} from '../balance';
import {
  BUILTIN_BUFFS, BUILTIN_COMPOSITION, CLASS_ORDER, RECOMMENDED_BUFFS_PCT, RECOMMENDED_COMPOSITION_WEIGHTS, normalizeRules, playerProfile, rulesFor, serializeRules,
  type BalanceRules, type BuffRules, type PairsRule,
} from '../gearRules';
import type { BalanceSnapshot, Build, CharClass } from '../types';

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
    expect(a.snapshot.algoVersion).toBe(ALGO_VERSION); // teams-ls-v5: сила й правило 4 для пар
    expect(a.snapshot.players[0].length).toBe(5); // id, клас, score, kill, amp
  });
});

describe('penalty на впорядкованих статистиках', () => {
  const mk = (scores: number[]): BalancePlayer[] =>
    scores.map((s, i) => ({ id: `x${i}`, nickname: `X${i}`, cls: CLASS_ORDER[i], score: s, createdAt: '', ...prof(CLASS_ORDER[i]) }));

  it('приклад §15 спеки: рівні суми, але стек топів → штраф 242.4 (лише сума дала б 0)', () => {
    const A = mk([250, 245, 230, 120, 115, 110]);
    const B = mk([180, 180, 180, 180, 180, 170]);
    const unav = { dups: 0, roleSlack: { support: 1, tank: 1, ranged: 1, melee: 1, control: 1 }, killLack: 0, singleThreat: 0, pairViol: 0 };
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
  const onlyKiller: BalanceRules = { ...rules, composition: { ...BUILTIN_COMPOSITION, weights: { killer: 30, twoThreats: 0, kpRange: 0, topSecondDd: 0, topSupport: 0 } } };
  const killerPen = (teams: BalancePlayer[][]) => evaluateTeams(teams, onlyKiller).penalty - evaluateTeams(teams, rules).penalty;

  it('з нульовими вагами штраф і розклад — рівно як у v1', () => {
    const players = population(30, 'comp-off');
    const a = formTeams(players, baseOpts({ teamSize: 3 }));
    const b = formTeams(players, baseOpts({ teamSize: 3, rules: { ...rules, composition: { ...rules.composition, weights: { killer: 0, twoThreats: 0, kpRange: 0, topSecondDd: 0, topSupport: 0 } } } }));
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
    // Порівнювати повний штраф тут не можна: розкид зв'язки між командами залежить
    // від усього розкладу й може зрівняти ці три варіанти — тож перевіряємо лише
    // член «нема ким убивати», для якого цей тест і написаний.
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

describe('правило 4: топовому ДД — без другого ДД і зайвої підтримки', () => {
  let seq = 0;
  const w4: BalanceRules = {
    ...rules,
    composition: { ...BUILTIN_COMPOSITION, weights: { killer: 0, twoThreats: 0, kpRange: 0, topSecondDd: 60, topSupport: 40 } },
  };
  const bp = (cls: CharClass, score: number, build: Build = 'dd'): BalancePlayer =>
    ({ id: `t${seq++}`, nickname: cls, cls, score, createdAt: '', ...prof(cls, build) });

  it('рахує інших повних ДД і підтримку понад дозволену лише біля топового ДД', () => {
    const stacked = teamStats([bp('assassin', 240), bp('wizard', 150), bp('psychic', 120)], w4);
    expect(stacked.topDd).toBe(2);
    const buffed = teamStats([bp('assassin', 240), bp('seeker', 140), bp('venomancer', 70)], w4);
    expect(buffed.topDd).toBe(0);
    expect(buffed.topSupportOver).toBeCloseTo(0.1 + 1 - 0.6, 5); // Страж 0.1 + Дру 1.0 − 0.6
    const ok = teamStats([bp('assassin', 240), bp('seeker', 140), bp('cleric', 100)], w4);
    expect(ok.topDd).toBe(0);
    expect(ok.topSupportOver).toBe(0); // Страж + Прист = 0.6 — дозволено
    // немає топового ДД (скор нижче порогу) — правило мовчить
    const noTop = teamStats([bp('assassin', 200), bp('wizard', 190), bp('venomancer', 70)], w4);
    expect(noTop.topDd).toBe(0);
    expect(noTop.topSupportOver).toBe(0);
    // кон-збірка — не повний ДД, тож не топовий
    expect(teamStats([bp('assassin', 240, 'con'), bp('wizard', 150), bp('seeker', 100)], w4).topDd).toBe(0);
  });

  it('штраф = 60 за кожного другого ДД + 40 × перевищення підтримки', () => {
    const t1 = [bp('assassin', 240), bp('wizard', 150), bp('seeker', 100)];
    const t2 = [bp('psychic', 230), bp('seeker', 140), bp('venomancer', 70)];
    const off = { ...w4, composition: { ...w4.composition, weights: { ...w4.composition.weights, topSecondDd: 0, topSupport: 0 } } };
    const diff = evaluateTeams([t1, t2], w4).penalty - evaluateTeams([t1, t2], off).penalty;
    expect(diff).toBeCloseTo(60 * 1 + 40 * (0.1 + 1 - 0.6), 5);
  });

  it('з нульовими вагами — той самий розклад і штраф, що й без правила', () => {
    const players = population(30, 'r4-off');
    const a = formTeams(players, baseOpts({ teamSize: 3 }));
    const b = formTeams(players, baseOpts({ teamSize: 3, rules: { ...rules, composition: { ...rules.composition, topDdMinScore: 100 } } }));
    expect(signature(a.teams)).toBe(signature(b.teams));
    expect(a.penalty).toBe(b.penalty);
  });
});

// ── teams-ls-v5: сила команди (бафи тімейтів) і правило 4 для пар ──

/** Гравець із явним профілем — для пулів, де важить саме kill/amp, а не клас. */
const mkp = (id: string, cls: CharClass, score: number, kill: number, amp: number, side: BalancePlayer['side'] = null): BalancePlayer =>
  ({ id, nickname: id, cls, score, kill, amp, createdAt: `2026-09-24T00:00:00Z${id}`, side });
/** Шкала з увімкненими бафами за рекомендованою таблицею (шлях 11, без КХ). */
const withBuffs = (base: BalanceRules, over: Partial<BuffRules> = {}): BalanceRules =>
  ({ ...base, buffs: { ...BUILTIN_BUFFS, enabled: true, pct: RECOMMENDED_BUFFS_PCT, ...over } });
const withPairs = (base: BalanceRules, pairsRule: PairsRule, weights?: Partial<BalanceRules['composition']['weights']>): BalanceRules =>
  ({ ...base, composition: { ...base.composition, pairsRule, weights: { ...base.composition.weights, ...weights } } });

describe('зворотна сумісність: версія шкали без buffs і pairsRule = golden teams-ls-v4 біт-у-біт', () => {
  // v1.13 як у базі (top 0.25, ваги шару 30/10/10/60/40) — JSON без блоку buffs
  // і без pairsRule, як його зберегли до появи полів; очікування знято прогоном
  // ДО правок (scratchpad/impl/golden_before.txt), тому будь-яка зміна тут =
  // старі турніри перестали відтворюватись.
  const json = JSON.parse(JSON.stringify(serializeRules(rulesFor()))) as { balance: { weights: Record<string, number>; composition: Record<string, unknown>; buffs?: unknown } };
  json.balance.weights.top = 0.25;
  json.balance.composition.weights = { killer: 30, twoThreats: 10, kpRange: 10, topSecondDd: 60, topSupport: 40 };
  delete json.balance.composition.pairsRule;
  delete json.balance.buffs;
  const v13 = normalizeRules(json).balance;
  const pool = (seed: string, prefix: string, base: number, span: number): BalancePlayer[] => {
    const rng = createRng(seed);
    return Array.from({ length: 12 }, (_, i) => {
      const cls = CLASS_ORDER[Math.floor(rng() * CLASS_ORDER.length)];
      return { id: `${prefix}${String(i).padStart(2, '0')}`, nickname: `${prefix.toUpperCase()}${i}`, cls, score: base + Math.floor(rng() * span), createdAt: new Date(Date.UTC(2026, 8, 1, 12, 0, i)).toISOString(), ...playerProfile(cls, 'dd', v13.composition) };
    });
  };
  const run = (players: BalancePlayer[], S: number, K: number) =>
    formTeams(players, { teamSize: S, seed: 'golden', rules: v13, rulesVersion: 'balance-v1.13', teamCount: K, restarts: 4, iterations: 3000 });

  it('стара версія нормалізується у «вимкнено» і «legacy»', () => {
    expect(v13.buffs.enabled).toBe(false);
    expect(v13.composition.pairsRule).toBe('legacy');
  });

  it('пул без топових ДД: S = 2 і S = 3 дають ті самі підписи й штрафи', () => {
    const p = pool('golden-v4', 'g', 60, 200); // g01 Воїн 255, g04 Друїд 255, g06 Танк 231 — жоден не повний ДД
    const a = run(p, 2, 6);
    expect(signature(a.teams)).toBe('g00,g09|g01,g02|g03,g07|g04,g10|g05,g06|g08,g11');
    expect(a.penalty).toBe(141.1351048756644);
    const b = run(p, 3, 4);
    expect(signature(b.teams)).toBe('g00,g05,g06|g01,g03,g10|g02,g04,g09|g07,g08,g11');
    expect(b.penalty).toBe(48.32263412660235);
  });

  it('пул із топовим ДД (h01 Шаман 225) і Друїдами — правило 4 у legacy рахується як досі', () => {
    const p = pool('golden-v4-top', 'h', 120, 160);
    const a = run(p, 2, 6);
    expect(signature(a.teams)).toBe('h00,h01|h02,h07|h03,h09|h04,h05|h06,h08|h10,h11');
    expect(a.penalty).toBe(102.27218227652159);
    const b = run(p, 3, 4);
    expect(signature(b.teams)).toBe('h00,h01,h10|h02,h04,h08|h03,h05,h06|h07,h09,h11');
    expect(b.penalty).toBe(98.00936277385793);
  });

  it('вимкнені бафи: teamStats без контексту і з ним — сила = гір, штраф той самий', () => {
    const p = pool('golden-v4', 'g', 60, 200);
    const teams = run(p, 3, 4).teams;
    const plain = evaluateTeams(teams, v13);
    const ctx = evaluateTeams(teams, v13, { buffs: { source: 'party', kx: 'kx' }, teamSize: 3 });
    expect(plain.penalty).toBe(ctx.penalty);
    for (const st of ctx.stats) { expect(st.buff).toBe(0); expect(st.strength).toBe(st.total); }
    expect(ctx.buffs.enabled).toBe(false);
  });
});

describe('buffPctTo: % сили від тімейтів', () => {
  const on = withBuffs(rules);
  const A = mkp('a', 'archer', 250, 1, 0), T = mkp('t', 'barbarian', 100, 0.5, 0.5), P = mkp('p', 'cleric', 100, 0.2, 0.5), V = mkp('v', 'blademaster', 100, 0.5, 0.3);

  it('Лучник 250 + Танк + Прист без КХ = 37 %; + Воїн = 47 → стеля 40', () => {
    expect(buffPctTo(A, [A, T, P], on, 'noKx', 3)).toBe(37);
    expect(buffPctTo(A, [A, T, P, V], on, 'noKx', 4)).toBe(40);
    // без стелі — усі 47
    expect(buffPctTo(A, [A, T, P, V], withBuffs(rules, { cap: 100 }), 'noKx', 4)).toBe(47);
  });

  it('клас-дарувальник рахується один раз; свій клас — 0; під КХ менше; магам — своя колонка', () => {
    const T2 = mkp('t2', 'barbarian', 80, 0.5, 0.5);
    expect(buffPctTo(A, [A, T, T2, P], on, 'noKx', 4)).toBe(37); // два Танки = один
    expect(buffPctTo(A, [A, mkp('a2', 'archer', 200, 1, 0)], on, 'noKx', 2)).toBe(0); // Лучник Лучника не бафає
    expect(buffPctTo(A, [A, T, P], on, 'kx', 3)).toBe(26); // 15 + 11
    const W = mkp('w', 'wizard', 200, 1, 0);
    expect(buffPctTo(W, [W, T, P], on, 'noKx', 3)).toBe(35); // 16 + 19
    expect(buffPctTo(A, [A], on, 'noKx', 1)).toBe(0);
  });

  it('сторона: bySide зі стороною «демон» у Танка → 21, без сторони або без bySide → сильніша (22)', () => {
    const Tje = { ...T, side: 'je' as const };
    expect(buffPctTo(A, [A, Tje, P], withBuffs(rules, { bySide: true }), 'noKx', 3)).toBe(36);
    expect(buffPctTo(A, [A, Tje, P], on, 'noKx', 3)).toBe(37); // bySide вимкнено — сторона не важить
    expect(buffPctTo(A, [A, T, P], withBuffs(rules, { bySide: true }), 'noKx', 3)).toBe(37); // сторона невідома → max
  });

  it('killScaled множить на урон отримувача; sizeWeight — частка за розміром команди (5 = 5+)', () => {
    const S = mkp('s', 'seeker', 150, 0.3, 0.1);
    expect(buffPctTo(S, [S, T, P], on, 'noKx', 3)).toBe(37);
    expect(buffPctTo(S, [S, T, P], withBuffs(rules, { killScaled: true }), 'noKx', 3)).toBeCloseTo(11.1, 9);
    const half = withBuffs(rules, { sizeWeight: { '2': 100, '3': 100, '4': 100, '5': 50 } });
    expect(buffPctTo(A, [A, T, P], half, 'noKx', 4)).toBe(37);
    expect(buffPctTo(A, [A, T, P], half, 'noKx', 5)).toBe(18.5);
    expect(buffPctTo(A, [A, T, P], half, 'noKx', 8)).toBe(18.5);
  });

  it('teamBuffOf / strengthOf: Лучник 250 + Танк 100 + Прист 100 → бафи 125.5, сила 575.5', () => {
    // Лучник 37 % → 92.5; Танк: Прист 15 + Лучник 1 = 16 %; Прист: Танк 16 + Лучник 1 = 17 %
    expect(teamBuffOf([A, T, P], on, 'noKx', 3)).toBeCloseTo(125.5, 9);
    expect(strengthOf([A, T, P], on, 'noKx', 3)).toBeCloseTo(575.5, 9);
    // Маг 450 + Містик 100 + Страж 20: Маг +2 % (Страж), Містик +2 %, Страж +1 % (Маг) → 581.2
    const other = [mkp('w', 'wizard', 450, 1, 0), mkp('m', 'mystic', 100, 0.3, 0.5), mkp('s', 'seeker', 20, 0.3, 0.1)];
    expect(strengthSpreadOf([[A, T, P], other], on, 'noKx', 3)).toBeCloseTo(581.2 - 575.5, 9);
  });
});

describe('сила у штрафі: вирівнювання за силою дає інший розклад, ніж за гіром', () => {
  // Лучник 260, Маг 200, Танк 120, Містик 160 на дві пари. За гіром: {Лучник+Танк 380, Маг+Містик 360}.
  // За силою Танк дає Лучнику +57 → ця пара 438 проти 360; дешевше {Лучник+Містик 422, Маг+Танк 353}.
  const A = mkp('A', 'archer', 260, 1, 0), W = mkp('W', 'wizard', 200, 1, 0), B = mkp('B', 'barbarian', 120, 0.5, 0.5), M = mkp('M', 'mystic', 160, 0.3, 0.5);
  const on = withBuffs(rules);
  const opts = (over: Partial<FormTeamsOptions>): FormTeamsOptions => ({ teamSize: 2, seed: 'str', rules, rulesVersion: 'v', teamCount: 2, restarts: 2, iterations: 500, ...over });

  it('за гіром — Лучник+Танк, за силою — Лучник+Містик', () => {
    expect(signature(formTeams([A, W, B, M], opts({})).teams)).toBe('A,B|M,W');
    const r = formTeams([A, W, B, M], opts({ rules: on }));
    expect(signature(r.teams)).toBe('A,M|B,W');
    expect(r.snapshot.buffs).toEqual({ enabled: true, source: 'party', kx: 'noKx', bySide: false });
    expect(r.snapshot.pairsRule).toBe('legacy');
    const ev = evaluateTeams([[A, B], [W, M]], on, { teamSize: 2 });
    expect(ev.stats[0].strength).toBeCloseTo(438.4, 9); // 380 + 260·22 % + 120·1 %
    expect(ev.stats[1].strength).toBeCloseTo(360, 9);   // Містик не бафає, Маг Містику 0
    expect(ev.stats[0].prefix[0]).toBe(260); // профіль сили — на сирих скорах
  });

  it('правила турніру «бафи не дозволені» вимикають силу навіть при увімкненій галочці', () => {
    const r = formTeams([A, W, B, M], opts({ rules: on, buffs: { source: 'none', kx: 'noKx' } }));
    expect(signature(r.teams)).toBe('A,B|M,W');
    expect(r.snapshot.buffs).toEqual({ enabled: false, source: 'none', kx: 'noKx', bySide: false });
  });

  it('estimateSpread рахує розкид сили, коли бафи увімкнено, інакше гіру', () => {
    const base = { teamSize: 2, rules, rulesVersion: 'v', teamCount: 2, restarts: 1, iterations: 500 };
    expect(estimateSpread([A, W, B, M], base, ['s1'])).toEqual([20]);
    expect(estimateSpread([A, W, B, M], { ...base, rules: on }, ['s1'])[0]).toBeCloseTo(421.6 - 353.2, 9);
  });

  it('suggestReplacement із ctx ранжує за найменшою зміною сили команди', () => {
    // Команда Лучник 250 + Прист 100 (сила 250·1.15 + 100·1.01 = 388.5); Прист вибув.
    const team = [mkp('a', 'archer', 250, 1, 0), mkp('p', 'cleric', 100, 0.2, 0.5)];
    const reserve = [
      mkp('r1', 'mystic', 100, 0.3, 0.5),    // той самий скор, але бафів 0 → сила 351 (−37.5)
      mkp('r2', 'barbarian', 70, 0.5, 0.5),  // слабший за скором, але +22 % Лучнику → 250·1.22 + 70·1.01 = 375.7 (−12.8)
    ];
    const missing = team[1];
    expect(suggestReplacement(team, missing, reserve).map((p) => p.id)).toEqual(['r1', 'r2']); // без ctx — за скором
    expect(suggestReplacement(team, missing, reserve, { rules: on, kx: 'noKx', S: 2 }).map((p) => p.id)).toEqual(['r2', 'r1']);
  });
});

describe('правило 4 для пар (pairsRule): жорстко лише при S = 2', () => {
  // 2 топи (Сін 226, Лучник 225), 2 слабкі повні ДД (Маг 45, Шаман 40), 4 не-ДД (Танк 115, Прист 110, Страж 105, Містик 100).
  // За гіром найкраще — топи зі слабкими ДД (пари 271/265/215/215), але це «топ + другий ДД».
  const pool8 = [
    mkp('t1', 'assassin', 226, 1, 0), mkp('t2', 'archer', 225, 1, 0), mkp('d1', 'wizard', 45, 1, 0), mkp('d2', 'psychic', 40, 1, 0),
    mkp('n1', 'barbarian', 115, 0.5, 0.5), mkp('n2', 'cleric', 110, 0.2, 0.5), mkp('n3', 'seeker', 105, 0.3, 0.1), mkp('n4', 'mystic', 100, 0.3, 0.5),
  ];
  const legacy = withPairs(rules, 'legacy', { topSecondDd: 60, topSupport: 40 });
  const hard = withPairs(rules, 'noSecondDd', { topSecondDd: 60, topSupport: 40 });
  const off = withPairs(rules, 'off', { topSecondDd: 60, topSupport: 40 });
  const opts = (r: BalanceRules, S: number, K: number, seed = 'pairs'): FormTeamsOptions => ({ teamSize: S, seed, rules: r, rulesVersion: 'v', teamCount: K, restarts: 3, iterations: 2000 });
  const violations = (teams: BalancePlayer[][], r: BalanceRules) => teams.filter((t) => teamStats(t, r).topDd > 0).length;

  it('legacy: ваги 60/40 як досі → топи беруть слабких ДД (2 порушення по 60); off — те саме без штрафу', () => {
    const a = formTeams(pool8, opts(legacy, 2, 4));
    expect(violations(a.teams, legacy)).toBe(2);
    const noW = withPairs(rules, 'legacy', { topSecondDd: 0, topSupport: 0 });
    expect(evaluateTeams(a.teams, legacy, { teamSize: 2 }).penalty - evaluateTeams(a.teams, noW, { teamSize: 2 }).penalty).toBeCloseTo(120, 9);
    const o = formTeams(pool8, opts(off, 2, 4));
    expect(violations(o.teams, off)).toBe(2);
    expect(o.penalty).toBeLessThan(a.penalty);
  });

  it('noSecondDd: топам — лише не-ДД, коли це можливо; штраф без «жорсткого» доданка', () => {
    const r = formTeams(pool8, opts(hard, 2, 4));
    expect(violations(r.teams, hard)).toBe(0);
    expect(r.penalty).toBeLessThan(PAIR_HARD_PENALTY);
    expect(r.snapshot.pairsRule).toBe('noSecondDd');
    // а ручний своп «топ + ДД» коштує 10 000 за пару
    const bad = [[pool8[0], pool8[2]], [pool8[1], pool8[3]], [pool8[4], pool8[7]], [pool8[5], pool8[6]]];
    expect(evaluateTeams(bad, hard, { teamSize: 2 }).penalty).toBeGreaterThan(2 * PAIR_HARD_PENALTY);
  });

  it('noSecondDdNoDruid: топу не можна й Друїда (amp ≥ 1)', () => {
    const A = mkp('t1', 'assassin', 230, 1, 0), V = mkp('v1', 'venomancer', 60, 0.2, 1), C = mkp('n1', 'cleric', 100, 0.2, 0.5), W = mkp('d1', 'wizard', 100, 1, 0);
    expect(signature(formTeams([A, V, C, W], opts(hard, 2, 2)).teams)).toBe('d1,n1|t1,v1'); // Друїда можна — за гіром найрівніше
    expect(signature(formTeams([A, V, C, W], opts(withPairs(rules, 'noSecondDdNoDruid'), 2, 2)).teams)).toBe('d1,v1|n1,t1');
    expect(pairViolates(teamStats([A, V], rules), 'noSecondDdNoDruid')).toBe(true);
    expect(pairViolates(teamStats([A, V], rules), 'noSecondDd')).toBe(false);
    expect(pairViolates(teamStats([A, W], rules), 'legacy')).toBe(false);
  });

  it('при S = 3 pairsRule не діє: той самий розклад і штраф, що в legacy', () => {
    const pool9 = [...pool8, mkp('n5', 'blademaster', 90, 0.5, 0.3)];
    const a = formTeams(pool9, opts(legacy, 3, 3));
    const b = formTeams(pool9, opts(hard, 3, 3));
    const c = formTeams(pool9, opts(withPairs(rules, 'noSecondDdNoDruid', { topSecondDd: 60, topSupport: 40 }), 3, 3));
    expect(signature(b.teams)).toBe(signature(a.teams));
    expect(b.penalty).toBe(a.penalty);
    expect(c.penalty).toBe(a.penalty);
    expect(unavoidable(pool9, 3, hard, 3).pairViol).toBe(0);
    // трійка «топ + ДД + Страж» при S = 3 штрафується вагою, а не 10 000 — незалежно від pairsRule
    const t = [[pool8[0], pool8[2], pool8[6]], [pool8[1], pool8[4], pool8[5]], [pool8[3], pool8[7], pool9[8]]];
    expect(evaluateTeams(t, hard, { teamSize: 3 }).penalty).toBe(evaluateTeams(t, legacy, { teamSize: 3 }).penalty);
    expect(evaluateTeams(t, hard, { teamSize: 3 }).penalty).toBeLessThan(PAIR_HARD_PENALTY);
  });

  describe('«неминуче» для пар: формула ⌈max(0, топів − дозволених) / 2⌉ = перебір усіх розбиттів на пари', () => {
    /** Справжній мінімум пар із порушенням — повний перебір розбиттів (8 гравців → 105). */
    const minViolBrute = (players: BalancePlayer[], r: BalanceRules): number => {
      let best = Infinity;
      const rec = (rest: BalancePlayer[], viol: number) => {
        if (!rest.length) { if (viol < best) best = viol; return; }
        const a = rest[0];
        for (let i = 1; i < rest.length; i++) {
          const v = viol + (pairViolates(teamStats([a, rest[i]], r), r.composition.pairsRule) ? 1 : 0);
          rec(rest.filter((_, j) => j !== 0 && j !== i), v);
        }
      };
      rec(players, 0);
      return best;
    };
    const pools: Array<[string, BalancePlayer[], number]> = [
      ['4 топи + 2 ДД + 2 не-ДД', [mkp('a', 'assassin', 270, 1, 0), mkp('b', 'psychic', 260, 1, 0), mkp('c', 'wizard', 250, 1, 0), mkp('d', 'archer', 240, 1, 0), mkp('e', 'wizard', 200, 1, 0), mkp('f', 'psychic', 190, 1, 0), mkp('g', 'barbarian', 120, 0.5, 0.5), mkp('h', 'seeker', 150, 0.3, 0.1)], 1],
      ['3 топи + 1 не-ДД + 4 ДД', [mkp('a', 'assassin', 270, 1, 0), mkp('b', 'psychic', 260, 1, 0), mkp('c', 'wizard', 250, 1, 0), mkp('d', 'archer', 200, 1, 0), mkp('e', 'wizard', 190, 1, 0), mkp('f', 'psychic', 180, 1, 0), mkp('g', 'assassin', 170, 1, 0), mkp('h', 'seeker', 150, 0.3, 0.1)], 1],
      ['4 топи + 4 ДД', [mkp('a', 'assassin', 270, 1, 0), mkp('b', 'psychic', 260, 1, 0), mkp('c', 'wizard', 250, 1, 0), mkp('d', 'archer', 240, 1, 0), mkp('e', 'wizard', 200, 1, 0), mkp('f', 'psychic', 190, 1, 0), mkp('g', 'assassin', 180, 1, 0), mkp('h', 'archer', 170, 1, 0)], 2],
      ['6 гравців: 2 топи + 3 ДД + 1 не-ДД', [mkp('a', 'assassin', 270, 1, 0), mkp('b', 'psychic', 260, 1, 0), mkp('c', 'wizard', 200, 1, 0), mkp('d', 'archer', 190, 1, 0), mkp('e', 'wizard', 180, 1, 0), mkp('f', 'seeker', 150, 0.3, 0.1)], 1],
    ];
    for (const [name, pool, expected] of pools) {
      it(name, () => {
        const u = unavoidable(pool, pool.length / 2, hard, 2);
        expect(u.pairViol).toBe(expected);
        expect(minViolBrute(pool, hard)).toBe(expected);
        expect(unavoidable(pool, pool.length / 2, hard).pairViol).toBe(expected); // S виводиться з пулу, коли не передано
        expect(unavoidable(pool, pool.length / 2, legacy, 2).pairViol).toBe(0);
        expect(unavoidable(pool, pool.length / 2, hard, 3).pairViol).toBe(0);
      });
    }

    it('«…і не Друїда»: Друїд не є дозволеним партнером', () => {
      const pool = [mkp('a', 'assassin', 270, 1, 0), mkp('b', 'psychic', 260, 1, 0), mkp('c', 'wizard', 250, 1, 0), mkp('v1', 'venomancer', 80, 0.2, 1), mkp('v2', 'venomancer', 70, 0.2, 1), mkp('s', 'seeker', 150, 0.3, 0.1), mkp('d', 'archer', 200, 1, 0), mkp('e', 'wizard', 190, 1, 0)];
      const noDruid = withPairs(rules, 'noSecondDdNoDruid');
      expect(unavoidable(pool, 4, noDruid, 2).pairViol).toBe(1); // 3 топи, дозволений лише Страж
      expect(minViolBrute(pool, noDruid)).toBe(1);
      expect(unavoidable(pool, 4, hard, 2).pairViol).toBe(0); // з Друїдами дозволених 3
      expect(minViolBrute(pool, hard)).toBe(0);
    });

    it('коли пул не дозволяє — рівно стільки порушень, скільки неминуче, і без жорсткого штрафу', () => {
      const r = formTeams(pools[2][1], opts(hard, 2, 4));
      expect(violations(r.teams, hard)).toBe(2);
      expect(r.penalty).toBeLessThan(PAIR_HARD_PENALTY);
    });
  });
});

describe('teamStrengthFromSnapshot: сила при читанні зі складу знімка', () => {
  const on = withBuffs(rules);
  const stats: Pick<BalanceSnapshot, 'players' | 'teamSize' | 'buffs'> = {
    players: [['a', 'archer', 250, 1, 0], ['c', 'cleric', 100, 0.2, 0.5], ['s', 'seeker', 150, 0.3, 0.1], ['w', 'wizard', 100, 1, 0]],
    teamSize: 3,
    buffs: { enabled: true, source: 'party', kx: 'noKx', bySide: false },
  };
  const m = (registrationId: string, charClass: CharClass, score: number) => ({ registrationId, charClass, score });
  const before = [m('a', 'archer', 250), m('c', 'cleric', 100), m('s', 'seeker', 150)];
  const after = [m('a', 'archer', 250), m('w', 'wizard', 100), m('s', 'seeker', 150)];

  it('заміна Приста на Мага з тим самим скором змінює силу, а не гір', () => {
    const b = teamStrengthFromSnapshot(before, stats, on);
    const a = teamStrengthFromSnapshot(after, stats, on);
    expect(b).toEqual({ total: 500, buff: 69.5, strength: 569.5 }); // Лучник 17 % → 42.5, Прист 3 % → 3, Страж 16 % → 24
    expect(a.total).toBe(500);
    expect(a.buff).toBeCloseTo(13.5, 9);
    expect(a.strength).toBeCloseTo(513.5, 9);
  });

  it('без блоку buffs (стара жеребка) або з вимкненими бафами — сила = гір', () => {
    expect(teamStrengthFromSnapshot(before, { ...stats, buffs: undefined }, on)).toEqual({ total: 500, buff: 0, strength: 500 });
    expect(teamStrengthFromSnapshot(before, { ...stats, buffs: { ...stats.buffs!, enabled: false } }, on)).toEqual({ total: 500, buff: 0, strength: 500 });
  });

  it('kill береться зі знімка за registrationId, для незнайомого — з профілю класу (killScaled)', () => {
    const scaled = withBuffs(rules, { killScaled: true });
    const known = teamStrengthFromSnapshot(before, stats, scaled);
    expect(known.buff).toBeCloseTo(42.5 + 0.6 + 7.2, 9); // × kill: Лучник 1, Прист 0.2, Страж 0.3
    const sub = [m('a', 'archer', 250), m('x', 'cleric', 100), m('s', 'seeker', 150)]; // x — заміна, у знімку її немає → Прист як ДД-збірка: kill 0.2
    expect(teamStrengthFromSnapshot(sub, stats, scaled).buff).toBeCloseTo(known.buff, 9);
    // розмір команди турніру зі знімка → частка бафів для 5+
    const s5 = withBuffs(rules, { sizeWeight: { '2': 100, '3': 100, '4': 100, '5': 0 } });
    expect(teamStrengthFromSnapshot(before, { ...stats, teamSize: 5 }, s5).buff).toBe(0);
    expect(teamStrengthFromSnapshot(before, stats, s5).buff).toBe(69.5);
  });
});
