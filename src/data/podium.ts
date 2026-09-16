// =========================================================
// Чиста логіка п'єдесталу — без Supabase, щоб її можна було тестувати
// (і щоб підрахунок місць не залежав від шару даних).
// =========================================================

import type { BracketMatch } from './types';

/** Третє місце в подвійній елімінації: окремого матчу за бронзу там немає й
 * не потрібно — її однозначно визначає сітка. Програний ФІНАЛУ НИЖНЬОЇ
 * сітки і є третім: він вибув від того, хто пішов у гранд-фінал. */
export function thirdFromLosersFinal(matches: BracketMatch[]): string | null {
  const losers = matches.filter((m) => m.bracketSide === 'losers');
  if (losers.length === 0) return null;
  const maxRound = Math.max(...losers.map((m) => m.round));
  const final = losers.filter((m) => m.round === maxRound);
  // Фінал нижньої сітки — рівно один матч; якщо раптом ні, не вгадуємо.
  if (final.length !== 1 || !final[0].winnerId) return null;
  const { participant1Id, participant2Id, winnerId } = final[0];
  return (participant1Id === winnerId ? participant2Id : participant1Id) ?? null;
}
