// =========================================================
// pw-pvp: агреговані дані учасників по НІКУ — реєстрації немає окремої
// таблиці "гравець", тому нік і є ідентичністю (як і скрізь по коду:
// Podium/чемпіон теж прив'язані до ніка, не до registration.id).
// =========================================================

import { supabase } from '../app/supabaseClient';
import { fetchPodium } from './bracket';

export interface ParticipantStat {
  nickname: string;
  registrations: number;
  wins: number;
  second: number;
  third: number;
}

/** Учасники по всіх турнірах (і серійних, і одноразових, і чужих ГМ-івських —
 * RLS сам обмежить видимість реєстрацій/сітки до того, що бачить поточний
 * адмін, так само як і для fetchAdminTournaments). */
export async function fetchParticipantStats(): Promise<ParticipantStat[]> {
  const [{ data: regsData, error: regsErr }, { data: tData, error: tErr }] = await Promise.all([
    supabase.from('registrations').select('nickname'),
    supabase.from('tournaments').select('id'),
  ]);
  if (regsErr) throw regsErr;
  if (tErr) throw tErr;

  const registrations = new Map<string, number>();
  for (const r of regsData as { nickname: string }[]) {
    registrations.set(r.nickname, (registrations.get(r.nickname) ?? 0) + 1);
  }

  const podiums = await Promise.all((tData as { id: string }[]).map((t) => fetchPodium(t.id)));
  const wins = new Map<string, number>();
  const second = new Map<string, number>();
  const third = new Map<string, number>();
  for (const p of podiums) {
    if (!p) continue;
    wins.set(p.first, (wins.get(p.first) ?? 0) + 1);
    if (p.second) second.set(p.second, (second.get(p.second) ?? 0) + 1);
    if (p.third) third.set(p.third, (third.get(p.third) ?? 0) + 1);
  }

  const nicknames = new Set<string>([...registrations.keys(), ...wins.keys(), ...second.keys(), ...third.keys()]);
  return Array.from(nicknames, (nickname) => ({
    nickname,
    registrations: registrations.get(nickname) ?? 0,
    wins: wins.get(nickname) ?? 0,
    second: second.get(nickname) ?? 0,
    third: third.get(nickname) ?? 0,
  })).sort(
    (a, b) =>
      b.wins - a.wins ||
      b.second + b.third - (a.second + a.third) ||
      b.registrations - a.registrations ||
      a.nickname.localeCompare(b.nickname),
  );
}

/** Перейменування учасника — усі його реєстрації (по всіх турнірах) міняють
 * нік разом. Якщо цільовий нік уже належить іншому учаснику — це й є
 * об'єднання: після перейменування обидва збираються в один рядок статистики
 * на наступному fetchParticipantStats(). */
export async function renameParticipant(oldNickname: string, newNickname: string): Promise<void> {
  const trimmed = newNickname.trim();
  if (!trimmed || trimmed === oldNickname) return;
  const { error } = await supabase.from('registrations').update({ nickname: trimmed }).eq('nickname', oldNickname);
  if (error) throw error;
}
