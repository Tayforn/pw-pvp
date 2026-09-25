// =========================================================
// ЛЯЛЬКА — спільний розрахунок для панелей і розкладка зведення по групах.
// Панелі (характеристики, стани, перевірка урону) дивляться на ту саму
// конфігурацію, тож рахуємо її один раз на «модель + конфігурація» і
// кешуємо за посиланням на модель: нова гідрація документа — новий розрахунок.
// Бафи тут ЛИШЕ для перегляду статів «в бою»: у скор і в дельти сетів вони
// не входять (рішення власника).
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
 * Повний розрахунок конфігурації з бафами документа. Для сету — заповнена
 * конфігурація (порожні слоти з Головного), як її рахуватиме скор.
 * Один розрахунок на модель + cfgId.
 */
export function calcFor(model: CharacterModel, cfgId: string): CfgCalc {
  let byCfg = cache.get(model);
  if (!byCfg) {
    byCfg = new Map();
    cache.set(model, byCfg);
  }
  // Без довідників ядро не бачить сетів і бафів — такий результат не має
  // перекрити «справжній» після їх завантаження, тому ключ інший.
  const key = cfgId + (hasRefData() ? '' : '#noref');
  const hit = byCfg.get(key);
  if (hit) return hit;
  const build = toDollState(model, cfgId, { buffs: true });
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
}

/** Hero-рядок: те, на що дивляться першим. Атака й темп — за профілем класу. */
export function heroCells(calc: CfgCalc): HeroCell[] {
  const c = calc.summary.char;
  const d = calc.derived;
  const caster = isCaster(calc.build.cls);
  return [
    { key: 'hp', label: 'Здоровʼя', val: fmt(c.hp) },
    caster ? { key: 'atk', label: 'Маг. атака', val: rng(c.magAtk) } : { key: 'atk', label: 'Фіз. атака', val: rng(c.physAtk) },
    { key: 'pa', label: 'ПА', val: fmt(d.pa) },
    { key: 'pz', label: 'ПЗ', val: fmt(d.pz) },
    { key: 'crit', label: 'Крит', val: c.crit + '%' },
    caster
      ? { key: 'channel', label: 'Спів', val: channelText(d.channel) }
      : { key: 'aps', label: 'Атак/сек', val: d.aps ? d.aps.toFixed(2) : '—' },
  ];
}

export type GroupKey = 'attack' | 'defense' | 'attrs' | 'other';
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

export interface AttrBase {
  str: number;
  dex: number;
  vit: number;
  mag: number;
}

/** Комірка атрибута: ефективне значення і бонус від речей у дужках — як у шапці Хелпера. */
function attrCell(label: string, base: number, plus: number): SummaryCell {
  return { label, val: fmt(base + plus) + (plus ? ' (' + signed(plus) + ')' : '') };
}

/** 32 комірки зведення → «Атака / Захист / Атрибути / Інше». Атрибути — з бонусів речей (attrPlus). */
export function groupCells(summary: SummaryResult, base: AttrBase): StatGroup[] {
  const byLabel = new Map(summary.cells.map((c) => [c.label, c]));
  const pick = (labels: string[]): SummaryCell[] =>
    labels.flatMap((l) => {
      const c = byLabel.get(l);
      return c ? [c] : [];
    });
  const rest = summary.cells.filter((c) => !KNOWN.has(c.label));
  const p = summary.attrPlus;
  return [
    { key: 'attack', title: 'Атака', cells: pick(ATTACK) },
    { key: 'defense', title: 'Захист', cells: pick(DEFENSE) },
    {
      key: 'attrs',
      title: 'Атрибути',
      cells: [
        attrCell('Сила', base.str, p.str),
        attrCell('Спритність', base.dex, p.dex),
        attrCell('Тілобудова', base.vit, p.vit),
        attrCell('Інтелект', base.mag, p.mag),
      ],
    },
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
