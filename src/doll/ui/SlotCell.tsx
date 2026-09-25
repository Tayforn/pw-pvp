// =========================================================
// ЛЯЛЬКА — клітинка слота на фігурі: іконка, бейдж заточки, точки гнізд,
// маркери «ручні роли» і «не вдягається». Клік порожнього — пікер, надітого —
// редактор речі; ПКМ — меню; наведення — тултіп речі. На тачі тап по надітій
// речі — закріплений тултіп з описом і діями («Зняти / Редагувати / Копія /
// Обрати іншу»). Джинн і політ на вкладці сету — лише з Головного, їх тут не міняють.
//
// Спільні для слота й інвентаря дрібниці (назва, бейджі, фокус із клавіатури)
// живуть тут, а InventoryCell їх імпортує; вміст тултіпа речі дає tip/ItemTip.
// =========================================================

import { useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { SLOTS } from '../core/constants';
import type { DollState } from '../core/types';
import { ITEM_CELLS_URL, iconStyle } from '../data/assets';
import type { SlotKey } from '../model/doc';
import type { HydratedInst } from '../model/hydrate';
import { LIMIT_TEXT, duplicateInstance, unequip } from '../model/ops';
import { itemDisplayName, itemGrade } from '../model/tipModel';
import CellMenu, { COARSE_PTR, pointRect, type MenuItem } from './CellMenu';
import { useEditor } from './EditorContext';
import { slotDropKey, type DnD } from './hooks/useDnD';
import { isRestoringFocus } from './modals/ModalShell';
import { instTipContent } from './tip/ItemTip';
import { useTip, type TipAction, type TipContent } from './tip/useTip';

export const SLOT_LABEL: Record<string, string> = Object.fromEntries(SLOTS.map((s) => [s.slot, s.label]));

/** Позиції плейсхолдерів порожніх слотів у item-cells.png (як у mypers/Хелпері). */
const CELL_PH: Record<SlotKey, string> = {
  ft: '0 0', rv: '-32px 0', tg: '-64px 0', rx: '-96px 0', ta: '-128px 0',
  vx: '0 -32px', wy: '-32px -32px', mj: '-64px -32px', st: '-96px -32px', it: '-128px -32px', gv: '-160px -32px',
  cr: '0 -64px', cd: '-32px -64px', qn: '-64px -64px', pp: '-96px -64px', pk: '-128px -64px', ic: '-160px -96px',
};
function phStyle(slot: SlotKey): CSSProperties {
  return ITEM_CELLS_URL ? { backgroundImage: 'url("' + ITEM_CELLS_URL + '")', backgroundPosition: CELL_PH[slot] } : {};
}

/** Назва для меню/підказок (зірки + назва каталогу). */
export function instName(h: HydratedInst): string {
  return h.item ? itemDisplayName(h.item, h.inst.cat) : 'Невідома річ #' + h.inst.id;
}
export function instGrade(h: HydratedInst): number {
  return h.item ? itemGrade(h.item, h.inst.cat).tier : 0;
}

/** Колір бейджа «+N»: сходинки заточки, як їх читають гравці (до +3, +4…6, +7…9, +10…11, +12). */
export function refineTier(r: number): string {
  if (r >= 12) return 'r5';
  if (r >= 10) return 'r4';
  if (r >= 7) return 'r3';
  if (r >= 4) return 'r2';
  return 'r1';
}

/** Бейджі поверх іконки: заточка, гнізда, ручні роли. Спільні для слота й інвентаря. */
export function CellBadges({ h }: { h: HydratedInst }): ReactNode {
  const r = h.inst.r || 0;
  const manual = !!(h.inst.x && h.inst.x.length) || !!h.inst.xr;
  return (
    <>
      {r > 0 && <span className={'doll-badge-ref ' + refineTier(r)}>+{r}</span>}
      {h.gems.length > 0 && (
        <span className="doll-sock-dots" aria-hidden="true">
          {h.gems.map((g, i) => (
            <i key={i} className={g ? 'is-filled' : ''} />
          ))}
        </span>
      )}
      {manual && <span className="doll-badge-manual" title={h.inst.xr ? 'Стати речі замінено вручну' : 'Додано ручні роли'} />}
    </>
  );
}

/**
 * Фокус прийшов із клавіатури (Tab), а не від кліку мишею чи повернення фокусу
 * після закриття вікна: лише тоді клітинка показує тултіп на фокус. Інакше
 * тултіп лишався б висіти під курсором, що давно пішов деінде.
 */
export function isKeyboardFocus(el: HTMLElement): boolean {
  if (isRestoringFocus()) return false;
  try {
    return el.matches(':focus-visible');
  } catch {
    return true; // браузер без :focus-visible — як раніше
  }
}

interface Props {
  slot: SlotKey;
  h: HydratedInst | null;
  /** Джинн/політ на вкладці сету: показуємо з Головного, змінювати не можна. */
  inherited?: boolean;
  /** Річ не проходить вимоги (computeActiveSlots) — червона рамка. */
  bad?: boolean;
  dnd: DnD;
  build: DollState;
}

export default function SlotCell({ slot, h, inherited = false, bad = false, dnd, build }: Props) {
  const api = useEditor();
  const tip = useTip();
  const { activeCfg: cfgId, readOnly } = api;
  const gender = api.doc.gender;
  const [menuAt, setMenuAt] = useState<DOMRect | null>(null);
  // Тип останнього натискання: довгий тап на Android шле contextmenu — меню тоді не потрібне.
  const lastPointer = useRef('');
  const label = SLOT_LABEL[slot] || slot;

  const content = (): TipContent => {
    if (h) return instTipContent(h, build);
    if (inherited) return { kind: 'text', text: label + ' — порожньо в Головному; у сеті не міняється' };
    return { kind: 'text', text: label + (readOnly ? ' — порожньо' : ' — клікни, щоб обрати річ') };
  };

  const openMenu = (rect: DOMRect) => {
    tip.hideAll();
    setMenuAt(rect);
  };

  const menuItems: Array<MenuItem & TipAction> = h
    ? [
        { label: 'Зняти в інвентар', onClick: () => api.apply((d) => unequip(d, cfgId, slot)) },
        { label: 'Редагувати', onClick: () => api.openItemEditor(cfgId, h.inst.i) },
        {
          label: 'Копія',
          onClick: () =>
            api.apply((d) => {
              const r = duplicateInstance(d, h.inst.i);
              if (r.blocked) api.notify(LIMIT_TEXT[r.blocked]);
              return r.doc;
            }),
        },
        { label: 'Обрати іншу', onClick: () => api.openPicker({ cfgId, slot }) },
      ]
    : [];

  const primary = (el: HTMLElement) => {
    if (inherited || readOnly) {
      tip.toggle(el, content());
      return;
    }
    if (COARSE_PTR) {
      // Тап по речі — опис і дії в одному закріпленому тултіпі.
      if (h) tip.toggle(el, { ...content(), actions: menuItems });
      else api.openPicker({ cfgId, slot });
      return;
    }
    if (h) api.openItemEditor(cfgId, h.inst.i);
    else api.openPicker({ cfgId, slot });
  };

  const onClick = (e: MouseEvent<HTMLElement>) => primary(e.currentTarget);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    primary(e.currentTarget);
  };
  const onContextMenu = (e: MouseEvent<HTMLElement>) => {
    e.preventDefault();
    if (lastPointer.current === 'touch') return;
    if (h && !inherited && !readOnly) openMenu(pointRect(e.clientX, e.clientY));
  };

  const cls =
    'doll-slot' +
    (h ? ' is-filled' : '') +
    (bad ? ' is-bad' : '') +
    (inherited ? ' is-inherited' : '') +
    (dnd.overKey === slotDropKey(slot) ? ' drop-ok' : '');
  const title = h ? instName(h) + (inherited ? ' — як у Головному' : '') : label;
  const drag = h && !inherited ? dnd.dragProps({ from: 'slot', cfgId, slot, iid: h.inst.i, cat: h.inst.cat }) : {};
  const drop = !inherited && !readOnly ? dnd.slotDrop(cfgId, slot) : {};

  return (
    <>
      <div
        className={cls}
        data-slot={slot}
        role="button"
        tabIndex={0}
        aria-label={label + (h ? ': ' + instName(h) : ' — порожньо')}
        title={COARSE_PTR ? title : undefined}
        {...drag}
        {...drop}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
        onMouseEnter={(e) => {
          if (!COARSE_PTR && !dnd.isDragging()) tip.show(e.currentTarget, content());
        }}
        onMouseLeave={() => tip.hide()}
        onFocus={(e: FocusEvent<HTMLElement>) => {
          if (!COARSE_PTR && isKeyboardFocus(e.currentTarget)) tip.show(e.currentTarget, content());
        }}
        onBlur={() => tip.hide()}
        onPointerDown={(e: PointerEvent<HTMLElement>) => {
          lastPointer.current = e.pointerType;
        }}
      >
        <span className="doll-cell">
          {h ? (
            h.item ? (
              <span className="doll-icon" style={iconStyle(h.item, h.inst.cat, gender)} />
            ) : (
              <span className="doll-cell-unknown" aria-hidden="true">?</span>
            )
          ) : (
            <span className="doll-cell-ph" style={phStyle(slot)} aria-hidden="true" />
          )}
          {h && <CellBadges h={h} />}
        </span>
      </div>
      {menuAt && h && <CellMenu anchor={menuAt} title={instName(h)} grade={instGrade(h)} items={menuItems} onClose={() => setMenuAt(null)} />}
    </>
  );
}
