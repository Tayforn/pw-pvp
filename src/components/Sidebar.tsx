// =========================================================
// Сайдбар: статичні пункти (Головна/Турніри/Реєстрація/Правила) +
// Адмінка (лише для адміна). Пункт на серію прибрано — сайт спрощено
// до однієї активної серії, показувати її окремо в меню зайве.
// =========================================================

import type { ReactNode } from 'react';
import type { Route } from '../app/useRoute';

interface NavEntry {
  route: Route;
  label: string;
  ico: ReactNode;
}

const S = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

const homeIco = <svg {...S}><path d="M4 11 12 4l8 7" /><path d="M6 10v9h12v-9" /></svg>;
const listIco = <svg {...S}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>;
const registerIco = <svg {...S}><path d="M12 3 5 6v5c0 4.8 3 7.8 7 9.8 4-2 7-5 7-9.8V6z" /><path d="M9 12l2 2 4-4" /></svg>;
const rulesIco = <svg {...S}><path d="M12 5.5C10 4 6.5 4 4 4.5v14c2.5-.5 6-.5 8 1 2-1.5 5.5-1.5 8-1v-14c-2.5-.5-6-.5-8 1z" /><path d="M12 5.5v15" /></svg>;
const adminIco = <svg {...S}><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7" /></svg>;

function routeKey(r: Route): string {
  return r.name === 'series' ? `series:${r.slug}` : r.name === 'tournament' ? `tournament:${r.id}` : r.name;
}

interface Props {
  route: Route;
  isAdmin: boolean;
  onNavigate: (route: Route) => void;
}

export default function Sidebar({ route, isAdmin, onNavigate }: Props) {
  const items: NavEntry[] = [
    { route: { name: 'home' }, label: 'Головна', ico: homeIco },
    { route: { name: 'tournaments' }, label: 'Турніри', ico: listIco },
    { route: { name: 'register' }, label: 'Заявка', ico: registerIco },
    { route: { name: 'rules' }, label: 'Правила', ico: rulesIco },
  ];
  if (isAdmin) items.push({ route: { name: 'admin' }, label: 'Адмінка', ico: adminIco });

  const activeKey = routeKey(route);

  return (
    <aside className="sidebar" id="appSidebar">
      <nav className="nav-primary" role="tablist" aria-label="Розділи">
        {items.map((n) => (
          <button
            key={routeKey(n.route)}
            className={'tab' + (routeKey(n.route) === activeKey ? ' active' : '')}
            role="tab"
            aria-selected={routeKey(n.route) === activeKey}
            onClick={() => onNavigate(n.route)}
          >
            <span className="tab-ico">{n.ico}</span>
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
