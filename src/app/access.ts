// =========================================================
// Рівні доступу до розділів (як у гільдії, thunder-info):
//
//  * public — бачать усі, і без входу: заявка на турнір, правила (форма
//    заявки посилається на них), список минулих турнірів, окреме посилання
//    на сітку (/t/:id/bracket), лялька персонажа (/characters — поки це
//    локальна чернетка в браузері, збереження в профіль буде з входом);
//  * member — увійшов через Discord — або адмін: головна, поточні турніри,
//    серії. Перевірку робить спільний бекенд ладдера при вході: учасник
//    сервера клану (DISCORD_GUILD_ID) з дозволеною роллю
//    (DISCORD_ALLOWED_ROLE_IDS) і не в бані — ті самі правила, що в ладдері
//    й гільдії. Не пройшов — сесії немає, /api/me → 401, тобто гість;
//  * admin  — сторінка адмінки має власну форму входу Supabase (AdminPage),
//    тож маршрут відкритий, а пункт меню бачить лише адмін.
//
// Сторінка турніру (/t/:id) — окремий випадок: минулий турнір відкритий
// усім, поточний гість бачить лише шапку, правила й кнопку заявки
// (TournamentPage, prop `guest`).
//
// Це гейт інтерфейсу, як і в гільдії: сайт і так показував ці дані
// публічно, а заявки подаються анонімно.
// =========================================================

import type { Route } from './useRoute';

export type AccessLevel = 'public' | 'member' | 'admin';

export const ROUTE_ACCESS: Record<Route['name'], AccessLevel> = {
  home: 'member',
  tournaments: 'public',
  register: 'public',
  rules: 'public',
  tournament: 'public',
  'tournament-bracket': 'public',
  series: 'member',
  admin: 'admin',
  'dev-bracket': 'public',
  characters: 'public',
  character: 'public',
};

export interface Viewer {
  /** Увійшов через Discord (спільна сесія thunderpw.fun). */
  member: boolean;
  /** Адміністратор (сесія Supabase в allow-list). */
  admin: boolean;
}

export function canOpen(name: Route['name'], v: Viewer): boolean {
  const need = ROUTE_ACCESS[name];
  if (need === 'public') return true;
  if (need === 'admin') return v.admin;
  return v.member || v.admin;
}

/** Повний перегляд поточних турнірів — учасник клану або адмін. */
export function isInsider(v: Viewer): boolean {
  return v.member || v.admin;
}
