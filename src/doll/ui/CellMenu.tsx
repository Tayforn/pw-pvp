// =========================================================
// ЛЯЛЬКА — меню клітинки (слот або річ в інвентарі): ПКМ на ПК, тап на
// телефоні. Портал у body з position:fixed за зразком PlayerPopover, бо
// всередині картки з overflow меню різалося б. Закривається Esc, кліком поза
// ним, скролом і ресайзом (позиція застаріває).
// =========================================================

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  onClick(): void;
  danger?: boolean;
  disabled?: boolean;
  /** Пояснення, чому пункт недоступний (title). */
  hint?: string;
}

/** Тач-екран без наведення: тултіпи — лише довгим натисканням, дії — через меню. */
export const COARSE_PTR: boolean = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/** Прямокутник-якір із точки (ПКМ) — меню стає під курсором. */
export function pointRect(x: number, y: number): DOMRect {
  return new DOMRect(x, y, 0, 0);
}

const MENU_W = 220;
const GAP = 6;

interface Props {
  anchor: DOMRect;
  /** Назва речі в шапці меню; grade — клас кольору gx-N. */
  title?: string;
  grade?: number;
  items: MenuItem[];
  onClose(): void;
}

export default function CellMenu({ anchor, title, grade, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Під якорем, по його лівому краю; не влазить знизу — над ним; не влазить праворуч — притискаємо.
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const w = Math.min(MENU_W, window.innerWidth - 16);
    let top = anchor.bottom + GAP;
    if (top + h > window.innerHeight - 8) top = anchor.top - GAP - h;
    // Якір міг бути частково за краєм (довгий інвентар, клавіатура) — меню завжди в межах вікна.
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - w - 8));
    setPos({ top, left });
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (ref.current && t && !ref.current.contains(t)) onClose();
    };
    const onMove = () => onClose();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [onClose]);

  const style: CSSProperties = { top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: Math.min(MENU_W, window.innerWidth - 16) };

  return createPortal(
    <div ref={ref} className="doll-menu" role="menu" style={style} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {title && <div className={'doll-menu-title' + (grade != null ? ' gx-' + grade : '')}>{title}</div>}
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          className={'doll-menu-item' + (it.danger ? ' is-danger' : '')}
          disabled={it.disabled}
          title={it.disabled ? it.hint : undefined}
          onClick={() => {
            onClose();
            it.onClick();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
