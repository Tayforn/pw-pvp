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

/** Зарахувати місце: згенерованій команді фул-рандому (є склад) — кожному
 * її гравцю, інакше (соло / готова команда) — на назву заявки, як і було. */
function credit(map: Map<string, number>, nickname: string, members: string[] | null): void {
  const list = members && members.length > 0 ? members : [nickname];
  for (const n of list) map.set(n, (map.get(n) ?? 0) + 1);
}

/** Учасники по всіх турнірах (і серійних, і одноразових, і чужих ГМ-івських —
 * RLS сам обмежить видимість реєстрацій/сітки до того, що бачить поточний
 * адмін, так само як і для fetchAdminTournaments). */
export async function fetchParticipantStats(): Promise<ParticipantStat[]> {
  const [{ data: regsData, error: regsErr }, { data: tData, error: tErr }] = await Promise.all([
    // select('*') замість переліку колонок — до міграції 0017 колонки kind немає,
    // а явний select з нею повертає 400 (вкладка «Учасники» не має від цього падати).
    supabase.from('registrations').select('*'),
    supabase.from('tournaments').select('id'),
  ]);
  if (regsErr) throw regsErr;
  if (tErr) throw tErr;

  const registrations = new Map<string, number>();
  for (const r of regsData as { nickname: string; kind?: 'player' | 'team' | null }[]) {
    // Згенеровані команди фул-рандому — не учасники (рядки без kind — старі, гравці).
    if (r.kind === 'team') continue;
    registrations.set(r.nickname, (registrations.get(r.nickname) ?? 0) + 1);
  }

  const podiums = await Promise.all((tData as { id: string }[]).map((t) => fetchPodium(t.id)));
  const wins = new Map<string, number>();
  const second = new Map<string, number>();
  const third = new Map<string, number>();
  for (const p of podiums) {
    if (!p) continue;
    credit(wins, p.first, p.members.first);
    if (p.second) credit(second, p.second, p.members.second);
    if (p.third) credit(third, p.third, p.members.third);
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
 * на наступному fetchParticipantStats().
 *
 * Team-рядки фул-рандому (kind='team') не чіпаємо за ніком (їхній нік — назва
 * команди), але їхній кеш складу member_nicknames (з нього сітка бере
 * підказку) теж перейменовуємо, щоб не застарів. Подіум/статистика склад
 * беруть з player-рядків за team_registration_id, тож там усе підхопиться само. */
export async function renameParticipant(oldNickname: string, newNickname: string): Promise<void> {
  const trimmed = newNickname.trim();
  if (!trimmed || trimmed === oldNickname) return;
  const { error } = await supabase.from('registrations').update({ nickname: trimmed }).eq('nickname', oldNickname).eq('kind', 'player');
  if (error) throw error;

  const { data, error: teamsErr } = await supabase
    .from('registrations')
    .select('id, member_nicknames')
    .eq('kind', 'team')
    .contains('member_nicknames', [oldNickname]);
  if (teamsErr) throw teamsErr;
  for (const team of (data ?? []) as { id: string; member_nicknames: string[] | null }[]) {
    const renamed = (team.member_nicknames ?? []).map((n) => (n === oldNickname ? trimmed : n));
    const { error: updErr } = await supabase.from('registrations').update({ member_nicknames: renamed }).eq('id', team.id);
    if (updErr) throw updErr;
  }
}
