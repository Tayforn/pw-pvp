// =========================================================
// Роутинг pw-pvp: History API, гібрид статичних шляхів + динамічні
// сегменти (/series/:slug, /t/:id, /t/:id/bracket, /characters/:id, /check/:id, /admin/doll/:id) і /my — без бібліотеки роутера, просто
// парсимо перший/другий сегмент шляху (в стилі pw-calc/pw-events, але
// pw-calc-івський ROUTES-реєстр тут не підходить — сторінки контент-driven,
// а не фіксований список вкладок).
// =========================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmLeave } from './leaveGuard';

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
  /** /my — «Мої заявки»: статус своїх заявок (і гостю — за id, запамʼятованими браузером) */
  | { name: 'my' }
  | { name: 'rules' }
  | { name: 'admin'; tab?: AdminTab }
  | { name: 'series'; slug: string }
  | { name: 'tournament'; id: string }
  /** /t/:id/bracket — лише сітка, без шапки й меню: посилання «Поділитися» */
  | { name: 'tournament-bracket'; id: string }
  /** лише dev-збірка: /dev/bracket — сітка з фейковими командами (верстка) */
  | { name: 'dev-bracket' }
  /** лише dev-збірка: /dev/doll — редактор ляльки з фікстурами typical-* (верстка без входу) */
  | { name: 'dev-doll' }
  /** /characters — «Мої персонажі» (список збережених; гостю — вхід і чернетка) */
  | { name: 'characters' }
  /** /characters/:id — 'new' = новий персонаж на локальній чернетці; інакше — збережений (uuid) */
  | { name: 'character'; id: string }
  /** /check — звірка ляльки зі скріншотами гри: вибір персонажа; /check/:id — сама звірка ('new' = чернетка) */
  | { name: 'check'; id?: string }
  /** /admin/doll/:registrationId — знімок ляльки із заявки в редакторі лише для перегляду (адмін) */
  | { name: 'admin-doll'; id: string };

/** Id персонажа чи заявки в адресі: 'new' або короткий ідентифікатор без спецсимволів. */
const PATH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function parsePath(): Route {
  let p = location.pathname;
  if (p.startsWith(APP_BASE)) p = p.slice(APP_BASE.length);
  const segs = p.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [a, b, c] = segs;
  if (!a) return { name: 'home' };
  if (a === 'tournaments') return { name: 'tournaments' };
  if (a === 'register') return { name: 'register' };
  if (a === 'my') return { name: 'my' };
  if (a === 'rules') return { name: 'rules' };
  // лялька із заявки — окрема адмінська сторінка, не вкладка; без id (чи з кривим) — просто адмінка
  if (a === 'admin' && b === 'doll' && c && PATH_ID_RE.test(c)) return { name: 'admin-doll', id: c };
  // невідома вкладка (/admin/foo) — просто адмінка, як і без сегмента
  if (a === 'admin') return isAdminTab(b) ? { name: 'admin', tab: b } : { name: 'admin' };
  if (a === 'series' && b) return { name: 'series', slug: b };
  if (a === 't' && b && c === 'bracket') return { name: 'tournament-bracket', id: b };
  if (a === 't' && b) return { name: 'tournament', id: b };
  if (a === 'characters') return b && PATH_ID_RE.test(b) ? { name: 'character', id: b } : { name: 'characters' };
  if (a === 'check') return b && PATH_ID_RE.test(b) ? { name: 'check', id: b } : { name: 'check' };
  if (import.meta.env.DEV && a === 'dev' && b === 'bracket') return { name: 'dev-bracket' };
  if (import.meta.env.DEV && a === 'dev' && b === 'doll') return { name: 'dev-doll' };
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
    case 'dev-doll': return APP_BASE + 'dev/doll';
    case 'character': return APP_BASE + 'characters/' + encodeURIComponent(route.id);
    case 'check': return APP_BASE + 'check' + (route.id ? '/' + encodeURIComponent(route.id) : '');
    case 'admin-doll': return APP_BASE + 'admin/doll/' + encodeURIComponent(route.id);
    default: return APP_BASE + route.name;
  }
}

function samePath(a: Route, b: Route): boolean {
  return routeUrl(a) === routeUrl(b);
}

// ── Застереження перед відходом (leaveGuard) ──────────────────────
// Перед переходом на іншу адресу роутер питає confirmLeave(): сторінка з
// незбереженими змінами показує window.confirm, «Скасувати» лишає її на місці.
// Для кліків (navigate) це просто «не робити pushState». Для «Назад / Вперед»
// браузер уже змінив адресу до popstate, тож при «Скасувати» повертаємо її
// pushState-ом на останню відому адресу сторінки (lastHref): запис історії
// наче й не покидали, а маршрут не міняється. Напрямок (назад чи вперед) для
// цього знати не треба — на відміну від history.go(-delta) з номерами записів,
// тут нема другого popstate, який довелося б пропускати.

/** Адреса поточного запису історії — куди повертати після «Скасувати». */
let lastHref = '';

/** Сторінка, що сама міняє адресу replaceState-ом (вкладка сету ?set=),
 * каже про це роутеру — інакше після «Скасувати» повернення втратить цю зміну. */
export function noteHistoryChange(): void {
  lastHref = location.href;
}

/** Обробник popstate: без guard чи після підтвердження — застосувати маршрут
 * з адреси; інакше повернути адресу сторінки, маршрут не чіпати. */
export function handlePopState(apply: (route: Route) => void): void {
  if (!confirmLeave()) {
    history.pushState(null, '', lastHref);
    return;
  }
  noteHistoryChange();
  apply(parsePath());
}

/** [маршрут, navigate]; navigate повертає false, коли сторінка не відпустила. */
export function useRoute(): [Route, (route: Route) => boolean] {
  const [route, setRouteState] = useState<Route>(parsePath);
  const routeRef = useRef(route);
  routeRef.current = route;

  useEffect(() => {
    noteHistoryChange();
    const onPop = () => handlePopState(setRouteState);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next: Route): boolean => {
    // Та сама адреса — не перехід, guard не питаємо (нічого не губиться).
    if (!samePath(routeRef.current, next)) {
      if (!confirmLeave()) return false;
      history.pushState(null, '', routeUrl(next));
      noteHistoryChange();
    }
    setRouteState(next);
    return true;
  }, []);

  return [route, navigate];
}
