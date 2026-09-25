// =========================================================
// ЛЯЛЬКА — оболонка модалок редактора на класах pvp (.modal-overlay/.modal,
// z 1000). Спільне для всіх вікон ляльки: Esc і клік по затемненню закривають,
// role=dialog + aria-modal, мінімальний фокус-трап (Tab по колу всередині
// вікна), body.modal-open — щоб сторінка під вікном не скролилась (так само
// робить BracketView). Відкриття вікна ховає тултіп: інакше він лишається
// висіти над затемненням.
//
// Фокус повертається туди, звідки відкрили ПЕРШЕ вікно. Вікна ляльки
// заміняють одне одне (редактор речі → пікер каменя → знову редактор), і
// «попередній фокус» кожного наступного — уже відмонтована кнопка, тож
// джерело фокусу запамʼятовується один раз на весь ланцюжок вікон.
// =========================================================

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { tipHideAll } from '../tip/useTip';
import '../doll-modals.css';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Скільки вікон ляльки зараз змонтовано і звідки відкрили перше з них.
let openCount = 0;
let opener: HTMLElement | null = null;
let restoring = false;

/** Фокус саме зараз повертається із закритого вікна, а не приходить від гравця:
 * клітинки тоді не показують тултіп (курсор деінде — він «залипав» би). */
export function isRestoringFocus(): boolean {
  return restoring;
}

export function ModalShell({
  title,
  onClose,
  children,
  size = 'md',
  className,
  headExtra,
  foot,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** sm ≈ 360 px (налаштування бафа), md ≈ 480 px (редактор/пікер), lg ≈ 580 px (суперник). */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Кнопки в шапці праворуч від заголовка (напр. «Зняти» в пікері). */
  headExtra?: ReactNode;
  foot?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    tipHideAll();
    if (openCount === 0) {
      const a = document.activeElement;
      opener = a instanceof HTMLElement && a !== document.body ? a : null;
    }
    openCount++;
    document.body.classList.add('modal-open');
    // Початковий фокус: поле з data-autofocus (пошук у пікері), інакше саме вікно.
    const first = root.querySelector<HTMLElement>('[data-autofocus]');
    (first ?? root).focus({ preventScroll: true });

    const focusables = () =>
      Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Закріплений тултіп поверх вікна ковтає Esc сам (TipHost, capture).
        if (e.defaultPrevented) return;
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const a = document.activeElement;
      if (e.shiftKey && (a === list[0] || a === root || !root.contains(a))) {
        e.preventDefault();
        list[list.length - 1].focus();
      } else if (!e.shiftKey && (a === list[list.length - 1] || !root.contains(a))) {
        e.preventDefault();
        list[0].focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      tipHideAll();
      openCount = Math.max(0, openCount - 1);
      if (openCount > 0) return;
      document.body.classList.remove('modal-open');
      // Наступне вікно ланцюжка (якщо воно є) змонтується в тому ж коміті й
      // забере фокус собі; якщо ні — фокус іде туди, звідки відкрили перше.
      const back = opener;
      opener = null;
      if (back && back.isConnected) {
        restoring = true;
        try {
          back.focus({ preventScroll: true });
        } finally {
          restoring = false;
        }
      }
    };
  }, []);

  return (
    <div
      className="modal-overlay doll-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={'modal doll-modal doll-modal-' + size + (className ? ' ' + className : '')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-head doll-modal-head">
          <h3 id={titleId}>{title}</h3>
          {headExtra && <div className="doll-modal-headx">{headExtra}</div>}
          <button type="button" className="modal-close" aria-label="Закрити" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body doll-modal-body">{children}</div>
        {foot && <div className="modal-foot doll-modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export default ModalShell;
