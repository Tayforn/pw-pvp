// =========================================================
// ЛЯЛЬКА — зведення характеристик персонажа (пари рядків таблиці).
// Порт із pw-calc src/lib/doll/summary.ts: змінено лише імпорт. Обчислення +
// форматування значень; підсвітка змін — справа панелі. Порядок і числа — 1:1 з mypers.
// =========================================================

import { computeChar, type CharStats } from './engine';
import type { DollState } from './types';

export interface SummaryCell {
  label: string;
  val: string;
}

export interface SummaryResult {
  char: CharStats;
  cells: SummaryCell[]; // плоский список (пари ліва|права), порядок як у mypers
  attrPlus: { str: number; dex: number; vit: number; mag: number }; // бонус атрибутів від речей
}

/** Повний розрахунок зведення: char (рушій) + відформатовані клітинки + бонуси атрибутів. */
export function computeSummary(build: DollState, t: Record<string, number>, ib: Record<string, number>): SummaryResult {
  const char = computeChar(
    {
      cls: build.cls,
      level: build.level || 1,
      str: build.str,
      dex: build.dex,
      vit: build.vit,
      mag: build.mag,
      weaponIr: typeof build.equipped.ta?.ir === 'string' ? build.equipped.ta.ir : undefined,
    },
    t,
    ib,
  );
  const c = char;
  const f = (n: number) => Math.round(n).toLocaleString('uk');
  const rng = (rr: { min: number; max: number }) => f(rr.min) + '–' + f(rr.max);
  const ELEM_LABEL: Record<string, string> = { lw: 'Метал', mo: 'Дерево', dn: 'Вода', vt: 'Вогонь', sp: 'Земля' };
  const cell = (label: string, val: string): SummaryCell => ({ label, val });
  const elemCell = (k: string) => {
    const e = c.elem[k];
    return cell(ELEM_LABEL[k], f(e.def) + ' (−' + e.perc.toFixed(1) + '%)');
  };

  // Зведене значення стата: спорядження (t) + бафи (ib).
  const g = (...keys: string[]): number => keys.reduce((s, k) => s + (t[k] || 0) + (ib[k] || 0), 0);
  const critDmg = 200 + g('gs_crit_rage_ghk'); // база 200% + бонуси крит. урону
  const atkLvl = g('ad', 'gs_ad'); // рівень атаки (спорядження + бафи)
  const defLvl = g('sx', 'gs_sx'); // рівень захисту
  const physPen = g('pec', 'zjz'); // фіз. пробивання %
  const magPen = g('kdn', 'xwp'); // маг. пробивання %
  const physDmgRed = g('bu', 'zen'); // зменш. фіз. урону %
  const magDmgRed = g('ia', 'sfy'); // зменш. маг. урону %
  const channel = g('ci') - g('re') + g('xj'); // час співу % (re швидше, xj повільніше)
  const spirit = g('mr', 'vln'); // бойовий дух
  const soulforce = g('mk'); // сила духу
  const mobDmg = g('su', 'qgc'); // урон монстрам
  const mobDef = g('wz', 'wkl'); // захист від монстрів
  const hpRec = g('cx', 'bl'); // віднов. HP/сек
  const mpRec = g('mp_recovery', 'vl'); // віднов. MP/сек
  const pct = (n: number) => (n > 0 ? '+' : '') + f(n) + '%';
  // Пари рядків «ліва | права» — порядок 1:1 з таблицею mypers (+ HP/MP зверху).
  const pairs: SummaryCell[][] = [
    [cell('Здоровʼя', f(c.hp)), cell('Мана', f(c.mp))],
    [cell('Віднов. HP/сек', f(hpRec)), cell('Віднов. MP/сек', f(mpRec))],
    [cell('Фіз. атака', rng(c.physAtk)), cell('Фіз. захист', f(c.physDef) + ' (−' + c.physDefPerc.toFixed(1) + '%)')],
    [cell('Маг. атака', rng(c.magAtk)), cell('Маг. захист (сер.)', f(c.magDef) + ' (−' + c.magDefPerc.toFixed(1) + '%)')],
    [cell('Шанс криту', c.crit + '%'), elemCell('lw')],
    [cell('Атак/сек', c.aps ? c.aps.toFixed(2) : '—'), elemCell('mo')],
    // Час співу — з мінусом: додатне значення СКОРОЧУЄ час активації
    [cell('Час співу', (channel > 0 ? '−' : channel < 0 ? '+' : '') + f(Math.abs(channel)) + '%'), elemCell('dn')],
    [cell('Міткість', f(c.acc)), elemCell('vt')],
    [cell('Ухилення', f(c.eva)), elemCell('sp')],
    [cell('Рівень атаки', f(atkLvl)), cell('Рівень захисту', f(defLvl))],
    [cell('Зменш. фіз. урону', pct(physDmgRed)), cell('Зменш. маг. урону', pct(magDmgRed))],
    [cell('Швидкість', c.speed.toFixed(1) + ' м/с'), cell('Крит. урон', critDmg + '%')],
    [cell('Бойовий дух', f(spirit)), cell('Сила духу', f(soulforce))],
    [cell('Скритність', f(c.stealth)), cell('Виявлення', f(c.detect))],
    [cell('Урон монстрам', f(mobDmg)), cell('Захист від монстрів', f(mobDef))],
    [cell('Фіз. пробивання', pct(physPen)), cell('Маг. пробивання', pct(magPen))],
  ];
  return {
    char,
    cells: pairs.flat(),
    attrPlus: { str: t.om || 0, dex: t.uy || 0, vit: t.lf || 0, mag: t.tx || 0 },
  };
}
