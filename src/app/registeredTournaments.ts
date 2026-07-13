// =========================================================
// Клієнтська позначка "з цього браузера вже подано заявку на турнір X" —
// доповнює (не замінює!) серверний unique-індекс на (tournament_id,
// lower(nickname)): той блокує лише повтор ТОГО САМОГО нікнейму, а це —
// створення ЩЕ ОДНІЄЇ заявки з іншим нікнеймом з того самого браузера.
// =========================================================

const KEY = 'pwpvp-registered';

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function hasRegistered(tournamentId: string): boolean {
  return readSet().has(tournamentId);
}

export function markRegistered(tournamentId: string): void {
  const set = readSet();
  set.add(tournamentId);
  try {
    localStorage.setItem(KEY, JSON.stringify(Array.from(set)));
  } catch {
    /* сховище недоступне (приватний режим тощо) — не критично, це лише допоміжна перевірка */
  }
}
