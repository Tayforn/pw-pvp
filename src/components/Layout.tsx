// =========================================================
// Каркас застосунку: шапка, сайдбар-drawer, одна активна сторінка.
// На відміну від pw-calc/pw-events (фіксований список вкладок, усі
// панелі змонтовані постійно), тут сторінки контент-driven (динамічні
// /series/:slug, /t/:id) — рендеримо рівно одну сторінку за route.name.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import { useRoute, type Route } from '../app/useRoute';
import { useAuth } from '../app/useAuth';
import { fetchSeries, subscribeToTournamentChanges } from '../data/tournaments';
import type { TournamentSeries } from '../data/types';
import Header from './Header';
import Sidebar from './Sidebar';
import Footer from './Footer';

import HomePage from '../pages/HomePage';
import TournamentsPage from '../pages/TournamentsPage';
import SeriesPage from '../pages/SeriesPage';
import TournamentPage from '../pages/TournamentPage';
import RegisterPage from '../pages/RegisterPage';
import RulesPage from '../pages/RulesPage';
import AdminPage from '../pages/AdminPage';

const isMobile = () => window.matchMedia('(max-width: 880px)').matches;

export default function Layout() {
  const [route, navigate] = useRoute();
  const { isAdmin } = useAuth();
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
      if (name && ['home', 'tournaments', 'register', 'rules', 'admin'].includes(name)) {
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

  let page;
  if (route.name === 'home') page = <HomePage series={series} onNavigate={go} />;
  else if (route.name === 'tournaments') page = <TournamentsPage onNavigate={go} />;
  else if (route.name === 'register') page = <RegisterPage />;
  else if (route.name === 'rules') page = <RulesPage />;
  else if (route.name === 'series') page = <SeriesPage slug={route.slug} onNavigate={go} />;
  else if (route.name === 'tournament') page = <TournamentPage id={route.id} />;
  else if (route.name === 'admin') page = <AdminPage series={series} />;

  return (
    <>
      <Header navOpen={navOpen} onNavToggle={() => setOpen(!document.documentElement.classList.contains('nav-open'))} />
      <div className="nav-backdrop" aria-hidden="true" onClick={() => setOpen(false)}></div>
      <div className="app-shell container">
        <Sidebar route={route} isAdmin={isAdmin} series={series} onNavigate={go} />
        <div className="content">
          <main>{page}</main>
        </div>
      </div>
      <Footer />
    </>
  );
}
