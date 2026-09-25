// =========================================================
// ЛЯЛЬКА — модель тултіпа речі/бафа: лише текст і вид рядка, без HTML.
// Порт statLines/itemNameHtml/itemTipHtml із pw-calc src/lib/doll/tooltip.ts
// і buffTipHtml із lib/doll/buffs.ts: кожен HTML-блок став рядком {kind, text},
// а рендер (React-вузли) — справа ui/tip. Тексти й порядок рядків 1:1 з
// Хелпером — це звіряє tip.golden.test.ts.
// =========================================================

import { CLASS_BY_SM, ELEM, buffDesc, buffEffects, buffMaxLevel, buffVal, lbl } from '../core/constants';
import { buffCfgRead } from '../core/buffs';
import { getSets } from '../core/refdata';
import {
  aggregateStats, classRestriction, computeActiveSlots, flattenItemStats, gemDop, meetsReq, refineBonuses, setPieceCount,
} from '../core/stats';
import type { BuffDef, DollState, Item, TipCtx } from '../core/types';
import { SLOT_CAT, isSlotKey } from './doc';

export interface TipLine {
  kind: 'type' | 'base' | 'req' | 'add' | 'abil' | 'ref' | 'gem' | 'wdf' | 'eng' | 'sep' | 'set' | 'setp' | 'setb' | 'title';
  text: string;
  ok?: boolean; // req: вимогу виконано
  on?: boolean; // setp/setb: деталь надіта / бонус активний
}

export interface TipModel {
  name: string; // зірки + назва (без «+N»)
  grade: number; // клас кольору gx-N
  stars: number;
  refine: number; // «+N» заточки, 0 = нема
  lines: TipLine[];
}

// Підписи кодів стат (для допів, бонусів сетів, редактора).
export const CODE_LABEL: Record<string, string> = {
  hp: 'Здоровʼя', mp: 'Мана', om: 'Сила', lf: 'Тілобудова', uy: 'Спритність', tx: 'Інтелект',
  wf: 'Фіз. захист', ab_gq: 'Маг. захист', ld: 'Фіз. атака', xq: 'Маг. атака',
  ad: 'Рівень атаки', sx: 'Рівень захисту', ae: 'Міткість', qe: 'Ухилення', cl: 'Швидкість',
  ci: 'Час співу', mr: 'Бойовий дух', mk: 'Сила духу', ed: 'Шанс криту', wz: 'Захист від монстрів',
  su: 'Урон монстрам', bu: 'Зменш. фіз. урону', ia: 'Зменш. маг. урону', pec: 'Фіз. пробивання', kdn: 'Маг. пробивання',
  lw_eq: 'Захист: метал', mo_eq: 'Захист: дерево', dn_eq: 'Захист: вода', vt_eq: 'Захист: вогонь', sp_eq: 'Захист: земля',
  co: 'Макс. HP', cc: 'Макс. MP', cp: 'Міцність', exp: 'Досвід', jk: 'Шанс криту',
  ae_eg: 'Міткість', qe_eg: 'Ухилення', wf_eg: 'Фіз. захист', ab_gq_eg: 'Маг. захист', cl_eg: 'Швидкість',
  cx: 'Віднов. HP', mp_recovery: 'Віднов. MP', max_oi_av: 'Макс. фіз. атака', max_xq: 'Макс. маг. атака',
  bonus_hf: 'Бонус рівня', mana: 'Мана', sy: 'Атак/сек', fp: 'Дальність', xn: 'Пауза між атаками', vln: 'Бойовий дух',
  ct: 'Вимоги по талантах', // «Требование по талантам −N%» — display-only, як у mypers
  ld_min: 'Фіз. атака (мін)', ld_max: 'Фіз. атака (макс)', xq_min: 'Маг. атака (мін)', xq_max: 'Маг. атака (макс)',
};
export const codeLabel = (c: string): string => CODE_LABEL[c] || c;

// Коди-відсотки та коди зі знаком «−» (для відображення допів у тултіпі).
const PCT_CODES = new Set(['ed', 'bu', 'ia', 'exp', 'co', 'cc', 'cp', 'jk', 'ae_eg', 'qe_eg', 'wf_eg', 'ab_gq_eg', 'cl_eg', 'ct']);
const MINUS_CODES = new Set(['ci', 'ct', 'xn']);
export function propLine(code: string, val: unknown): string {
  let sign = MINUS_CODES.has(code) ? '−' : '+';
  let v: unknown = val;
  const n = Number(val);
  if (Number.isFinite(n) && n < 0) {
    // відʼємне значення обертає знак (напр. ct:-10 → «+10%»)
    sign = sign === '−' ? '+' : '−';
    v = Math.abs(n);
  }
  const suf = PCT_CODES.has(code) ? '%' : code === 'xn' ? ' сек' : '';
  return codeLabel(code) + ' ' + sign + v + suf;
}

/** Розбір грейду предмета з поля tv → {tier (колір gx-N), stars} — точно як у mypers (we). */
export function itemGrade(it: Item, cat = ''): { tier: number; stars: number } {
  const tv = (it as Record<string, unknown>).tv;
  if (tv == null || tv === '') {
    // Книги без tv: 2☆ на рівнях 5–9, інакше 3☆ (mypers we, гілка qn).
    if (cat === 'qn') return { tier: 0, stars: Number(it.hf) >= 5 && Number(it.hf) <= 9 ? 2 : 3 };
    return { tier: 0, stars: 0 };
  }
  const c = String(tv).split('');
  let tier: number;
  let stars: number;
  if (c.length === 1) {
    tier = 0;
    stars = Number(c[0]);
  } else if (c.length === 3) {
    tier = Number(c[0] + c[1]);
    stars = Number(c[2]);
  } else {
    tier = Number(c[0]);
    stars = Number(c[1]);
  }
  if (stars === 2 && tier === 0) tier = 1;
  return { tier, stars };
}

/** Назва з зірками — текст рядка назви (як itemNameHtml без тегів). Зайві пробіли
 * всередині назви (у каталозі трапляються «(ж      )») стискаються, як їх стискав би HTML. */
export function itemDisplayName(it: Item, cat = ''): string {
  const { stars } = itemGrade(it, cat);
  return ((stars > 0 ? '☆'.repeat(stars) + ' ' : '') + String(it.name ?? '')).replace(/\s+/g, ' ').trim();
}

type Wu = { wu?: Array<{ type?: string; val?: unknown }> } | undefined;
const fmtNum = (v: unknown): string => Number(v).toLocaleString('uk');

/**
 * Тіло тултіпа речі. build = null (річ у пікері без персонажа): вимоги не
 * позначаються червоними, а комплект показується без надітих деталей.
 */
export function buildTipModel(item: Item, cat: string, ctx: TipCtx = {}, build: DollState | null = null): TipModel {
  const it = item;
  const o = it as Record<string, unknown>;
  const lines: TipLine[] = [];
  const push = (kind: TipLine['kind'], text: string, extra: Partial<TipLine> = {}) => lines.push({ kind, text, ...extra });
  // Зброя — діапазон «мін–макс», біжутерія/пояси/боєприпаси/томи — плоский бонус «+N».
  const range = (v: unknown) => (Array.isArray(v) ? fmtNum(v[0]) + '–' + fmtNum(v[1]) : '+' + fmtNum(v));

  if (it.hf != null) push('title', 'ур. ' + it.hf);
  // тип (модель) + рівень
  const typeLbl = it.pg ? lbl('pg', it.pg as string | number) : '';
  if (typeLbl) push('type', typeLbl);
  if (it.hf != null) push('base', 'Рівень ' + it.hf);
  // базові стати
  if (it.ld) push('base', 'Фіз. атака: ' + range(it.ld));
  if (it.xq) push('base', 'Маг. атака: ' + range(it.xq));
  if (it.sy) push('base', 'Атак/сек: ' + it.sy);
  if (typeof o.fp === 'number' && o.fp) push('base', 'Дальність: ' + o.fp + ' м');
  if (o.cu != null && o.cu !== '') push('base', 'Звичайний політ: ' + String(o.cu));
  if (o.cwr != null && o.cwr !== '') push('base', 'Прискорений політ: ' + String(o.cwr));
  if (Array.isArray(o.ta_hf)) push('base', 'Рівень зброї: ' + o.ta_hf[0] + '–' + o.ta_hf[1]);
  if (typeof it.wf === 'number' && it.wf) push('base', 'Фіз. захист +' + it.wf);
  const ab = it.ab_gq;
  if (typeof ab === 'number' && ab) push('base', 'Маг. захист +' + ab);
  else if (ab && typeof ab === 'object') {
    const e = ab as Record<string, number>;
    const vals = ELEM.map((k) => e[k] || 0);
    if (vals.every((v) => v === vals[0])) push('base', 'Захист від стихій +' + vals[0]);
    else for (const k of ELEM) if (e[k]) push('base', codeLabel(k) + ' +' + e[k]);
  }
  if (typeof it.hp === 'number' && it.hp) push('base', 'Здоровʼя +' + it.hp);
  if (typeof o.mana === 'number' && o.mana) push('base', 'Мана +' + o.mana);
  if (typeof it.qe === 'number' && it.qe) push('base', 'Ухилення +' + it.qe);
  // Камінь (ob): бонуси з obDops — [0] діє у зброї, [1] у броні/біжутерії.
  if (Array.isArray(o.obDops)) {
    const dops = o.obDops as unknown[];
    const d0 = Array.isArray(dops[0]) ? propLine(String(dops[0][0]), dops[0][1]) : '';
    const d1 = Array.isArray(dops[1]) ? propLine(String(dops[1][0]), dops[1][1]) : '';
    if (d0 && d0 === d1) push('add', d0);
    else {
      if (d0) push('add', 'У зброї: ' + d0);
      if (d1) push('add', 'В інших речах: ' + d1);
    }
  }

  // Вимоги (червоним — якщо не виконано); порядок як у mypers — після базових стат.
  // gearAttr — бонуси атрибутів від активних речей (як computeStats().gearAttr).
  let active: Set<string> | null = null;
  let gearAttr: Record<string, number> = {};
  if (build) {
    active = computeActiveSlots(build);
    const t = aggregateStats(build, active);
    gearAttr = { om: t.om || 0, uy: t.uy || 0, lf: t.lf || 0, tx: t.tx || 0 };
  }
  const req = build ? meetsReq(build, it, gearAttr) : { ok: true, lvl: true, str: true, dex: true, mag: true, cls: true };
  if (Number(it.oj)) push('req', 'Потрібний рівень: ' + it.oj, { ok: req.lvl });
  if (Number(it.om_uo)) push('req', 'Потрібна сила: ' + it.om_uo, { ok: req.str });
  if (Number(it.uy_uo)) push('req', 'Потрібна спритність: ' + it.uy_uo, { ok: req.dex });
  if (Number(o.tx_uo)) push('req', 'Потрібний інтелект: ' + o.tx_uo, { ok: req.mag });
  if (Number(o.reputa_uo)) push('req', 'Потрібна репутація: ' + fmtNum(o.reputa_uo), { ok: true });
  const cr = classRestriction(it);
  if (cr) push('req', 'Клас: ' + cr.map((n) => CLASS_BY_SM[n] || n).join(', '), { ok: req.cls });

  // Фіксовані допи (nw.wu) — підсвічені, після вимог (як у mypers).
  const nw = it.nw as Wu;
  if (nw && Array.isArray(nw.wu)) for (const w of nw.wu) if (w && w.type) push('add', propLine(w.type, w.val));
  // Додані вручну характеристики: показуємо ті, що йдуть ПОНАД базові стати речі
  // (flattenItemStats: базові поля + nw.wu — вони вже відмальовані вище).
  if (ctx.addons?.length) {
    const baseCounts = new Map<string, number>();
    for (const a of flattenItemStats(it)) baseCounts.set(a.type + '|' + a.val, (baseCounts.get(a.type + '|' + a.val) || 0) + 1);
    for (const a of ctx.addons) {
      if (!a || !a.type) continue;
      const k = a.type + '|' + a.val;
      const c = baseCounts.get(k) || 0;
      if (c > 0) baseCounts.set(k, c - 1); // це базова стата — вже показана
      else push('add', propLine(a.type, a.val));
    }
  }
  // абілка
  if (it.ac) push('abil', '⚔ ' + lbl('taAddons', it.ac as string));
  // Заточка й камені надітої речі — стан конкретного екземпляра.
  if (ctx.refine) {
    for (const b of refineBonuses(it, ctx.refine, !!ctx.isBook)) push('ref', 'Заточка +' + ctx.refine + ': ' + propLine(b.type, b.val));
  }
  if (ctx.gems) {
    for (const g of ctx.gems) {
      if (!g) continue;
      const dop = gemDop(g, !!ctx.isWeapon);
      push('gem', '◆ ' + g.name + (dop ? ' — ' + propLine(dop[0], dop[1]) : ''));
    }
  }

  // Шліфовка (руна) і кристал зброї: імʼя + стати з nw.wu.
  const specialLine = (sp: Item | null | undefined, ico: string, label: string) => {
    if (!sp) return;
    const wu = (sp.nw as Wu)?.wu || [];
    const stats = wu.filter((w) => w && w.type).map((w) => propLine(String(w.type), w.val)).join(', ');
    push('wdf', ico + ' ' + label + ': ' + sp.name + (stats ? ' — ' + stats : ''));
  };
  specialLine(ctx.wdf, '⛭', 'Шліфовка');
  specialLine(ctx.crystal, '❖', 'Кристал');
  // Гравіювання — окремий блок (як «гравировка:» у mypers).
  if (ctx.engrave?.length) {
    push('sep', '');
    push('type', 'Гравіювання:');
    for (const a of ctx.engrave) if (a && a.type) push('eng', propLine(a.type, a.val));
  }

  // Комплект (сет): назва (маю/всього), список речей із наявністю, бонуси з підсвіткою активних.
  if (o.ps != null) {
    const sd = getSets();
    const set = sd ? sd[String(o.ps)] : null;
    if (set) {
      let have = 0;
      const worn = new Set<string>(); // категорія:id надітих (активних) речей — для позначення наявних деталей
      if (build && active) {
        have = setPieceCount(build, active)[String(o.ps)] || 0;
        for (const slot of active) {
          const eq = build.equipped[slot];
          const c = isSlotKey(slot) ? SLOT_CAT[slot] : '';
          if (eq) worn.add(c + ':' + eq.id);
        }
      }
      const total = set.pieces || set.xh?.length || 0;
      push('sep', '');
      push('set', set.name + ' (' + have + '/' + total + ')');
      for (const p of set.xh || []) {
        const has = worn.has(p.qo + ':' + p.id);
        push('setp', (has ? '✓ ' : '· ') + p.name, { on: has });
      }
      for (const k of Object.keys(set.zn).map(Number).sort((a, b) => a - b)) {
        const b = set.zn[String(k)];
        push('setb', k + ' дет.: ' + propLine(b.type, b.val), { on: k <= have });
      }
    }
  }

  const { tier, stars } = itemGrade(it, cat);
  return { name: itemDisplayName(it, cat), grade: tier, stars, refine: ctx.refine || 0, lines };
}

/** Тултіп бафа: параметри на поточному рівні/стороні + опис ефектів (останній рядок). */
export function buildBuffTipModel(build: DollState, b: BuffDef): { name: string; lines: string[] } {
  const c = buffCfgRead(build, b.id);
  const lvl = Math.min(buffMaxLevel(b), c.lvl); // ефективний рівень (з капом)
  // Параметри масштабуються за рівнем/стороною (формула mypers hs).
  const p = (k: string) => (b.lm[k] != null || b.qc[k] != null ? buffVal(b, k, lvl, c.side) : undefined);
  const lines: string[] = ['Рівень: ' + lvl];
  if (p('oj_for_fu') != null) lines.push('Потрібний рівень: ' + p('oj_for_fu'));
  if (p('ve') != null) lines.push('Дальність: ' + p('ve') + ' м');
  if (p('mp') != null) lines.push('Маг. енергія: ' + p('mp'));
  if (p('channel') != null) lines.push('Час активації: ' + p('channel') + ' сек');
  if (p('vy') != null) lines.push('Призивання: ' + p('vy') + ' сек');
  if (p('vw') != null) lines.push('Перезарядка: ' + p('vw') + ' сек');
  const desc = buffEffects(b, lvl, c.side)
    .filter((e) => e.val)
    .map((e) => buffDesc(e.type, e.val))
    .join('. ');
  if (desc) lines.push(desc);
  return { name: b.name, lines };
}
