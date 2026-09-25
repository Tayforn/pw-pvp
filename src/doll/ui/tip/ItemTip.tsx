// =========================================================
// ЛЯЛЬКА — тіло тултіпа речі. Модель (model/tipModel.ts) дає рядки {kind, text},
// тут кожен kind стає класом .doll-tip-* з тими самими кольорами, що в Хелпері:
// допи блакитні, гравіювання бірюзове, шліфовка фіолетова, вимоги червоні,
// коли не виконані. Жодного HTML у рядках — текст іде текстовими вузлами.
// =========================================================

import type { DollState, Item, TipCtx } from '../../core/types';
import type { HydratedInst } from '../../model/hydrate';
import { instStats } from '../../model/hydrate';
import { buildTipModel, type TipLine, type TipModel } from '../../model/tipModel';
import { GradeName } from './ItemName';
import type { TipContent } from './useTip';

const KIND_CLASS: Record<TipLine['kind'], string> = {
  title: 'doll-tip-lvl',
  type: 'doll-tip-type',
  base: 'doll-tip-base',
  req: 'doll-tip-req',
  add: 'doll-tip-add',
  abil: 'doll-tip-abil',
  ref: 'doll-tip-ref',
  gem: 'doll-tip-gem',
  wdf: 'doll-tip-wdf',
  eng: 'doll-tip-eng',
  sep: 'doll-tip-sep',
  set: 'doll-tip-set',
  setp: 'doll-tip-setp',
  setb: 'doll-tip-setb',
};

function lineClass(l: TipLine): string {
  let c = KIND_CLASS[l.kind] || 'doll-tip-base';
  if (l.kind === 'req' && l.ok === false) c += ' bad';
  if ((l.kind === 'setp' || l.kind === 'setb') && l.on) c += ' on';
  return c;
}

export function ItemTip({ model }: { model: TipModel }) {
  return (
    <div className="doll-tip-item">
      <div className="doll-tip-name">
        <GradeName name={model.name} grade={model.grade} refine={model.refine} />
      </div>
      {model.lines.map((l, i) =>
        l.kind === 'sep' ? <div className="doll-tip-sep" key={i} /> : <div className={lineClass(l)} key={i}>{l.text}</div>,
      )}
    </div>
  );
}

/** Контекст тултіпа для екземпляра з документа — як slotTipCtx у Хелпері,
 * але з гідрованої речі (камені/руна вже речі каталогу, стати — ефективні). */
export function instTipCtx(h: HydratedInst): TipCtx {
  const cat = h.inst.cat;
  return {
    gems: h.gems,
    refine: h.inst.r || 0,
    isBook: cat === 'qn',
    isWeapon: cat === 'ta',
    engrave: (h.inst.e || []).map((r) => ({ type: r.t, val: r.v })),
    addons: instStats(h),
    wdf: h.wdf,
    crystal: h.crystal,
  };
}

/** Вміст тултіпа для екземпляра (null-річ → короткий текст замість моделі). */
export function instTipContent(h: HydratedInst, build: DollState | null): TipContent {
  if (!h.item) return { kind: 'text', text: 'Невідома річ: у каталозі нема ' + h.inst.cat + ' #' + h.inst.id };
  return { kind: 'item', model: buildTipModel(h.item, h.inst.cat, instTipCtx(h), build) };
}

/** Вміст тултіпа для речі каталогу (пікер): без стану екземпляра. */
export function itemTipContent(item: Item, cat: string, build: DollState | null, ctx: TipCtx = {}): TipContent {
  return { kind: 'item', model: buildTipModel(item, cat, ctx, build) };
}
