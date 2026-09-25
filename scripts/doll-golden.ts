// =========================================================
// Генератор golden-еталонів для ядра ляльки (src/doll/core).
//
// Бандлить НЕЗМІНЕНИЙ pw-calc (esbuild, заглушка globalThis.fetch читає JSON з
// диска), збирає ~50 ручних фікстур + 100 випадкових білдів із сидом і записує:
//   src/doll/core/__tests__/fixtures/{manual,random}.json — білди посиланнями
//   src/doll/core/__tests__/golden/{manual,random}.json   — виходи calc
//   src/doll/core/__tests__/golden/tips.json              — текст тултіпів (ручні)
// У CI не запускається; результат лежить у репо. Перезапускати лише свідомо —
// коли калькулятор змінив формули і pvp має їх підхопити (тоді підняти
// DOLL_ENGINE_VER і CALC_SYNC_COMMIT).
//
// Запуск:  npx vite-node scripts/doll-golden.ts [--force]
// PW_CALC_DIR — тека калькулятора (за замовчуванням ../pw-calc); має бути на
// коміті CALC_SYNC_COMMIT і без локальних змін, інакше — стоп (--force ігнорує).
// =========================================================

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { build as esbuild } from 'esbuild';
import { hydrateFixture, type Fixture, type FxSlot, type FxStat } from '../src/doll/core/__tests__/hydrateFixture';
import { CALC_SYNC_COMMIT } from '../src/doll/core/version';
import type { DollState, Item } from '../src/doll/core/types';

const CALC = path.resolve(process.env.PW_CALC_DIR || '../pw-calc');
const DATA = path.join(CALC, 'public/assets/data/mypers');
const OUT = path.resolve('src/doll/core/__tests__');
const SEED = 20260925;
const RANDOM_N = 100;
const FORCE = process.argv.includes('--force');

// ---------- калькулятор як бібліотека ----------

type Stat = { type: string; val: number };
type Cfg = { on: boolean; lvl: number; side: string };
interface Calc {
  stats: {
    computeStats(b: DollState): { t: Record<string, number>; gearAttr: Record<string, number> };
    computeActiveSlots(b: DollState): Set<string>;
    flattenItemStats(it: Item): Stat[];
  };
  buffs: {
    deriveIb(b: DollState): Record<string, number>;
    shownBuffs(b: DollState): Array<{ id: number }>;
    shownDebuffs(b: DollState): Array<{ id: number }>;
  };
  summary: {
    computeSummary(b: DollState, t: Record<string, number>, ib: Record<string, number>): {
      char: Record<string, unknown> & { aps: number; hp: number; physDef: number; magDef: number; physAtk: { min: number; max: number }; magAtk: { min: number; max: number } };
      cells: Array<{ label: string; val: string }>;
      attrPlus: Record<string, number>;
    };
  };
  damage: {
    DEFAULT_OPP: unknown;
    computeSkillDamage(me: unknown, mob: unknown, sk: { id: number }, lvl: number, t: Record<string, number>, ib: Record<string, number>): unknown;
  };
  tooltip: {
    itemTipHtml(b: DollState, it: Item, cat: string, gearAttr: Record<string, number>, ctx: unknown): string;
    slotTipCtx(b: DollState, slot: string): unknown;
  };
  data: {
    loadSets(): Promise<unknown>;
    loadBuffs(): Promise<void>;
    loadSkills(): Promise<void>;
    loadLabels(): Promise<unknown>;
    getSkills(): Record<string, Array<{ id: number }>> | null;
    getBuffs(): Record<string, Array<{ id: number; types: string[] }>> | null;
    getDebuffs(): Record<string, Array<{ id: number }>> | null;
    getBuffDefaults(): Record<string, number[]> | null;
    getBuffById(id: number): { id: number; qc: Record<string, unknown> } | null;
    buffMaxLevel(b: unknown): number;
    buffHasSides(b: unknown): boolean;
    XZ: Record<string, number>;
    SLOTS: Array<{ slot: string; cat: string }>;
    defaultSockets(cat: string): number;
    ADDON_OPTIONS: Array<{ code: string }>;
  };
}

async function loadCalc(): Promise<Calc> {
  const mods: Record<string, string> = {
    stats: 'src/lib/doll/stats.ts',
    buffs: 'src/lib/doll/buffs.ts',
    summary: 'src/lib/doll/summary.ts',
    damage: 'src/lib/doll/damage.ts',
    tooltip: 'src/lib/doll/tooltip.ts',
    data: 'src/modules/doll/data.ts',
  };
  const entry = Object.entries(mods)
    .map(([k, p]) => `export * as ${k} from ${JSON.stringify(path.join(CALC, p).replace(/\\/g, '/'))};`)
    .join('\n');
  const dir = path.resolve('node_modules/.cache/doll-golden');
  fs.mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, 'calc-doll.mjs');
  await esbuild({
    stdin: { contents: entry, resolveDir: CALC, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile,
    define: { 'import.meta.env.BASE_URL': '"/"' }, // data.ts збирає шлях до JSON; заглушці потрібна лише назва файлу
    logLevel: 'warning',
  });
  // Заглушка fetch: калькулятор вантажить довідники «з мережі», ми віддаємо файл з диска.
  (globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
    json: async () => JSON.parse(fs.readFileSync(path.join(DATA, path.basename(url)), 'utf8')),
  });
  return (await import(pathToFileURL(outfile).href)) as Calc;
}

function checkCalcCommit(): void {
  let head = '';
  let dirty = '';
  try {
    head = execFileSync('git', ['-C', CALC, 'rev-parse', '--short=7', 'HEAD'], { encoding: 'utf8' }).trim();
    dirty = execFileSync('git', ['-C', CALC, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
  } catch (e) {
    console.warn(`не вдалось прочитати git у ${CALC}: ${(e as Error).message}`);
    return;
  }
  const problems: string[] = [];
  if (head !== CALC_SYNC_COMMIT) problems.push(`HEAD калькулятора ${head} ≠ CALC_SYNC_COMMIT ${CALC_SYNC_COMMIT}`);
  if (dirty) problems.push(`у калькуляторі є локальні зміни:\n${dirty}`);
  if (problems.length) {
    const msg = problems.join('\n');
    if (!FORCE) throw new Error(msg + '\n(запустити з --force, якщо це навмисно)');
    console.warn('УВАГА: ' + msg);
  }
}

// ---------- каталоги з диска ----------

const catCache = new Map<string, Item[]>();
function cat(c: string): Item[] {
  let a = catCache.get(c);
  if (!a) {
    a = JSON.parse(fs.readFileSync(path.join(DATA, c + '.json'), 'utf8')) as Item[];
    catCache.set(c, a);
  }
  return a;
}
const byId = new Map<string, Map<number, Item>>();
function getItem(c: string, id: number): Item | undefined {
  let m = byId.get(c);
  if (!m) {
    m = new Map(cat(c).map((x) => [Number(x.id), x]));
    byId.set(c, m);
  }
  return m.get(id);
}
type SetJson = Record<string, { xh?: Array<{ qo: string; id: number }> }>;
const SETS = JSON.parse(fs.readFileSync(path.join(DATA, 'sets.json'), 'utf8')) as SetJson;

/** Чи доступна річ класу (hi = список sm; порожній або повний список = без обмеження). */
function classOk(it: Item, sm: number): boolean {
  const hi = it.hi;
  return !Array.isArray(hi) || hi.length === 0 || hi.length >= 14 || (hi as number[]).includes(sm);
}
const fitting = (c: string, sm: number, level: number): Item[] =>
  cat(c).filter((x) => (Number(x.oj) || 0) <= level && classOk(x, sm));

// ---------- ручні фікстури ----------

const CLS10 = ['by', 'ga', 'ya', 'rl', 'ij', 'js', 'fx', 'sj', 'ej', 'rg'];
type Attrs = Fixture['attrs'];
const A = (str: number, dex: number, vit: number, mag: number): Attrs => ({ str, dex, vit, mag });
// Типові розкидки на 105 (540 очок разом із базою 5): мінімум під вимоги R9 + решта в головний стат.
const ATTRS: Record<string, Attrs> = {
  by: A(300, 150, 85, 5), ga: A(55, 5, 60, 420), ya: A(305, 60, 170, 5), rl: A(55, 5, 80, 400), ij: A(55, 5, 80, 400),
  js: A(105, 380, 50, 5), fx: A(105, 380, 50, 5), sj: A(55, 5, 80, 400), ej: A(250, 200, 85, 5), rg: A(55, 5, 80, 400),
};
// R9-комплекти класів (зброя + 4 броні + пояс) із sets.json.
const R9: Record<string, number> = { by: 48, ga: 47, ya: 43, rl: 49, ij: 41, js: 44, fx: 46, sj: 50, ej: 45, rg: 42 };

const S = (cat: string, id: number, more: Partial<FxSlot> = {}): FxSlot => ({ cat, id, ...more });
const st = (t: string, v: number): FxStat => ({ t, v });
const flat = (calc: Calc, it: Item): FxStat[] => calc.stats.flattenItemStats(it).map((s) => st(s.type, s.val));

function flightFor(sm: number): FxSlot | null {
  const it = cat('ic').find((x) => (Number(x.oj) || 0) <= 105 && classOk(x, sm));
  return it ? S('ic', Number(it.id)) : null;
}

/** Типовий білд класу: R9 + шолом/плащ сету «Артефакт», біжутерія, книга, збірник, джин, тома, політ. */
function typical(calc: Calc, cls: string): Fixture {
  const sm = calc.data.XZ[cls];
  const slots: Record<string, FxSlot> = {};
  for (const p of SETS[String(R9[cls])].xh || []) {
    const slot = p.qo;
    slots[slot] = S(slot, p.id, slot === 'ta' ? { r: 10, g: [54, 55] } : slot === 'st' ? { r: 5 } : { r: 8, g: [198, 198, 198, 198] });
  }
  slots.ft = S('ft', 83, { r: 8, g: [198, 198, 198, 198] });
  slots.wy = S('wy', 40, { r: 8, g: [198, 198, 198, 198] });
  slots.vx = S('vx', 236, { r: 5 });
  slots.cr = S('oq', 284, { r: 5 });
  slots.cd = S('oq', 280, { r: 5 });
  slots.qn = S('qn', 109, { r: 3 });
  slots.pp = S('pp', 146, { g: [198, 198, 0, 0] });
  slots.pk = S('pk', 1);
  slots.gv = S('gv', 1);
  const ic = flightFor(sm);
  if (ic) slots.ic = ic;
  if (cls === 'js') slots.it = S('it', 8);
  return { name: 'typical-' + cls, tags: ['typical'], cls, gender: 'm', level: 105, attrs: ATTRS[cls], slots };
}

function manualFixtures(calc: Calc): Fixture[] {
  const out: Fixture[] = CLS10.map((c) => typical(calc, c));
  const T = (cls: string): Fixture => typical(calc, cls);
  const edge = (name: string, tags: string[], fx: Fixture): Fixture => ({ ...fx, name: 'edge-' + name, tags });
  const min = (cls: string, slots: Record<string, FxSlot>, over: Partial<Fixture> = {}): Fixture => ({
    name: '', cls, gender: 'm', level: 105, attrs: ATTRS[cls], slots, ...over,
  });
  const set3 = { rx: S('rx', 178), mj: S('mj', 190), tg: S('tg', 229), ft: S('ft', 105), rv: S('rv', 224) }; // «Народный лидер» 2/3/4/5
  const set7 = { mj: S('mj', 268), tg: S('tg', 333), rv: S('rv', 337), rx: S('rx', 289), ft: S('ft', 169), wy: S('wy', 113) }; // «Пробуждение» 2/5/6
  const set52 = { rx: S('rx', 338), tg: S('tg', 379), rv: S('rv', 395), mj: S('mj', 324), st: S('st', 338) }; // «Бог войны» + кільце 205
  const pick = (o: Record<string, FxSlot>, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o[k]]));
  const ALL = A(500, 500, 500, 500); // вимоги завжди виконані — щоб поріг комплекту залежав лише від к-сті деталей
  const withTa = (fx: Fixture, more: Partial<FxSlot>): Fixture => ({ ...fx, slots: { ...fx.slots, ta: { ...fx.slots.ta, ...more } } });
  const withSlot = (fx: Fixture, slot: string, more: Partial<FxSlot>): Fixture => ({ ...fx, slots: { ...fx.slots, [slot]: { ...fx.slots[slot], ...more } } });
  const taOf = (fx: Fixture): Item => getItem('ta', fx.slots.ta.id)!;
  const rvOf = (fx: Fixture): Item => getItem('rv', fx.slots.rv.id)!;

  // Речі: непорожні «Характеристики» замінюють базу (stats.ts aggregateStats) — і як заміна, і як база+добавка.
  out.push(edge('addons-replace', ['addons'], withTa(T('js'), { a: [st('ld_min', 1000), st('ld_max', 2000), st('ad', 30)] })));
  out.push(edge('addons-append', ['addons'], withTa(T('js'), { a: [...flat(calc, taOf(T('js'))), st('hp', 300), st('ed', 2)] })));
  out.push(edge('addons-empty-list', ['addons'], withTa(T('by'), { a: [] })));
  out.push(edge('engrave', ['engrave'], withSlot(withTa(T('by'), { e: [st('ld_min', 50), st('ld_max', 80)] }), 'rv', { e: [st('hp', 200), st('wf', 100)] })));
  out.push(edge('wdf-crystal', ['wdf', 'crystal'], withTa(T('ga'), { w: 2, c: 25 })));
  out.push(edge('wdf-only', ['wdf'], withTa(T('fx'), { w: 1 })));
  // Пороги комплектів.
  out.push(edge('set-2', ['set'], min('by', { ft: S('ft', 83), wy: S('wy', 40) })));
  out.push(edge('set-3-of-5', ['set'], min('by', pick(set3, ['rx', 'mj', 'tg']), { attrs: ALL })));
  out.push(edge('set-4-of-5', ['set'], min('by', pick(set3, ['rx', 'mj', 'tg', 'ft']), { attrs: ALL })));
  out.push(edge('set-5-of-5', ['set'], min('by', set3, { attrs: ALL })));
  out.push(edge('set-5-of-6', ['set'], min('ya', pick(set7, ['mj', 'tg', 'rv', 'rx', 'ft']), { attrs: ALL })));
  out.push(edge('set-6-of-6', ['set'], min('ya', set7, { attrs: ALL })));
  out.push(edge('set-mixed', ['set'], min('by', { ft: S('ft', 83), wy: S('wy', 40), rx: S('rx', 178), mj: S('mj', 190) }, { attrs: ALL })));
  out.push(edge('set-req-unmet', ['set', 'req'], { ...T('js'), attrs: A(5, 400, 130, 5) })); // зброя без сили → не активна → деталей менше
  out.push(edge('set-level-too-low', ['set', 'req'], { ...min('by', set3), level: 79 })); // oj 80 → жодна не активна
  // Ланцюжок вимог: збірник +50 інт «вмикає» зброю з вимогою 285.
  out.push(edge('req-chain-tract', ['req'], min('ga', { ta: S('ta', 1176), pp: S('pp', 146) }, { attrs: A(55, 5, 60, 250) })));
  out.push(edge('req-chain-broken', ['req'], min('ga', { ta: S('ta', 1176) }, { attrs: A(55, 5, 60, 250) })));
  // Заточка книги: пороги +3/+6/+9/+12 і власна таблиця поправок.
  for (const r of [3, 6, 9, 12]) out.push(edge('book-refine-' + r, ['refine', 'book'], withSlot(T('ij'), 'qn', { r })));
  {
    const known = new Set([5, 6, 7, 8, 9, 10, 11, 12, 14]);
    const q = cat('qn').find((x) => Array.isArray(x.gh) && !known.has(Number((x.gh as unknown[])[1])));
    if (q) out.push(edge('book-refine-fallback', ['refine', 'book'], min('sj', { qn: S('qn', Number(q.id), { r: 7 }) })));
  }
  out.push(edge('refine-12-all', ['refine'], { ...T('by'), slots: Object.fromEntries(Object.entries(T('by').slots).map(([k, s]) => [k, { ...s, r: 12 }])) }));
  // Титули: кап 3000 на поле, відʼємні й дробові значення.
  out.push(edge('titles-cap', ['titles'], { ...T('by'), titles: { ld: 5000, xq: 3000, hp: 2999, ab_gq: 3500, wf: -5, ae: 100.6, qe: 0 } }));
  out.push(edge('titles-only', ['titles'], min('ga', {}, { titles: { xq: 500, hp: 1000 } })));
  // Кільця: два однакові — одна деталь; різні — обидва рахуються окремо.
  out.push(edge('rings-same-full', ['set', 'rings'], min('by', { ...set52, cr: S('oq', 205), cd: S('oq', 205) }, { attrs: ALL })));
  out.push(edge('rings-same-partial', ['set', 'rings'], min('by', { st: S('st', 338), cr: S('oq', 205), cd: S('oq', 205) }, { attrs: ALL })));
  out.push(edge('rings-different', ['set', 'rings'], min('by', { ...set52, cr: S('oq', 205), cd: S('oq', 284) }, { attrs: ALL })));
  // Лук + боєприпаси; без боєприпасів; без зброї.
  out.push(edge('bow-ammo', ['ammo'], min('js', { ta: S('ta', 1902, { r: 10 }), it: S('it', 8) })));
  out.push(edge('bow-no-ammo', ['ammo'], min('js', { ta: S('ta', 1902, { r: 10 }) })));
  out.push(edge('no-weapon', ['aps'], { ...T('by'), slots: Object.fromEntries(Object.entries(T('by').slots).filter(([k]) => k !== 'ta')) }));
  // Кап атак/сек: швидка зброя + велика xn; і через баф швидкості атаки.
  out.push(edge('aps-cap', ['aps'], min('fx', { ta: S('ta', 50, { a: [st('ld_min', 431), st('ld_max', 518), st('xn', 0.6)] }) })));
  out.push(edge('aps-buff', ['aps', 'buffs'], { ...T('js'), buffCfg: { '144': { on: true, lvl: 10, side: '' } } }));
  // Рівень 1 і порожній білд.
  out.push(edge('level-1', ['level'], min('by', { ta: S('ta', 14) }, { level: 1, attrs: A(5, 5, 5, 5) })));
  out.push(edge('empty', ['level'], min('ga', {}, { attrs: A(5, 5, 5, 5) })));
  // Бафи зі сторонами, дебафи, додані вручну, рівень понад максимум.
  out.push(edge('buffs-rs', ['buffs'], { ...T('by'), buffCfg: { '5': { on: true, lvl: 11, side: 'rs' }, '17': { on: true, lvl: 11, side: 'rs' }, '1': { on: true, lvl: 10, side: '' } } }));
  out.push(edge('buffs-je', ['buffs'], { ...T('by'), buffCfg: { '5': { on: true, lvl: 11, side: 'je' }, '17': { on: true, lvl: 11, side: 'je' }, '1': { on: true, lvl: 10, side: '' } } }));
  out.push(edge('debuffs', ['buffs'], { ...T('ya'), buffCfg: { '94': { on: true, lvl: 10, side: '' }, '98': { on: true, lvl: 11, side: 'je' }, '102': { on: true, lvl: 10, side: '' }, '6': { on: false, lvl: 10, side: '' } } }));
  out.push(edge('buffs-extra', ['buffs'], { ...T('ij'), extraBuffs: [22, 5], buffCfg: { '22': { on: true, lvl: 10, side: '' }, '5': { on: true, lvl: 9, side: '' }, '40': { on: false, lvl: 10, side: '' } } }));
  out.push(edge('buff-lvl-over-max', ['buffs'], { ...T('rg'), buffCfg: { '5': { on: true, lvl: 99, side: '' }, '40': { on: true, lvl: 0, side: '' } } }));
  // Камені: зброя (obDops[0]) / броня (obDops[1]) / збірник; камінь з одним допом у броні.
  out.push(edge('gems-mixed', ['gems'], withSlot(withSlot(withTa(T('ya'), { g: [54, 55] }), 'rv', { g: [43, 57, 58, 0] }), 'pp', { g: [198, 0, 198, 0] })));
  out.push(edge('gem-single-dop', ['gems'], withSlot(T('ej'), 'rv', { g: [201, 0, 0, 0] })));
  // Стать, стихійний захист обʼєктом, спритнісна зброя у мага, аліаси кодів, магічна зброя у воїна.
  out.push(edge('gender-f', ['misc'], { ...T('ga'), gender: 'f' }));
  out.push(edge('elem-object', ['misc'], min('ij', { rv: S('rv', 1) })));
  out.push(edge('dex-weapon-mage', ['misc'], withTa({ ...T('ga'), attrs: A(55, 300, 60, 125) }, { id: 1368, r: 10, g: [54, 55] })));
  out.push(edge('stat-alias', ['addons'], withSlot(T('by'), 'rv', { a: [...flat(calc, rvOf(T('by'))), st('mana', 100), st('oi_eq', 50), st('ab_eq', 40), st('metal_eq', 10)] })));
  out.push(edge('magic-weapon-warrior', ['misc'], withTa(T('by'), { id: 1176, r: 10, g: [54, 55] })));
  out.push(edge('genie-flight-tome', ['misc'], min('ej', { pk: S('pk', 3), gv: S('gv', 2), ...(flightFor(9) ? { ic: flightFor(9)! } : {}) })));
  return out;
}

// ---------- випадкові білди ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFixtures(calc: Calc, n: number): Fixture[] {
  const rnd = mulberry32(SEED);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1)); // включно
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const chance = (p: number) => rnd() < p;
  const codes = calc.data.ADDON_OPTIONS.map((o) => o.code);
  const randStat = (): FxStat => {
    const c = pick(codes);
    if (c === 'ci' || c === 'ed' || c === 'bu' || c === 'ia' || c === 'co' || c === 'cc') return st(c, int(1, 10));
    if (c === 'cl') return st(c, int(1, 5) / 10);
    return st(c, int(1, 300));
  };
  const buffs = calc.data.getBuffs()!;
  const debuffs = calc.data.getDebuffs()!;
  const defaults = calc.data.getBuffDefaults()!;
  const allBuffIds = Object.values(buffs).flat().map((b) => b.id);
  const cfgFor = (id: number): Cfg => {
    const def = calc.data.getBuffById(id)!;
    const max = calc.data.buffMaxLevel(def);
    const sides = calc.data.buffHasSides(def);
    const side = sides && chance(0.5) ? pick(['rs', 'je']) : '';
    return { on: chance(0.8), lvl: side ? max : int(1, max), side };
  };
  const gemsFor = (host: Item, hostCat: string): Item[] => {
    const hf = Number(host.hf) || 0;
    return cat('ob').filter((g) => {
      if (hf && (Number(g.hf) || 0) > hf) return false;
      if (['ft', 'rv', 'tg', 'rx', 'ta', 'wy', 'mj'].includes(hostCat) && g.pg !== 'generic') return false;
      return true;
    });
  };
  const titleCodes = ['ld', 'xq', 'wf', 'ab_gq', 'ae', 'qe', 'hp'];

  const out: Fixture[] = [];
  for (let i = 0; i < n; i++) {
    const cls = pick(CLS10);
    const sm = calc.data.XZ[cls];
    const level = chance(0.8) ? 105 : int(1, 105);
    // Розкидка: базова 5 + бюджет 5/рівень за вагами архетипу з шумом
    // (частина білдів не дотягне до вимог речей — так і треба: перевіряємо computeActiveSlots).
    const w = ATTRS[cls];
    const budget = 5 * (level - 1);
    const jitter = () => 0.7 + rnd() * 0.6;
    const raw = { str: (w.str - 5) * jitter(), dex: (w.dex - 5) * jitter(), vit: (w.vit - 5) * jitter(), mag: (w.mag - 5) * jitter() };
    const rsum = raw.str + raw.dex + raw.vit + raw.mag || 1;
    const attrs = A(
      5 + Math.round((raw.str / rsum) * budget),
      5 + Math.round((raw.dex / rsum) * budget),
      5 + Math.round((raw.vit / rsum) * budget),
      5 + Math.round((raw.mag / rsum) * budget),
    );

    const slots: Record<string, FxSlot> = {};
    for (const def of calc.data.SLOTS) {
      const p = def.slot === 'ic' ? 0.5 : def.slot === 'it' ? 0.5 : 0.85;
      if (!chance(p)) continue;
      const pool = fitting(def.cat, sm, level);
      if (!pool.length) continue;
      const it = pick(pool);
      const s: FxSlot = S(def.cat, Number(it.id));
      if (chance(0.7)) s.r = int(1, 12);
      const nSock = calc.data.defaultSockets(def.cat);
      if (nSock) {
        const gpool = gemsFor(it, def.cat);
        const g: number[] = [];
        for (let k = 0; k < nSock; k++) g.push(gpool.length && chance(0.6) ? Number(pick(gpool).id) : 0);
        if (g.some(Boolean)) s.g = g;
      }
      const roll = rnd();
      if (roll < 0.1) s.a = [...flat(calc, it), ...Array.from({ length: int(1, 2) }, randStat)];
      else if (roll < 0.15) s.a = Array.from({ length: int(1, 3) }, randStat);
      if (chance(0.15)) s.e = Array.from({ length: int(1, 2) }, randStat);
      if (def.slot === 'ta') {
        if (chance(0.3)) s.w = Number(pick(cat('wdf')).id);
        if (chance(0.3)) s.c = Number(pick(cat('crystal')).id);
      }
      slots[def.slot] = s;
    }
    const fx: Fixture = { name: 'rnd-' + String(i + 1).padStart(3, '0'), cls, gender: chance(0.5) ? 'm' : 'f', level, attrs, slots };
    if (chance(0.2)) {
      fx.titles = {};
      for (const c of titleCodes) if (chance(0.5)) fx.titles[c] = int(0, 4000);
    }
    if (chance(0.5)) {
      const cfg: Record<string, Cfg> = {};
      const own = defaults[String(sm)] || [];
      for (let k = 0, m = int(1, 5); k < m && own.length; k++) cfg[String(pick(own))] = cfgFor(pick(own));
      const deb = debuffs[String(sm)] || [];
      if (deb.length && chance(0.3)) {
        const d = pick(deb);
        cfg[String(d.id)] = cfgFor(d.id);
      }
      if (chance(0.2)) {
        fx.extraBuffs = [];
        for (let k = 0, m = int(1, 2); k < m; k++) {
          const id = pick(allBuffIds);
          if (!fx.extraBuffs.includes(id)) fx.extraBuffs.push(id);
          if (chance(0.7)) cfg[String(id)] = cfgFor(id);
        }
      }
      // Ключі buffCfg — у стабільному порядку, щоб фікстура не «плавала» між прогонами.
      fx.buffCfg = Object.fromEntries(Object.keys(cfg).sort((a, b) => Number(a) - Number(b)).map((k) => [k, cfg[k]]));
    }
    out.push(fx);
  }
  return out;
}

// ---------- еталони ----------

interface Golden {
  t: Record<string, number>;
  gearAttr: Record<string, number>;
  active: string[];
  ib: Record<string, number>;
  char: unknown;
  cells: Array<[string, string]>;
  attrPlus: Record<string, number>;
  shown: { buffs: number[]; debuffs: number[] };
  skills: Record<string, unknown>;
  derived: Record<string, number>;
}

function golden(calc: Calc, fx: Fixture): Golden {
  const build = hydrateFixture(fx, getItem);
  const { t, gearAttr } = calc.stats.computeStats(build);
  const active = [...calc.stats.computeActiveSlots(build)].sort();
  const ib = calc.buffs.deriveIb(build);
  const sum = calc.summary.computeSummary(build, t, ib);
  const skills: Record<string, unknown> = {};
  for (const sk of calc.data.getSkills()?.[String(calc.data.XZ[fx.cls])] || [])
    skills[String(sk.id)] = calc.damage.computeSkillDamage(sum.char, calc.damage.DEFAULT_OPP, sk, build.level, t, ib);
  // «Похідні числа» для порівняння сетів — без станів (ib = {}), формули як у summary.ts (g = t + ib).
  const c0 = calc.summary.computeSummary(build, t, {}).char;
  const g = (...keys: string[]) => keys.reduce((s, k) => s + (t[k] || 0), 0);
  const derived = {
    pa: g('ad', 'gs_ad'), pz: g('sx', 'gs_sx'), channel: g('ci') - g('re') + g('xj'), xn: g('xn'),
    aps: c0.aps, hp: c0.hp, physDef: c0.physDef, magDefAvg: c0.magDef,
    physAtkMin: c0.physAtk.min, physAtkMax: c0.physAtk.max, magAtkMin: c0.magAtk.min, magAtkMax: c0.magAtk.max,
  };
  return {
    t, gearAttr, active, ib, char: sum.char,
    cells: sum.cells.map((c) => [c.label, c.val] as [string, string]),
    attrPlus: sum.attrPlus,
    shown: { buffs: calc.buffs.shownBuffs(build).map((b) => b.id), debuffs: calc.buffs.shownDebuffs(build).map((b) => b.id) },
    skills, derived,
  };
}

/** Текст тултіпа calc без тегів: рядки за <div>, сутності розкодовано, порожні (розділювачі) відкинуто. */
function htmlLines(html: string): string[] {
  return html
    .split('</div>')
    .map((s) =>
      s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim(),
    )
    .filter(Boolean);
}

/** Які слоти фіксувати в еталоні тултіпів: типові білди — усі; краї — лише те, чим вони
 *  відрізняються від типового білда класу (інакше tips.json роздувається повторами). */
function tipSlots(calc: Calc, fx: Fixture): Set<string> {
  const all = new Set(Object.keys(fx.slots));
  if (fx.tags?.includes('typical')) return all;
  const base = typical(calc, fx.cls);
  const sameChar = JSON.stringify(fx.attrs) === JSON.stringify(base.attrs) && fx.level === base.level && fx.gender === base.gender;
  if (!sameChar) return all; // вимоги/активність речей інші → усі тултіпи інші
  return new Set([...all].filter((s) => JSON.stringify(fx.slots[s]) !== JSON.stringify(base.slots[s])));
}

function tips(calc: Calc, fx: Fixture): Record<string, { name: string; lines: string[] }> {
  const build = hydrateFixture(fx, getItem);
  const { gearAttr } = calc.stats.computeStats(build);
  const out: Record<string, { name: string; lines: string[] }> = {};
  const wanted = tipSlots(calc, fx);
  for (const def of calc.data.SLOTS) {
    const it = build.equipped[def.slot];
    if (!it || !wanted.has(def.slot)) continue;
    const lines = htmlLines(calc.tooltip.itemTipHtml(build, it, def.cat, gearAttr, calc.tooltip.slotTipCtx(build, def.slot)));
    out[def.slot] = { name: lines[0], lines: lines.slice(1) };
  }
  return out;
}

// ---------- запис ----------

/** JSON без NaN/Infinity (вони б мовчки стали null і зіпсували еталон). */
function jsonLine(v: unknown): string {
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === 'number' && !Number.isFinite(x)) throw new Error('нескінченне число в еталоні: ' + _k);
    return x;
  });
}
function writeArray(file: string, items: unknown[]): void {
  fs.writeFileSync(file, '[\n' + items.map(jsonLine).join(',\n') + '\n]\n');
}
function writeMap(file: string, entries: Array<[string, unknown]>): void {
  fs.writeFileSync(file, '{\n' + entries.map(([k, v]) => JSON.stringify(k) + ': ' + jsonLine(v)).join(',\n') + '\n}\n');
}

async function main(): Promise<void> {
  checkCalcCommit();
  const calc = await loadCalc();
  await calc.data.loadSets();
  await calc.data.loadBuffs();
  await calc.data.loadSkills();
  await calc.data.loadLabels();

  const manual = manualFixtures(calc);
  const random = randomFixtures(calc, RANDOM_N);
  const names = new Set<string>();
  for (const f of [...manual, ...random]) {
    if (names.has(f.name)) throw new Error('дубль імені фікстури: ' + f.name);
    names.add(f.name);
    hydrateFixture(f, getItem); // усі посилання мають існувати
  }

  fs.mkdirSync(path.join(OUT, 'fixtures'), { recursive: true });
  fs.mkdirSync(path.join(OUT, 'golden'), { recursive: true });
  writeArray(path.join(OUT, 'fixtures/manual.json'), manual);
  writeArray(path.join(OUT, 'fixtures/random.json'), random);
  writeMap(path.join(OUT, 'golden/manual.json'), manual.map((f) => [f.name, golden(calc, f)]));
  writeMap(path.join(OUT, 'golden/random.json'), random.map((f) => [f.name, golden(calc, f)]));
  writeMap(path.join(OUT, 'golden/tips.json'), manual.map((f) => [f.name, tips(calc, f)]));

  // Коротка звірка країв — щоб побачити, що фікстури справді перевіряють задумане.
  const show = (name: string, pickKeys: (g: Golden) => unknown) => {
    const f = manual.find((x) => x.name === name)!;
    console.log(name.padEnd(28), jsonLine(pickKeys(golden(calc, f))));
  };
  show('edge-req-chain-tract', (g) => ({ active: g.active, ad: g.t.ad }));
  show('edge-req-chain-broken', (g) => ({ active: g.active }));
  show('edge-set-req-unmet', (g) => ({ active: g.active, ad: g.t.ad, sx: g.t.sx }));
  show('edge-set-level-too-low', (g) => ({ active: g.active, om: g.t.om }));
  show('edge-set-5-of-5', (g) => ({ om: g.t.om, wz: g.t.wz, bu: g.t.bu, su: g.t.su }));
  show('edge-set-6-of-6', (g) => ({ hp: g.t.hp, sx: g.t.sx, ad: g.t.ad }));
  show('edge-rings-same-partial', (g) => ({ sx: g.t.sx, ed: g.t.ed }));
  show('edge-rings-different', (g) => ({ sx: g.t.sx, ad: g.t.ad }));
  show('edge-aps-cap', (g) => ({ aps: g.derived.aps, xn: g.t.xn }));
  show('edge-aps-buff', (g) => ({ aps: (g.char as { aps: number }).aps, ib: g.ib }));
  show('edge-titles-cap', (g) => ({ ld_min: g.t.ld_min, hp: g.t.hp, lw_eq: g.t.lw_eq, wf: g.t.wf, ae: g.t.ae }));
  show('edge-book-refine-12', (g) => ({ ad: g.t.ad, ld_min: g.t.ld_min, mr: g.t.mr }));
  show('edge-buffs-rs', (g) => ({ ib: g.ib }));
  show('edge-level-1', (g) => ({ active: g.active, hp: g.derived.hp }));
  const inactive = random.filter((f) => golden(calc, f).active.length < Object.keys(f.slots).length).length;
  const size = (f: string) => (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' КБ';
  console.log(`\nфікстур: ${manual.length} ручних + ${random.length} випадкових (з них ${inactive} мають неактивні слоти)`);
  console.log(`розміри: fixtures ${size('fixtures/manual.json')} + ${size('fixtures/random.json')}; golden ${size('golden/manual.json')} + ${size('golden/random.json')} + tips ${size('golden/tips.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
