// =========================================================
// ЛЯЛЬКА — спільний розрахунок для панелей і розкладка зведення по групах.
// Панелі (характеристики, стани, перевірка урону) дивляться на ту саму
// конфігурацію, тож рахуємо її один раз на «модель + конфігурація + режим» і
// кешуємо за посиланням на модель: нова гідрація документа — новий розрахунок.
// Бафи тут ЛИШЕ для перегляду статів «в бою»: у скор і в дельти сетів вони
// не входять (рішення власника); «Чисті» рахуються без них, як скор.
// =========================================================

import { deriveIb } from '../../core/buffs';
import { derivedNumbers, type DerivedNumbers } from '../../core/derived';
import { hasRefData } from '../../core/refdata';
import { computeStats } from '../../core/stats';
import { computeSummary, type SummaryCell, type SummaryResult } from '../../core/summary';
import type { DollState } from '../../core/types';
import { toDollState, type CharacterModel } from '../../model/hydrate';
import { classPassives } from '../../model/passives';

export interface CfgCalc {
  build: DollState;
  t: Record<string, number>; // тотали спорядження
  ib: Record<string, number>; // ефекти увімкнених станів (порожній = без бафів)
  summary: SummaryResult;
  derived: DerivedNumbers;
  buffed: boolean; // хоч один стан (не пасивка) увімкнено — числа «з бафами»
  passives: boolean; // хоч одна пасивка класу діє
}

const cache = new WeakMap<CharacterModel, Map<string, CfgCalc>>();

/**
 * Повний розрахунок конфігурації. withBuffs — з бафами й дебафами документа
 * («У бою»); false — як рахує скор («Чисті»: лише пасивки класу). Для сету —
 * заповнена конфігурація (порожні слоти з Головного), як її рахуватиме скор.
 * Один розрахунок на модель + cfgId + режим.
 */
export function calcFor(model: CharacterModel, cfgId: string, withBuffs = true): CfgCalc {
  let byCfg = cache.get(model);
  if (!byCfg) {
    byCfg = new Map();
    cache.set(model, byCfg);
  }
  // Без довідників ядро не бачить сетів і бафів — такий результат не має
  // перекрити «справжній» після їх завантаження, тому ключ інший.
  const key = cfgId + (withBuffs ? '|b' : '') + (hasRefData() ? '' : '#noref');
  const hit = byCfg.get(key);
  if (hit) return hit;
  const build = toDollState(model, cfgId, { buffs: withBuffs });
  const { t } = computeStats(build);
  const ib = deriveIb(build);
  const summary = computeSummary(build, t, ib);
  const derived = derivedNumbers(build, ib, t);
  const passiveIds = new Set(classPassives(build.cls).map((b) => String(b.id)));
  const on = Object.entries(build.buffCfg).filter(([, c]) => c.on);
  const buffed = on.some(([k]) => !passiveIds.has(k));
  const passives = on.some(([k]) => passiveIds.has(k));
  const calc: CfgCalc = { build, t, ib, summary, derived, buffed, passives };
  byCfg.set(key, calc);
  return calc;
}

/** Число як у зведенні ядра: ціле, з українським розділювачем тисяч. */
export const fmt = (n: number): string => Math.round(n).toLocaleString('uk');
const rng = (r: { min: number; max: number }): string => fmt(r.min) + '–' + fmt(r.max);

/** Час співу як у зведенні: додатне значення СКОРОЧУЄ час, тому показується з мінусом. */
export function channelText(channel: number): string {
  return (channel > 0 ? '−' : channel < 0 ? '+' : '') + fmt(Math.abs(channel)) + '%';
}

/** Число зі знаком для дельт: «+20», «−5», «0». Мінус — типографський, як у зведенні. */
export function signed(n: number, digits = 0): string {
  const v = digits ? Number(n.toFixed(digits)) : Math.round(n);
  if (v === 0) return '0';
  const abs = digits ? Math.abs(v).toFixed(digits) : fmt(Math.abs(v));
  return (v > 0 ? '+' : '−') + abs;
}

/** Класи, яким важлива маг. атака і час співу (решті — фіз. атака і атак/сек):
 * маг, друїд, жрець, шаман, містик. */
const CASTER: ReadonlySet<string> = new Set(['ga', 'rl', 'ij', 'sj', 'rg']);
export const isCaster = (cls: string): boolean => CASTER.has(cls);

export interface HeroCell {
  key: 'hp' | 'atk' | 'pa' | 'pz' | 'crit' | 'channel' | 'aps';
  label: string;
  val: string;
  /** Дрібна примітка праворуч від підпису («сер. 24 226»). */
  note?: string;
  /** Плитка на дві колонки сітки (атака, здоровʼя). */
  wide?: boolean;
}

/** Середнє діапазону атаки — та сама формула, що в силі персонажа (powerOf). */
const avgNote = (r: { min: number; max: number }): string => 'сер. ' + fmt((r.min + r.max) / 2);

/** Плитки характеристик у порядку макета B3: атака (на дві колонки, з середнім),
 * ПА, ПЗ / здоровʼя (на дві), крит, атак/сек або спів. Атака й темп — за профілем класу. */
export function heroCells(calc: CfgCalc): HeroCell[] {
  const c = calc.summary.char;
  const d = calc.derived;
  const caster = isCaster(calc.build.cls);
  const atk = caster ? c.magAtk : c.physAtk;
  return [
    { key: 'atk', label: caster ? 'Маг. атака' : 'Фіз. атака', val: rng(atk), note: avgNote(atk), wide: true },
    { key: 'pa', label: 'ПА', val: fmt(d.pa) },
    { key: 'pz', label: 'ПЗ', val: fmt(d.pz) },
    { key: 'hp', label: 'Здоровʼя', val: fmt(c.hp), wide: true },
    { key: 'crit', label: 'Крит', val: c.crit + '%' },
    caster
      ? { key: 'channel', label: 'Спів', val: channelText(d.channel) }
      : { key: 'aps', label: 'Атак/сек', val: d.aps ? d.aps.toFixed(2) : '—' },
  ];
}

export type GroupKey = 'attack' | 'defense' | 'other';
export interface StatGroup {
  key: GroupKey;
  title: string;
  cells: SummaryCell[];
}

// Підписи — ті самі рядки, що віддає computeSummary (порядок 1:1 з mypers);
// тут лише перекладаємо їх у групи. Невідомий підпис не губиться — іде в «Інше».
const ATTACK = [
  'Фіз. атака', 'Маг. атака', 'Шанс криту', 'Крит. урон', 'Атак/сек', 'Час співу', 'Міткість',
  'Рівень атаки', 'Фіз. пробивання', 'Маг. пробивання', 'Урон монстрам',
];
const DEFENSE = [
  'Здоровʼя', 'Мана', 'Фіз. захист', 'Маг. захист (сер.)', 'Метал', 'Дерево', 'Вода', 'Вогонь', 'Земля',
  'Ухилення', 'Рівень захисту', 'Зменш. фіз. урону', 'Зменш. маг. урону', 'Захист від монстрів',
];
const OTHER = ['Віднов. HP/сек', 'Віднов. MP/сек', 'Швидкість', 'Бойовий дух', 'Сила духу', 'Скритність', 'Виявлення'];
const KNOWN: ReadonlySet<string> = new Set([...ATTACK, ...DEFENSE, ...OTHER]);

/** 32 комірки зведення → «Атака / Захист / Інше». Атрибути (з бонусами речей)
 * показує картка «Атрибути», тож окремої групи тут немає. */
export function groupCells(summary: SummaryResult): StatGroup[] {
  const byLabel = new Map(summary.cells.map((c) => [c.label, c]));
  const pick = (labels: string[]): SummaryCell[] =>
    labels.flatMap((l) => {
      const c = byLabel.get(l);
      return c ? [c] : [];
    });
  const rest = summary.cells.filter((c) => !KNOWN.has(c.label));
  return [
    { key: 'attack', title: 'Атака', cells: pick(ATTACK) },
    { key: 'defense', title: 'Захист', cells: pick(DEFENSE) },
    { key: 'other', title: 'Інше', cells: [...pick(OTHER), ...rest] },
  ];
}

/** Перше число з тексту стата — щоб знати напрям зміни для підсвітки (порт Хелпера). */
export function statNum(s: string): number {
  const m = s.replace(/\s/g, '').replace(/−/g, '-').match(/-?\d+(?:[.,]\d+)?/);
  return m ? parseFloat(m[0].replace(',', '.')) : NaN;
}

/** Напрям фліша: значення змінилось і обидва числові. */
export function flashDir(prev: string | undefined, next: string): 'up' | 'down' | null {
  if (prev == null || prev === next) return null;
  const a = statNum(prev);
  const b = statNum(next);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return null;
  return b > a ? 'up' : 'down';
}
