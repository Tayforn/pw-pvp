// =========================================================
// Шапка сайту: тогл меню, лого, партнер, тема, вхід через Discord.
// Посилання на сусідні сайти клану (ладдер/хелпер/гільдія) — лише для тих,
// хто увійшов: гість приходить сюди подати заявку, решта йому ні до чого.
// =========================================================

import { routeUrl } from '../app/useRoute';

interface Props {
  navOpen: boolean;
  onNavToggle: () => void;
  /** Discord-сесія (спільна на піддомени); undefined — ще перевіряємо. */
  me: { nickname: string } | null | undefined;
  /** Показувати посилання на сусідні сайти (увійшов через Discord або адмін). */
  showSiblings: boolean;
  onLogin: () => void;
  onLogout: () => void;
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

export default function Header({ navOpen, onNavToggle, me, showSiblings, onLogin, onLogout }: Props) {
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
        <span className="header-links">
          {showSiblings && (
            <>
              <a href="https://ladder.thunderpw.fun/" className="btn btn-ghost btn-sm" title="Ладдер страждання">Ладдер</a>
              <a href="https://calc.thunderpw.fun/" className="btn btn-ghost btn-sm" title="PW Хелпер — калькулятори">Хелпер</a>
              <a href="https://guild.thunderpw.fun/" className="btn btn-ghost btn-sm" title="Гільдія">Гільдія</a>
            </>
          )}
          {me === undefined ? null : me ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout} title="Вийти з Discord">
              {me.nickname} ✕
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onLogin} title="Вхід через Discord для учасників клану">
              Увійти
            </button>
          )}
        </span>
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
