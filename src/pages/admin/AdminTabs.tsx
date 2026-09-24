// =========================================================
// Адмінка: смужка вкладок з адресою в URL (/admin/<tab>). Кнопки — справжні
// посилання (можна відкрити в новій вкладці, скопіювати), а не useState:
// F5 і «поділитись посиланням на вкладку Бафи» працюють. На телефоні
// смужка не переноситься, а скролиться пальцем (сім вкладок на 375 px не
// влізуть), активна підтягується у видиму частину.
// =========================================================

import { useEffect, useRef } from 'react';
import { routeUrl, type AdminTab } from '../../app/useRoute';

/** Короткі підписи — щоб смужка була якнайвужчою на телефоні. */
export const ADMIN_TAB_LABELS: Record<AdminTab, string> = {
  tournaments: 'Турніри',
  participants: 'Учасники',
  report: 'Звіт',
  scale: 'Шкала балів',
  buffs: 'Бафи й склад',
  rules: 'Правила',
  admins: 'Адміни',
};

/** Заголовок сторінки під вкладкою. */
export const ADMIN_TAB_TITLES: Record<AdminTab, string> = {
  tournaments: 'Керування турнірами',
  participants: 'Учасники',
  report: 'Звіт балансу',
  scale: 'Шкала балів',
  buffs: 'Бафи й склад команди',
  rules: 'Правила турнірів — довідник рядків',
  admins: 'Адміни та ГМ',
};

interface Props {
  tabs: readonly AdminTab[];
  active: AdminTab;
  onSelect: (tab: AdminTab) => void;
}

export default function AdminTabs({ tabs, active, onSelect }: Props) {
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    // inline: 'nearest' — лише горизонтальний підскрол смужки; block: 'nearest'
    // не рухає сторінку, коли смужка і так у вікні
    activeRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [active]);

  return (
    <nav className="admin-tabs" role="tablist" aria-label="Розділи адмінки">
      {tabs.map((t) => {
        const isActive = t === active;
        return (
          <a
            key={t}
            ref={isActive ? activeRef : null}
            role="tab"
            aria-selected={isActive}
            href={routeUrl({ name: 'admin', tab: t })}
            className={'btn btn-sm ' + (isActive ? 'btn-primary' : 'btn-ghost')}
            onClick={(e) => {
              // з модифікаторами — стандартна поведінка посилання (нова вкладка браузера)
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
              e.preventDefault();
              if (!isActive) onSelect(t);
            }}
          >
            {ADMIN_TAB_LABELS[t]}
          </a>
        );
      })}
    </nav>
  );
}
