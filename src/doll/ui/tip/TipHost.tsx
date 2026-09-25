// =========================================================
// ЛЯЛЬКА — портал тултіпа (один на сторінку). Механіка — як PlayerPopover:
// position:fixed у body, вимір через useLayoutEffect, під якорем або над ним,
// коли знизу не влазить, притискання до країв вікна. Понад модалками
// (z 1100 > 1000), бо тултіп речі відкривається і з пікера.
//
// Наведення: тултіп не ловить курсор (pointer-events none), щоб не блимати,
// коли мишка заходить на нього. Закріплений (тап/клік): ловить, бо в ньому
// можуть бути кнопки і власний скрол; закривається Esc, кліком поза ним або
// повторним кліком по якорю. Скрол і ресайз лише перераховують позицію — на телефоні
// закріплений тултіп не має зникати від дотику до сторінки.
// =========================================================

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { BuffTip } from './BuffTip';
import { ItemTip } from './ItemTip';
import { getTipState, subscribeTip, tipHideAll, type TipContent } from './useTip';
import '../doll-modals.css';

const MAX_W = 320;
const GAP = 8;
const EDGE = 8;

function TipBody({ content }: { content: TipContent }) {
  if (content.kind === 'item') return <ItemTip model={content.model} />;
  if (content.kind === 'buff') return <BuffTip model={content.model} />;
  return <div className="doll-tip-text">{content.text}</div>;
}

export function TipHost() {
  const { anchor, content, pinned } = useSyncExternalStore(subscribeTip, getTipState, getTipState);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  // Лічильник «перерахуй позицію» для скролу/ресайзу (сам стан стору не змінюється).
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor || !content) {
      setPos(null);
      return;
    }
    if (!anchor.isConnected) {
      tipHideAll();
      return;
    }
    const r = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(el.offsetWidth, MAX_W, vw - EDGE * 2);
    const h = el.offsetHeight;
    const below = vh - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    let top: number;
    let maxH: number;
    if (h <= below || below >= above) {
      top = r.bottom + GAP;
      maxH = Math.max(80, below);
    } else {
      top = Math.max(EDGE, r.top - GAP - h);
      maxH = Math.max(80, above);
    }
    const left = Math.max(EDGE, Math.min(r.left, vw - w - EDGE));
    setPos({ top, left, maxH });
  }, [anchor, content, pinned, tick]);

  // Скрол/ресайз → перерахувати; якір зник із DOM (перемалювали список) → сховати.
  useEffect(() => {
    if (!content) return;
    const bump = () => setTick((t) => t + 1);
    window.addEventListener('scroll', bump, true);
    window.addEventListener('resize', bump);
    const alive = window.setInterval(() => {
      if (anchor && !anchor.isConnected) tipHideAll();
    }, 400);
    return () => {
      window.removeEventListener('scroll', bump, true);
      window.removeEventListener('resize', bump);
      window.clearInterval(alive);
    };
  }, [anchor, content]);

  // Esc ховає будь-який тултіп. Закріплений ще й ковтає натиск (capture +
  // stopPropagation), щоб модалка під ним не закрилась тим самим Esc; тултіп із
  // наведення/фокусу — ні: там Esc і закриває вікно, і ховає підказку разом.
  // Клік поза закріпленим тултіпом і якорем теж його закриває.
  useEffect(() => {
    if (!content) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (pinned) {
        e.stopPropagation();
        e.preventDefault();
      }
      tipHideAll();
    };
    const onDown = (e: PointerEvent) => {
      if (!pinned) return;
      const t = e.target as Node | null;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      tipHideAll();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [content, pinned, anchor]);

  if (!content || !anchor || typeof document === 'undefined') return null;

  const style: CSSProperties = {
    top: pos?.top ?? -9999,
    left: pos?.left ?? -9999,
    maxWidth: Math.min(MAX_W, (typeof window !== 'undefined' ? window.innerWidth : MAX_W + EDGE * 2) - EDGE * 2),
    maxHeight: pos?.maxH,
  };
  const actions = content.actions || [];
  const actionHints = [...new Set(actions.filter((a) => a.disabled && a.hint).map((a) => a.hint as string))];

  return createPortal(
    <div ref={ref} className={'doll-tip' + (pinned ? ' pinned' : '')} style={style} role={pinned ? 'dialog' : 'tooltip'} onClick={(e) => e.stopPropagation()}>
      <TipBody content={content} />
      {pinned && actions.length > 0 && (
        <div className="doll-tip-actions">
          {actions.map((a, i) => (
            <button
              type="button"
              key={i}
              className={'doll-tip-act' + (a.danger ? ' danger' : '')}
              disabled={a.disabled}
              title={a.disabled ? a.hint : undefined}
              onClick={() => {
                tipHideAll();
                a.onClick();
              }}
            >
              {a.label}
            </button>
          ))}
          {actionHints.map((h) => (
            <div className="doll-tip-actnote" key={h}>
              {h}
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
