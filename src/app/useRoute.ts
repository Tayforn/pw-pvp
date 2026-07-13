// =========================================================
// Роутинг pw-pvp: History API, гібрид статичних шляхів + 2 динамічних
// сегменти (/series/:slug, /t/:id) — без бібліотеки роутера, просто
// парсимо перший/другий сегмент шляху (в стилі pw-calc/pw-events, але
// pw-calc-івський ROUTES-реєстр тут не підходить — сторінки контент-driven,
// а не фіксований список вкладок).
// =========================================================

import { useCallback, useEffect, useState } from 'react';

export const APP_BASE: string = (() => {
  const b = import.meta.env.BASE_URL || '/';
  return b.endsWith('/') ? b : b + '/';
})();

export type Route =
  | { name: 'home' }
  | { name: 'tournaments' }
  | { name: 'register' }
  | { name: 'rules' }
  | { name: 'admin' }
  | { name: 'series'; slug: string }
  | { name: 'tournament'; id: string };

function parsePath(): Route {
  let p = location.pathname;
  if (p.startsWith(APP_BASE)) p = p.slice(APP_BASE.length);
  const segs = p.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [a, b] = segs;
  if (!a) return { name: 'home' };
  if (a === 'tournaments') return { name: 'tournaments' };
  if (a === 'register') return { name: 'register' };
  if (a === 'rules') return { name: 'rules' };
  if (a === 'admin') return { name: 'admin' };
  if (a === 'series' && b) return { name: 'series', slug: b };
  if (a === 't' && b) return { name: 'tournament', id: b };
  return { name: 'home' };
}

export function routeUrl(route: Route): string {
  switch (route.name) {
    case 'home': return APP_BASE;
    case 'series': return APP_BASE + 'series/' + route.slug;
    case 'tournament': return APP_BASE + 't/' + route.id;
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
