// =========================================================
// Роутинг pw-pvp: History API, гібрид статичних шляхів + динамічні
// сегменти (/series/:slug, /t/:id, /t/:id/bracket, /characters/:id) — без бібліотеки роутера, просто
// парсимо перший/другий сегмент шляху (в стилі pw-calc/pw-events, але
// pw-calc-івський ROUTES-реєстр тут не підходить — сторінки контент-driven,
// а не фіксований список вкладок).
// =========================================================

import { useCallback, useEffect, useState } from 'react';

export const APP_BASE: string = (() => {
  const b = import.meta.env.BASE_URL || '/';
  return b.endsWith('/') ? b : b + '/';
})();

/** Вкладки адмінки — другий сегмент /admin/<tab>, щоб F5 і посилання
 * «відкрий вкладку Бафи» працювали. 'tournaments' — це просто /admin. */
export const ADMIN_TABS = ['tournaments', 'participants', 'report', 'scale', 'buffs', 'rules', 'admins'] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];
export const isAdminTab = (x: unknown): x is AdminTab => typeof x === 'string' && (ADMIN_TABS as readonly string[]).includes(x);

export type Route =
  | { name: 'home' }
  | { name: 'tournaments' }
  | { name: 'register' }
  | { name: 'rules' }
  | { name: 'admin'; tab?: AdminTab }
  | { name: 'series'; slug: string }
  | { name: 'tournament'; id: string }
  /** /t/:id/bracket — лише сітка, без шапки й меню: посилання «Поділитися» */
  | { name: 'tournament-bracket'; id: string }
  /** лише dev-збірка: /dev/bracket — сітка з фейковими командами (верстка) */
  | { name: 'dev-bracket' }
  /** /characters — лялька персонажа (поки що те саме, що /characters/new) */
  | { name: 'characters' }
  /** /characters/:id — 'new' = локальна чернетка; інші id — збережені персонажі (наступний етап) */
  | { name: 'character'; id: string };

/** Id персонажа в адресі: 'new' або короткий ідентифікатор без спецсимволів. */
const CHARACTER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parsePath(): Route {
  let p = location.pathname;
  if (p.startsWith(APP_BASE)) p = p.slice(APP_BASE.length);
  const segs = p.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [a, b, c] = segs;
  if (!a) return { name: 'home' };
  if (a === 'tournaments') return { name: 'tournaments' };
  if (a === 'register') return { name: 'register' };
  if (a === 'rules') return { name: 'rules' };
  // невідома вкладка (/admin/foo) — просто адмінка, як і без сегмента
  if (a === 'admin') return isAdminTab(b) ? { name: 'admin', tab: b } : { name: 'admin' };
  if (a === 'series' && b) return { name: 'series', slug: b };
  if (a === 't' && b && c === 'bracket') return { name: 'tournament-bracket', id: b };
  if (a === 't' && b) return { name: 'tournament', id: b };
  if (a === 'characters') return b && CHARACTER_ID_RE.test(b) ? { name: 'character', id: b } : { name: 'characters' };
  if (import.meta.env.DEV && a === 'dev' && b === 'bracket') return { name: 'dev-bracket' };
  return { name: 'home' };
}

export function routeUrl(route: Route): string {
  switch (route.name) {
    case 'home': return APP_BASE;
    case 'series': return APP_BASE + 'series/' + route.slug;
    case 'tournament': return APP_BASE + 't/' + route.id;
    case 'tournament-bracket': return APP_BASE + 't/' + route.id + '/bracket';
    // перша вкладка без сегмента — щоб /admin і /admin/tournaments були одним шляхом
    case 'admin': return APP_BASE + 'admin' + (route.tab && route.tab !== 'tournaments' ? '/' + route.tab : '');
    case 'dev-bracket': return APP_BASE + 'dev/bracket';
    case 'character': return APP_BASE + 'characters/' + encodeURIComponent(route.id);
    default: return APP_BASE + route.name;
  }
}

function samePath(a: Route, b: Route): boolean {
  return routeUrl(a) === routeUrl(b);
}

export function useRoute(): [Route, (route: Route) => void] {
  const [route, setRouteState] = useState<Route>(parsePath);

  useEffect(() => {
    const onPop = () => setRouteState(parsePath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route) => {
    setRouteState((cur) => {
      if (!samePath(cur, next)) history.pushState(null, '', routeUrl(next));
      return next;
    });
  }, []);

  return [route, navigate];
}
