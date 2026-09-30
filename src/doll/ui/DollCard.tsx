// =========================================================
// ЛЯЛЬКА — спільний вигляд карток сторінки персонажа (розкладка B3): шапка-
// смужка 32 px із заголовком капсом кольору акценту і необовʼязковими
// пігулками/кнопками праворуч, під нею тіло з відступом 12 px. Стилі —
// .doll-card / .doll-card-head / .doll-card-body у doll.css, лише токени сайту.
// Клас картки (className) задає і її місце на телефоні (order у doll.css).
// =========================================================

import type { ReactNode } from 'react';

export function DollCard({
  title, className, extra, label, bodyClassName, children,
}: {
  title: ReactNode;
  /** Клас картки: .doll-eq, .doll-inv, .doll-ready, .doll-attrs-card … (див. порядок у doll.css). */
  className?: string;
  /** Праворуч у шапці: пігулка стану, лічильник, тиха кнопка. */
  extra?: ReactNode;
  /** aria-label секції, коли заголовок — не рядок. */
  label?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className={'doll-card' + (className ? ' ' + className : '')} aria-label={label ?? (typeof title === 'string' ? title : undefined)}>
      <header className="doll-card-head">
        <h3>{title}</h3>
        {extra}
      </header>
      <div className={'doll-card-body' + (bodyClassName ? ' ' + bodyClassName : '')}>{children}</div>
    </section>
  );
}

export default DollCard;
