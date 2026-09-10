// =========================================================
// Симулятор балансного фул-рандому (docs/balanced-random-analysis.md §3.2,
// «Симуляція і тести»): синтетичні популяції за таблицями balance-v1.0 →
// formTeams на багатьох seed → метрики якості проти теоретичних меж.
//
// Запуск:  npm run simulate            (дефолт: N=24,36,60,120 × 4 профілі × 50 seed)
//          npm run simulate -- --seeds=200 --n=60 --profile=top
// Прогін одного seed при дефолтному бюджеті (8×20 000) ≈ 0,5–1 с; для
// масових прогонів використовується зменшений бюджет 1×20 000 (~70 мс).
// =========================================================

import { formTeams, teamStats, unavoidable, createRng, type BalancePlayer } from '../src/data/balance';
import { BUILTIN_RULES_VERSION as CURRENT_RULES_VERSION, CLASS_ORDER, computeGearScore, rulesFor } from '../src/data/gearRules';
import type { ArmorRefine, ArmorSet, CharClass, Gems, Genie, PlayerGear, SpecialSet, Tract, WeaponGrade, WeaponRefine } from '../src/data/types';

type Weighted<T> = Array<[T, number]>;
interface Profile {
  name: string;
  weaponGrade: Weighted<WeaponGrade>;
  weaponRefine: Weighted<WeaponRefine>;
  weaponPz: number; // ймовірність мати запасну ПЗ-зброю
  armorSet: Weighted<ArmorSet>;
  armorRefine: Weighted<ArmorRefine>;
  gems: Weighted<Gems>;
  sets: Weighted<SpecialSet[]>;
  tract: Weighted<Tract>;
  genie: Weighted<Genie>;
  classes?: Weighted<CharClass>;
}

const uniformClasses: Weighted<CharClass> = CLASS_ORDER.map((c) => [c, 1]);

const MIXED: Omit<Profile, 'name'> = {
  weaponGrade: [['nirvana', 15], ['r8r', 25], ['cgd', 25], ['r9', 10], ['r9r1', 8], ['rcgd', 10], ['r9r2', 7]],
  weaponRefine: [['w0_5', 5], ['w6_7', 10], ['w8_9', 20], ['w10', 35], ['w11', 15], ['w12', 15]],
  weaponPz: 0.5,
  armorSet: [['nirvana', 15], ['nirvana_r8_mix', 40], ['r8r', 45]],
  armorRefine: [['a0_4', 5], ['a5', 10], ['a6', 10], ['a7', 15], ['a8', 20], ['a9', 15], ['a10', 15], ['a11', 5], ['a12', 5]],
  gems: [['g0_9', 10], ['g10', 15], ['g11', 15], ['xuan', 20], ['xuan_pa', 15], ['pa', 10], ['xuan_camp', 10], ['camp', 5]],
  sets: [[[], 35], [['aspd'], 15], [['pa'], 15], [['pz'], 15], [['pz', 'pa'], 10], [['pz', 'pa', 'aspd'], 10]],
  tract: [['t1_3', 15], ['t4_5', 15], ['t6', 20], ['t7', 20], ['t8', 20], ['emperor', 10]],
  genie: [['g60', 30], ['g61_70', 15], ['g71_80', 15], ['g81_90', 15], ['g91_99', 10], ['g100', 15]],
};

const PROFILES: Profile[] = [
  { name: 'mixed', ...MIXED },
  {
    name: 'top',
    weaponGrade: [['cgd', 15], ['r9', 15], ['r9r1', 20], ['rcgd', 25], ['r9r2', 25]],
    weaponRefine: [['w8_9', 5], ['w10', 25], ['w11', 30], ['w12', 40]],
    weaponPz: 0.7,
    armorSet: [['nirvana_r8_mix', 10], ['r8r', 90]],
    armorRefine: [['a8', 20], ['a9', 20], ['a10', 30], ['a11', 15], ['a12', 15]],
    gems: [['xuan', 10], ['xuan_pa', 15], ['pa', 25], ['xuan_camp', 25], ['camp', 25]],
    sets: [[['pz'], 20], [['pa'], 20], [['pz', 'pa'], 30], [['pz', 'pa', 'aspd'], 30]],
    tract: [['t7', 20], ['t8', 50], ['emperor', 30]],
    genie: [['g81_90', 20], ['g91_99', 30], ['g100', 50]],
  },
  {
    name: 'budget',
    weaponGrade: [['other', 10], ['nirvana', 40], ['r8r', 35], ['cgd', 15]],
    weaponRefine: [['w0_5', 20], ['w6_7', 25], ['w8_9', 30], ['w10', 20], ['w11', 5]],
    weaponPz: 0.3,
    armorSet: [['other', 10], ['nirvana', 40], ['nirvana_r8_mix', 50]],
    armorRefine: [['a0_4', 30], ['a5', 25], ['a6', 20], ['a7', 15], ['a8', 10]],
    gems: [['g0_9', 50], ['g10', 30], ['g11', 15], ['xuan', 5]],
    sets: [[[], 70], [['aspd'], 15], [['pa'], 10], [['pz'], 5]],
    tract: [['t1_3', 40], ['t4_5', 30], ['t6', 20], ['t7', 10]],
    genie: [['g60', 70], ['g61_70', 20], ['g71_80', 10]],
  },
  {
    name: 'sin-heavy',
    ...MIXED,
    // 30 % сінів — клас з N_c > K, дублі неминучі
    classes: [['assassin', 30], ...CLASS_ORDER.filter((c) => c !== 'assassin').map((c): [CharClass, number] => [c, 70 / 9])],
  },
];

function pick<T>(rng: () => number, table: Weighted<T>): T {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let x = rng() * total;
  for (const [v, w] of table) { x -= w; if (x <= 0) return v; }
  return table[table.length - 1][0];
}

function synthPlayer(rng: () => number, i: number, p: Profile): BalancePlayer {
  const specialSets = pick(rng, p.sets);
  const specialSetGems: Partial<Record<SpecialSet, Gems>> = {};
  for (const s of specialSets) specialSetGems[s] = pick(rng, p.gems);
  const gear: PlayerGear = {
    charClass: pick(rng, p.classes ?? uniformClasses),
    weaponGrade: pick(rng, p.weaponGrade),
    weaponRefine: pick(rng, p.weaponRefine),
    weaponPz: rng() < p.weaponPz,
    armorSet: pick(rng, p.armorSet),
    armorRefine: pick(rng, p.armorRefine) as ArmorRefine,
    gems: pick(rng, p.gems),
    specialSets,
    specialSetGems,
    tract: pick(rng, p.tract),
    genie: pick(rng, p.genie),
  };
  return { id: `p${String(i).padStart(3, '0')}`, nickname: `N${i}`, cls: gear.charClass, score: computeGearScore(gear, undefined, S), createdAt: String(i).padStart(4, '0') };
}

function arg(name: string, def: string): string {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
}

const seeds = Number(arg('seeds', '50'));
const sizes = arg('n', '24,36,60,120').split(',').map(Number);
const profileFilter = arg('profile', '');
const S = Number(arg('s', '6'));
const restarts = Number(arg('restarts', '1'));
const iterations = Number(arg('iterations', '20000'));
const rules = rulesFor(CURRENT_RULES_VERSION).balance;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

console.log(`balance-v1.0 · S=${S} · ${restarts}×${iterations} · seeds=${seeds}`);
console.log('profile   N   K | totalRange mean/p95/max (% of team) | top1 mean (bound) | top3conc | excessDup | roleExcess | ms/run');

for (const p of PROFILES) {
  if (profileFilter && p.name !== profileFilter) continue;
  for (const N of sizes) {
    const popRng = createRng(`pop:${p.name}:${N}`);
    const players = Array.from({ length: N }, (_, i) => synthPlayer(popRng, i, p));
    const K = Math.floor(N / S);
    if (K < 2) continue;
    const sortedScores = players.map((x) => x.score).sort((a, b) => b - a);
    const top1Bound = sortedScores[0] - sortedScores[K - 1];
    const top3 = new Set(players.slice().sort((a, b) => b.score - a.score).slice(0, 3).map((x) => x.id));

    const ranges: number[] = [], top1: number[] = [], ms: number[] = [];
    let top3conc = 0, excessDup = 0, roleExcess: number[] = [];
    let teamMean = 0;
    for (let s = 0; s < seeds; s++) {
      const t0 = performance.now();
      const r = formTeams(players, { teamSize: S, seed: `sim-${s}`, rules, rulesVersion: CURRENT_RULES_VERSION, restarts, iterations });
      ms.push(performance.now() - t0);
      const totals = r.teams.map((t) => t.reduce((a, x) => a + x.score, 0));
      teamMean = mean(totals);
      ranges.push(Math.max(...totals) - Math.min(...totals));
      const tops = r.teams.map((t) => Math.max(...t.map((x) => x.score)));
      top1.push(Math.max(...tops) - Math.min(...tops));
      if (r.teams.some((t) => t.filter((x) => top3.has(x.id)).length >= 2)) top3conc++;
      const active = r.teams.flat();
      const unav = unavoidable(active, K, rules);
      const dups = r.teams.reduce((a, t) => a + teamStats(t, rules).dup, 0);
      if (dups > unav.dups) excessDup++;
      const stats = r.teams.map((t) => teamStats(t, rules));
      let re = 0;
      for (const role of Object.keys(unav.roleSlack) as Array<keyof typeof unav.roleSlack>) {
        const counts = stats.map((st) => st.roleCount[role]);
        re += Math.max(0, Math.max(...counts) - Math.min(...counts) - unav.roleSlack[role]);
      }
      roleExcess.push(re);
    }
    console.log(
      `${p.name.padEnd(9)} ${String(N).padStart(3)} ${String(K).padStart(3)} | ` +
      `${mean(ranges).toFixed(1).padStart(5)} / ${String(pct(ranges, 0.95)).padStart(3)} / ${String(Math.max(...ranges)).padStart(3)} ` +
      `(${((100 * mean(ranges)) / teamMean).toFixed(1)}%)`.padEnd(8) + ' | ' +
      `${mean(top1).toFixed(1).padStart(5)} (${top1Bound})`.padEnd(12) + ' | ' +
      `${((100 * top3conc) / seeds).toFixed(0).padStart(3)}%`.padEnd(8) + ' | ' +
      `${excessDup}`.padStart(9) + ' | ' +
      `${mean(roleExcess).toFixed(2)}`.padStart(10) + ' | ' +
      `${mean(ms).toFixed(0)}`.padStart(5),
    );
  }
}
