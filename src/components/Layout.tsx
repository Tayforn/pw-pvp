// =========================================================
// Каркас застосунку: шапка, сайдбар-drawer, одна активна сторінка.
// На відміну від pw-calc/pw-events (фіксований список вкладок, усі
// панелі змонтовані постійно), тут сторінки контент-driven (динамічні
// /series/:slug, /t/:id) — рендеримо рівно одну сторінку за route.name.
//
// Доступ (app/access.ts): гість без входу через Discord бачить лише заявку,
// правила, минулі турніри й ляльку персонажа; /t/:id/bracket — окрема
// сторінка без шапки й меню (посилання «Поділитися»), відкрита всім.
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
      navigate(r);
      if (isMobile()) setOpen(false);
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
  else if (route.name === 'admin') page = <AdminPage series={series} tab={route.tab} onTab={(tab) => go({ name: 'admin', tab })} />;
  else if (route.name === 'dev-bracket' && import.meta.env.DEV) page = <DevBracketPage />;
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
  if (checking && viewerDependent) {
    page = <p className="hint" style={{ padding: 24 }}>Перевірка доступу…</p>;
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
