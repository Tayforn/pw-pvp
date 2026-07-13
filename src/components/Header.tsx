// =========================================================
// Шапка сайту: тогл меню, лого, партнер, тема.
// =========================================================

import { routeUrl } from '../app/useRoute';

interface Props {
  navOpen: boolean;
  onNavToggle: () => void;
}

function toggleTheme(): void {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try {
    localStorage.setItem('pw-theme', next);
  } catch {
    /* ignore */
  }
}

export default function Header({ navOpen, onNavToggle }: Props) {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <button
          type="button"
          className="nav-toggle"
          aria-label="Показати або сховати меню"
          aria-expanded={navOpen}
          aria-controls="appSidebar"
          title="Меню"
          onClick={onNavToggle}
        >
          <span className="nav-toggle-bars"></span>
        </button>
        <a href={routeUrl({ name: 'home' })} data-goto="home" className="logo">
          <span className="logo-crest" aria-hidden="true">
            <img src={import.meta.env.BASE_URL + 'assets/favicon-180.png'} alt="" width={180} height={180} />
          </span>
          <span className="logo-text">PvP</span>
        </a>
        <a href="https://cyberpw.fun/" target="_blank" rel="noopener" className="partner-logo" title="cyberpw.fun">
          <img src={import.meta.env.BASE_URL + 'assets/logo.webp'} alt="CyberPW" />
        </a>
        <button
          type="button"
          className="theme-toggle"
          aria-label="Перемкнути тему"
          title="Світла / темна тема"
          onClick={toggleTheme}
        >
          <span className="theme-ico-sun" aria-hidden="true">☀</span>
          <span className="theme-ico-moon" aria-hidden="true">☾</span>
        </button>
      </div>
    </header>
  );
}
