// =========================================================
// Discord-сесія спільна для піддоменів thunderpw.fun (cookie на
// .thunderpw.fun, бекенд ладдера за /api — Caddy проксить його й на pvp).
// Сесію бекенд видає лише учаснику сервера клану з дозволеною роллю (та сама
// перевірка, що в ладдері й гільдії) — такий бачить увесь сайт; гість (null)
// бачить лише заявку й минулі турніри (app/access.ts). Адмінські права — окремо, через вхід
// Supabase (useAuth).
//
// /api/me питаємо ОДИН раз на завантаження сторінки: хук використовують і
// Layout, і форма заявки (підставити нік), тож проміс спільний.
// =========================================================

import { useCallback, useEffect, useState } from 'react';

export interface DiscordMe {
  playerId: string;
  nickname: string;
  avatarUrl: string | null;
}

let mePromise: Promise<DiscordMe | null> | null = null;

function loadMe(): Promise<DiscordMe | null> {
  mePromise ??= fetch('/api/me', { credentials: 'include' })
    .then((r) => (r.ok ? (r.json() as Promise<DiscordMe>) : null))
    .catch(() => null);
  return mePromise;
}

/** Куди повернути після входу: бекенд після Discord завжди веде на головну
 * ('/'), тож сторінку, з якої натиснули «Увійти», запам'ятовуємо тут. */
const RETURN_KEY = 'pvp-login-return';

/** Викликати ДО першого рендеру (main.tsx): якщо щойно повернулись із входу
 * на головну — підміняємо адресу на ту, з якої входили. */
export function restoreLoginReturn(): void {
  let saved: { path: string; at: number } | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(RETURN_KEY) ?? 'null');
    sessionStorage.removeItem(RETURN_KEY);
  } catch { /* сховище недоступне або сміття — лишаємось на головній */ }
  // Лише свіжа позначка (вхід через Discord — хвилина-дві) і лише свій шлях.
  if (!saved || typeof saved.path !== 'string' || Date.now() - saved.at > 10 * 60_000) return;
  if (!saved.path.startsWith('/') || saved.path.startsWith('//')) return;
  if (location.pathname !== import.meta.env.BASE_URL) return;
  // ?login=denied|error з бекенда зберігаємо — його покаже LoginNotice.
  const url = new URL(saved.path, location.origin);
  new URLSearchParams(location.search).forEach((v, k) => url.searchParams.set(k, v));
  history.replaceState(null, '', url.pathname + url.search);
}

/** Помилка входу з адреси (?login=denied|error) — читається один раз і
 * прибирається з адреси, щоб не висіла після оновлення сторінки. */
export function takeLoginError(): string | null {
  const p = new URLSearchParams(location.search);
  const v = p.get('login');
  if (!v) return null;
  p.delete('login');
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  if (v === 'denied') return 'Тебе немає на сервері клану в Discord або немає потрібної ролі — повний доступ лише для своїх. Заявку на турнір можна подати й без входу.';
  if (v === 'error') return 'Вхід через Discord не вдався. Спробуй ще раз.';
  return null;
}

export interface MeState {
  me: DiscordMe | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

export function useMe(): MeState {
  const [me, setMe] = useState<DiscordMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadMe().then((m) => {
      if (!alive) return;
      setMe(m);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const login = useCallback(() => {
    try {
      sessionStorage.setItem(RETURN_KEY, JSON.stringify({ path: location.pathname + location.search, at: Date.now() }));
    } catch { /* ok — повернемось на головну */ }
    location.href = '/api/auth/login';
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    location.reload();
  }, []);

  return { me, loading, login, logout };
}
