// =========================================================
// ЛЯЛЬКА — «сила» персонажа для скору з ляльки: два числа, Атака і
// Живучість, з формул ядра (без бафів, Головний комплект).
//
//   Атака = середня атака (фіз. для фізиків, маг. для магів)
//           × крит (шанс × надлишок крит. урону)
//           × швидкість (атак/с у фізиків; у магів — 1 / (1 − скорочення співу))
//           × множник рівня атаки: мій ПА проти ПЗ типового суперника.
//   Живучість = HP ÷ частка шкоди, що проходить (фіз. і маг. зріз, середнє
//               геометричне) ÷ множник рівня атаки типового суперника (його
//               ПА проти мого ПЗ).
//
// Самі числа нічого не значать — у бали їх переводить порівняння з еталоном
// класу (gearRules.dollScore): удвічі сильніший за еталон дає фіксовану
// кількість балів понад еталон.
// =========================================================

import { isPhysClass } from '../../data/gearRules';
import type { DollPower } from '../../data/types';
import { deriveIb } from '../core/buffs';
import { atkLevelMult } from '../core/damage';
import { computeStats, flattenItemStats } from '../core/stats';
import { computeSummary } from '../core/summary';
import { DOLL_ENGINE_VER } from '../core/version';
import type { CharacterDoc } from './doc';
import { CFG_MAIN, hydrate, toDollState, type ItemLookup } from './hydrate';
import { CLS_CHAR } from './sheet';

/** Типовий суперник для множника рівня атаки/захисту. */
export interface PowerOpponent {
  pa: number;
  pz: number;
}

const MAX_CHANNEL = 80; // скорочення співу понад це — артефакт даних, а не реальна швидкість

/** Атака й живучість персонажа (Головний, без бафів). Каталоги й довідники мають бути завантажені. */
export function powerOf(doc: CharacterDoc, opp: PowerOpponent, lookup?: ItemLookup): DollPower {
  const build = toDollState(hydrate(doc, lookup), CFG_MAIN, { fillFromMain: true });
  const t = computeStats(build).t;
  const c = computeSummary(build, t, deriveIb(build)).char; // у стані лише пасивки класу
  const g = (...keys: string[]): number => keys.reduce((s, k) => s + (t[k] || 0), 0);
  const pa = g('ad', 'gs_ad');
  const pz = g('sx', 'gs_sx');
  const physical = isPhysClass(CLS_CHAR[doc.cls]);

  const atk = physical ? (c.physAtk.min + c.physAtk.max) / 2 : (c.magAtk.min + c.magAtk.max) / 2;
  const critDmg = 200 + g('gs_crit_rage_ghk');
  const crit = Math.max(0, Math.min(100, c.crit)) / 100;
  const critF = 1 + (crit * (critDmg - 100)) / 100;
  const channel = Math.max(0, Math.min(MAX_CHANNEL, g('ci') - g('re') + g('xj')));
  const speed = physical ? Math.max(0.5, c.aps || 0) : 1 / (1 - channel / 100);
  // ПА основної зброї рахується окремо (за курсом ПА-каменів) — з атаки її прибираємо.
  const w = build.equipped.ta;
  const wRows = w ? [...(build.addons.ta?.length ? build.addons.ta : flattenItemStats(w)), ...(build.engrave.ta ?? [])] : [];
  const wpa = wRows.reduce((s, r) => s + (r.type === 'ad' ? Number(r.val) || 0 : 0), 0);
  const off = Math.max(1, atk) * critF * speed * atkLevelMult(pa - wpa, opp.pz);

  const pass = (perc: number) => Math.max(0.05, 1 - perc / 100);
  const ehp = c.hp / Math.sqrt(pass(c.physDefPerc) * pass(c.magDefPerc));
  const def = ehp / atkLevelMult(opp.pa, pz);

  const ac = (build.equipped.ta as { ac?: unknown } | undefined)?.ac;
  const abil = typeof ac === 'string' && ac ? ac : undefined;
  return { off: Math.round(off), def: Math.round(def), pa: Math.round(pa), pz: Math.round(pz), engine: DOLL_ENGINE_VER, wpa: Math.round(wpa), ...(abil ? { abil } : {}) };
}
