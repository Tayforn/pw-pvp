// =========================================================
// Каркас застосунку: шапка, сайдбар-drawer, одна активна сторінка.
// На відміну від pw-calc/pw-events (фіксований список вкладок, усі
// панелі змонтовані постійно), тут сторінки контент-driven (динамічні
// /series/:slug, /t/:id) — рендеримо рівно одну сторінку за route.name.
//
// Доступ (app/access.ts): гість без входу через Discord бачить лише заявку,
// правила, минулі турніри й ляльку персонажа; /t/:id/bracket — окрема
// сторінка без шапки й меню (посилання «Поділитися»), відкрита всім.
// Лялька із заявки (/admin/doll/:id) — лише адміну: не-адмін бачить заглушку
// з посиланням на адмінку (там форма входу).
//
// Перехід по сайту (сайдбар, логотип, кнопки сторінок, «Назад / Вперед») іде
// через useRoute: сторінка з незбереженими змінами (app/leaveGuard.ts) може
// його не відпустити — тоді ні маршрут, ні меню на телефоні не міняються.
//
// Лялька персонажа — ледачий чанк (каталог і спрайти важать мегабайти).
// Після деплою старий чанк зникає з сервера, і вкладка, відкрита до деплою,
// отримує помилку імпорту — тоді показуємо «Сайт оновився» з перезавантаженням
// (інший збій сторінки — окремим повідомленням, бо перезавантаження його не лікує).
// =========================================================

import { Component, Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRoute, type Route } from '../app/useRoute';
import { useAuth } from '../app/useAuth';
import { takeLoginError, useMe } from '../app/useMe';
import { ROUTE_ACCESS, isInsider, type Viewer } from '../app/access';
import { fetchSeries, subscribeToTournamentChanges } from '../data/tournaments';
import type { TournamentSeries } from '../data/types';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';
import MemberNotice from './MemberNotice';

import HomePage from '../pages/HomePage';
import TournamentsPage from '../pages/TournamentsPage';
import SeriesPage from '../pages/SeriesPage';
import TournamentPage from '../pages/TournamentPage';
import RegisterPage from '../pages/RegisterPage';
import RulesPage from '../pages/RulesPage';
import AdminPage from '../pages/AdminPage';
import DevBracketPage from '../pages/DevBracketPage';
import BracketSharePage from '../pages/BracketSharePage';

const CharacterPage = lazy(() => import('../pages/CharacterPage'));
// Знімок ляльки із заявки в адмінці — той самий редактор, той самий ледачий чанк ляльки.
const AdminDollPage = lazy(() => import('../pages/AdminDollPage'));
// Лише dev-збірка: у проді import.meta.env.DEV = false, і гілка з чанком зникає з бандла.
const DevDollPage = import.meta.env.DEV ? lazy(() => import('../pages/DevDollPage')) : null;

/** Помилка саме завантаження чанка (JS чи його CSS), а не збій усередині сторінки.
 * Тексти — з Chrome, Firefox, Safari і прелоадера Vite. */
const CHUNK_ERROR_RE = /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

/** Ловить помилку ледачої сторінки. Зниклий після деплою чанк лікується
 * перезавантаженням; інший збій — ні, і казати «сайт оновився» було б неправдою. */
class LazyPageBoundary extends Component<{ children: ReactNode }, { failed: false | 'chunk' | 'crash' }> {
  state: { failed: false | 'chunk' | 'crash' } = { failed: false };
  static getDerivedStateFromError(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { failed: CHUNK_ERROR_RE.test(msg) ? ('chunk' as const) : ('crash' as const) };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="card" role="alert">
        <p>
          {this.state.failed === 'chunk'
            ? 'Сайт оновився — цю сторінку треба завантажити заново.'
            : 'Сторінка зламалась через помилку в програмі. Спробуй перезавантажити; якщо не допоможе — напиши адміну.'}
        </p>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => location.reload()}>
          Перезавантажити
        </button>
      </div>
    );
  }
}

const lazyFallback = <p className="hint" style={{ padding: 24 }}>Завантаження…</p>;

const isMobile = () => window.matchMedia('(max-width: 880px)').matches;

export default function Layout() {
  const [route, navigate] = useRoute();
  const { isAdmin, loading: adminLoading } = useAuth();
  const { me, loading: meLoading, login, logout } = useMe();
  const viewer: Viewer = { member: !!me, admin: isAdmin };
  const insider = isInsider(viewer);
  // Поки не знаємо, хто це, — не блимаємо гостьовим видом перед своїм.
  const checking = meLoading || adminLoading;
  const [loginError, setLoginError] = useState(takeLoginError);
  const [series, setSeries] = useState<TournamentSeries[]>([]);
  const [navOpen, setNavOpen] = useState(() => document.documentElement.classList.contains('nav-open'));

  const setOpen = useCallback((on: boolean) => {
    document.documentElement.classList.toggle('nav-open', on);
    setNavOpen(on);
  }, []);

  const go = useCallback(
    (r: Route) => {
      // Сторінка з незбереженими змінами могла не відпустити (leaveGuard) — тоді й меню лишається.
      if (navigate(r) && isMobile()) setOpen(false);
    },
    [navigate, setOpen],
  );

  useEffect(() => {
    const load = () => fetchSeries().then(setSeries).catch(() => {});
    load();
    return subscribeToTournamentChanges(load);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [route]);

  // Редактор персонажа — три колонки: на його сторінці оболонка ширша (styles.css,
  // html.wide-shell). Клас знімається при виході зі сторінки.
  const wideShell = route.name === 'character' || route.name === 'dev-doll' || route.name === 'admin-doll';
  useEffect(() => {
    document.documentElement.classList.toggle('wide-shell', wideShell);
    return () => document.documentElement.classList.remove('wide-shell');
  }, [wideShell]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMobile() && document.documentElement.classList.contains('nav-open')) setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
      const name = a?.dataset.goto;
      if (name && ['home', 'tournaments', 'register', 'rules', 'admin', 'characters'].includes(name)) {
        e.preventDefault();
        go({ name } as Route);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
    };
  }, [setOpen, go]);

  // Сітка за посиланням «Поділитися» — сама по собі, без шапки, меню й
  // футера: той, кому скинули лінк, бачить турнір і нічого зайвого.
  if (route.name === 'tournament-bracket') return <BracketSharePage id={route.id} />;

  let page;
  if (route.name === 'home') page = insider ? <HomePage series={series} onNavigate={go} /> : <TournamentsPage onNavigate={go} guest />;
  else if (route.name === 'tournaments') page = <TournamentsPage onNavigate={go} guest={!insider} />;
  else if (route.name === 'register') page = <RegisterPage />;
  else if (route.name === 'rules') page = <RulesPage />;
  else if (route.name === 'series') page = <SeriesPage slug={route.slug} onNavigate={go} />;
  else if (route.name === 'tournament') page = <TournamentPage id={route.id} guest={!insider} onLogin={login} />;
  else if (route.name === 'admin') page = <AdminPage series={series} tab={route.tab} onTab={(tab) => go({ name: 'admin', tab })} onNavigate={go} />;
  else if (route.name === 'admin-doll') {
    page = (
      <LazyPageBoundary key={'admin-doll:' + route.id}>
        <Suspense fallback={lazyFallback}>
          <AdminDollPage id={route.id} onNavigate={go} />
        </Suspense>
      </LazyPageBoundary>
    );
  }
  else if (route.name === 'dev-bracket' && import.meta.env.DEV) page = <DevBracketPage />;
  else if (route.name === 'dev-doll' && DevDollPage) {
    page = (
      <LazyPageBoundary key="dev-doll">
        <Suspense fallback={lazyFallback}>
          <DevDollPage />
        </Suspense>
      </LazyPageBoundary>
    );
  }
  else if (route.name === 'characters' || route.name === 'character') {
    const id = route.name === 'character' ? route.id : null;
    page = (
      <LazyPageBoundary key={id ?? 'list'}>
        <Suspense fallback={lazyFallback}>
          <CharacterPage id={id} onNavigate={go} />
        </Suspense>
      </LazyPageBoundary>
    );
  }

  // Вид гостя й свого різний — до з'ясування сесії сторінку не рендеримо
  // (інакше гість на мить побачить чуже, а свій — заглушку). Заявка й
  // правила однакові для всіх, адмінка має власну перевірку сесії.
  const viewerDependent = route.name === 'home' || route.name === 'tournaments' || route.name === 'tournament' || route.name === 'series';
  // Лялька із заявки — лише адміну; сама адмінка (/admin) має власну форму входу і сюди не підпадає.
  const adminOnly = route.name === 'admin-doll';
  if ((checking && viewerDependent) || (adminLoading && adminOnly)) {
    page = <p className="hint" style={{ padding: 24 }}>Перевірка доступу…</p>;
  } else if (adminOnly && !isAdmin) {
    page = (
      // CSS ляльки тут не завантажено (чанк не потрібен) — звичайна картка сайту.
      <div className="card" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span>Ця сторінка лише для адміністратора — увійди в адмінку.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => go({ name: 'admin' })}>
          До адмінки
        </button>
      </div>
    );
  } else if (ROUTE_ACCESS[route.name] === 'member' && route.name !== 'home' && !insider) {
    // Головна для гостя — не заглушка, а список минулих турнірів (вище).
    page = <MemberNotice onLogin={login} />;
  }

  return (
    <>
      <Header
        navOpen={navOpen}
        onNavToggle={() => setOpen(!document.documentElement.classList.contains('nav-open'))}
        me={meLoading ? undefined : me}
        showSiblings={insider}
        onLogin={login}
        onLogout={logout}
      />
      <div className="nav-backdrop" aria-hidden="true" onClick={() => setOpen(false)}></div>
      <div className="app-shell container">
        <Sidebar route={route} viewer={viewer} onNavigate={go} />
        <div className="content">
          {loginError && (
            <div className="card login-error" role="alert">
              <span className="form-err">{loginError}</span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLoginError(null)} aria-label="Закрити">✕</button>
            </div>
          )}
          <main>{page}</main>
        </div>
      </div>
      <Footer />
    </>
  );
}
