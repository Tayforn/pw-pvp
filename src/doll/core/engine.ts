// =========================================================
// ЛЯЛЬКА — рушій характеристик (формули PW, реверс із mypers `sd`).
// Порт із pw-calc src/modules/doll/engine.ts: змінено лише імпорт.
// =========================================================
// База від класу/рівня/атрибутів + внесок спорядження (тотали t зі stats.ts)
// + бафи/дебафи через ib (порожній = без станів).

import { HP_VIT, MP_MAG, ACC_DEX, EVA_DEX, SPEED_BASE, XZ, DEX_WEAPONS, ELEM } from './constants';

export interface Range {
  min: number;
  max: number;
}
export interface ElemDef {
  def: number;
  perc: number;
}
export interface CharStats {
  hp: number;
  mp: number;
  physAtk: Range;
  magAtk: Range;
  physDef: number;
  physDefPerc: number;
  magDef: number; // середня по 5 стихіях
  magDefPerc: number;
  elem: Record<string, ElemDef>; // lw/mo/dn/vt/sp
  acc: number;
  eva: number;
  crit: number; // %
  speed: number; // швидкість руху, м/с (база класу + речі + бафи, кап 15)
  aps: number; // атак/сек (0 = без зброї)
  stealth: number; // скритність (0 без бафа uu; з бафом — рівень + uu)
  detect: number; // виявлення (рівень + баф uu_detect)
  attr: { str: number; vit: number; dex: number; mag: number }; // ефективні
}

export interface CharInput {
  cls: string;
  level: number;
  str: number;
  dex: number;
  vit: number;
  mag: number;
  weaponIr?: string; // тип зброї (ir) для вибору атрибута фіз. атаки
}

const r = Math.round;

/** Базова інтерполяція mypers (стати від атрибутів+рівня). */
function ts(t: number, i: number, s: number, e: number[]): number {
  return r((i + s - e[1]) / e[2]) + r(t * (e[3] + r((e[1] * i + e[4] * s) / e[5]) / e[6])) + e[0];
}

/** % зрізання урону від захисту: def/(40×рівень + def − 25), кап 95%. */
export function defPerc(def: number, level: number): number {
  const d = 40 * level + def - 25;
  if (d <= 0) return 0;
  return Math.min(95, (def / d) * 100);
}

/** Per-level фактор атаки (nm) за sm та атрибутом. */
function nm(attr: 'om' | 'uy' | 'tx', sm: number): number {
  if (attr === 'tx') {
    if (sm === 4) return 0.6;
    if ([1, 3, 6, 7, 9, 11].includes(sm)) return 0.0095;
    return 1;
  }
  if (sm === 4) return 0.6;
  if ([2, 5, 8, 10, 12].includes(sm)) return 0.21;
  return 1;
}

/** Бонус маг. атаки (ua) для маг-класів. */
function uaTx(sm: number, vuTx: number): number {
  return [2, 5, 8, 10, 12].includes(sm) ? r(vuTx / 1720) : 0;
}

type Totals = Record<string, number>;

export function computeChar(inp: CharInput, t: Totals, buffs: Record<string, number> = {}): CharStats {
  const bf = (k: string): number => buffs[k] || 0;
  const cls = inp.cls;
  const hf = inp.level || 1;
  const sm = XZ[cls] || 1;
  // Атрибути = база + спорядження (як vu у mypers: без бафів).
  const vu = {
    om: inp.str + (t.om || 0),
    uy: inp.dex + (t.uy || 0),
    lf: inp.vit + (t.lf || 0),
    tx: inp.mag + (t.tx || 0),
  };

  // HP/MP: коеф×(атрибут + 2×(рів−1)) + flat; потім % (стат co/cc речей + бафи fw/eh, vd/ef).
  const hpBase = (HP_VIT[cls] ?? 13) * (vu.lf + 2 * (hf - 1)) + (t.hp || 0);
  const hpPct = (t.co || 0) + bf('fw') - bf('eh');
  const mpBase = (MP_MAG[cls] ?? 11) * (vu.tx + 2 * (hf - 1)) + (t.mp || 0);
  const mpPct = (t.cc || 0) + bf('vd') - bf('ef');

  // Міткість/ухилення (mypers ev/yp): flat зі споряди (+gs_ae баф), % — допи _eg + бафи.
  const acc =
    ((ACC_DEX[cls] ?? 8) * vu.uy + (t.ae || 0) + bf('gs_ae')) *
    (1 + ((t.ae_eg || 0) + bf('bx') - bf('yr')) / 100);
  const eva = ((EVA_DEX[cls] ?? 6) * vu.uy + (t.qe || 0)) * (1 + ((t.qe_eg || 0) + bf('br') - bf('na')) / 100);
  // Крит: 1 + ⌊Спритн/20⌋ + допи + бафи, кап 100 (як mypers kp).
  const crit = Math.min(100, 1 + Math.floor(vu.uy / 20) + (t.ed || 0) + bf('jk'));

  // Швидкість руху, м/с (mypers gy): база класу + gs_cl, ×(1 + (cl_eg + ln − la)/100),
  // потім flat cl від речей; кап 15.
  let speed = (SPEED_BASE[cls] ?? 5) + bf('gs_cl');
  speed += (speed / 100) * ((t.cl_eg || 0) + bf('ln') - bf('la'));
  speed += t.cl || 0;
  if (speed > 15) speed = 15;

  // Атак/сек (mypers zi): інтервал = 1/sy − Σxn (мін 0.2 сек), ±% швидкості атаки (wh/gn),
  // квантування до 0.05 сек; кап 5 атак/сек. Без зброї (sy=0) — 0.
  let aps = 0;
  if (t.sy) {
    let s = Number((1 / t.sy).toFixed(2));
    const xn = t.xn || 0;
    if (xn >= s) s = 0.2;
    else s -= xn;
    const spd = bf('wh') - bf('gn');
    if (spd) s *= 1 - spd / 100;
    s = 0.05 * r(s / 0.05);
    aps = s > 0 ? Math.min(5, 1 / s) : 5;
  }

  // Скритність (mypers lv) / виявлення (mypers bn): від рівня і бафів uu / uu_detect.
  const stealth = bf('uu') ? hf + bf('uu') : buffs.pka ? hf + 1 : 0;
  const detect = hf + bf('uu_detect');

  // Фіз. атака (mypers rl): множник e = nl(атрибут) + hd (%-бафи yh/xp + за типом зброї),
  // плоскі бафи gs_oi_av додаються ДО множення.
  const pAttr: 'om' | 'uy' = DEX_WEAPONS.has(inp.weaponIr || '') ? 'uy' : 'om';
  const physPct = bf('yh') - bf('xp') + (inp.weaponIr ? bf('gs_oi_' + inp.weaponIr + '_av_eg') : 0);
  const pi = (t.ld_min || 0) + bf('gs_oi_av');
  const ps = (t.ld_max || 0) + (t.max_oi_av || 0) + bf('gs_oi_av');
  const pe = vu[pAttr] / 100 + 1 + physPct / 100;
  const pa = nm(pAttr, sm);
  const pl = r(vu[pAttr] / 3);
  const physAtk: Range = {
    min: r(pi * pe + r(hf * pa) * pe - ((pi + r(hf * pa)) / 100) * pl) || 1,
    max: r(ps * pe + r(hf * pa) * pe - ((ps + r(hf * pa)) / 100) * pl) || 1,
  };

  // Маг. атака (mypers gl): множник a = nl(tx) + hd (%-бафи sq/so), плоскі gs_xq — до множення.
  const magPct = bf('sq') - bf('so');
  const mi = (t.xq_min || 0) + bf('gs_xq');
  const ms = (t.xq_max || 0) + (t.max_xq || 0) + bf('gs_xq');
  const ma = vu.tx / 100 + 1 + magPct / 100;
  const me = nm('tx', sm);
  const mn = uaTx(sm, vu.tx);
  const magAtk: Range = {
    min: r(ma * mi) + r(r(hf * me) * ma + mn) || 1,
    max: r(ma * ms) + r(r(hf * me) * ma + mn) || 1,
  };

  // Фіз. захист (mypers qv): ts(ЗАХИСТ СПОРЯДИ, Тіло, Сила, коеф) — тобто захист речей
  // масштабується бонусом від атрибутів; %-бафи (tb/od/−va) — як частка захисту речей.
  const gearWf = t.wf || 0;
  const pdPct = (t.wf_eg || 0) + bf('tb') + bf('od') - bf('va'); // wf_eg — «+% фіз. захисту» з допів речей
  let physDef = ts(gearWf, vu.lf, vu.om, [1, 2, 4, 1, 3, 25, 100]) + r((gearWf / 100) * pdPct);
  if (physDef < 0) physDef = 0;
  if (bf('va') >= 1000) physDef = 0; // дебаф «захист у 0»
  const physDefPerc = bf('va') >= 1000 ? 0 : defPerc(physDef, hf);

  // Маг. захист (mypers dd): per-element ts(захист споряди, Тіло, Інт, коеф) + %-бафи
  // (og/xk/−pt + стихійні gs_<el>_gq_eg / vh_<el>_gq_eg) як частка захисту речей.
  const elem: Record<string, ElemDef> = {};
  let magSum = 0;
  for (const eKey of ELEM) {
    const short = eKey.replace('_eq', ''); // lw/mo/dn/vt/sp
    const gearE = t[eKey] || 0;
    const pctE =
      (t.ab_gq_eg || 0) + bf('og') + bf('xk') - bf('pt') + bf('gs_' + short + '_gq_eg') - bf('vh_' + short + '_gq_eg');
    let def = ts(gearE, vu.lf, vu.tx, [0, 2, 4, 1, 3, 25, 100]) + r((gearE / 100) * pctE);
    if (def < 0) def = 0;
    elem[short] = { def, perc: defPerc(def, hf) };
    magSum += def;
  }
  const magDef = r(magSum / 5);

  return {
    hp: r(hpBase * (1 + hpPct / 100)),
    mp: r(mpBase * (1 + mpPct / 100)),
    physAtk,
    magAtk,
    physDef,
    physDefPerc,
    magDef,
    magDefPerc: defPerc(magDef, hf),
    elem,
    acc: r(acc),
    eva: r(eva),
    crit,
    speed: Number(speed.toFixed(1)),
    aps: Number(aps.toFixed(2)),
    stealth: r(stealth),
    detect: r(detect),
    attr: { str: vu.om, vit: vu.lf, dex: vu.uy, mag: vu.tx },
  };
}
