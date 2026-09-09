// =========================================================
// pw-pvp: шар даних Supabase — серії, турніри, заявки.
// Сітка (bracket_matches) — окремо в data/bracket.ts (складніша логіка).
// =========================================================

import { supabase } from '../app/supabaseClient';
import {
  isRegistrationOpen,
  type ArmorRefine, type ArmorSet, type BalanceStats, type CharClass, type Gems, type Genie, type PlayerGear, type Registration,
  type RegistrationKind, type RegistrationStatus, type SpecialSet, type TeamMode, type Tournament, type TournamentSeries,
  type TournamentStatus, type Tract, type WeaponGrade, type WeaponRefine,
} from './types';

interface SeriesRow { id: string; slug: string; name: string; is_active: boolean; auto_weekday: number | null }
interface TournamentRow {
  id: string; series_id: string | null; name: string; event_date: string; status: TournamentStatus;
  rules_md: string | null; prizes_md: string | null; bracket_type: 'single_elim' | 'double_elim'; bracket_size: number | null;
  team_size: number | null; created_by: string | null; visibility: 'public' | 'unlisted'; third_place_match: boolean;
  bracket_new_look: boolean;
  // 0017 — до застосування міграції цих колонок немає, тому всі читання з fallback
  team_mode?: TeamMode | null; balance_seed?: string | null; bracket_seed?: string | null;
  balance_rules_version?: string | null; balance_stats?: BalanceStats | null;
}
interface RegistrationRow {
  id: string; tournament_id: string; nickname: string; rules_ack: boolean; status: RegistrationStatus; created_at: string;
  member_nicknames: string[] | null;
  // 0017
  kind?: RegistrationKind | null; team_registration_id?: string | null;
  char_class?: CharClass | null; weapon_grade?: WeaponGrade | null; weapon_refine?: WeaponRefine | null; weapon_pz?: boolean | null;
  armor_set?: ArmorSet | null; armor_refine?: ArmorRefine | null; gems?: Gems | null; special_sets?: SpecialSet[] | null; tract?: Tract | null; genie?: Genie | null;
  attack_level?: number | null; defense_level?: number | null;
}

const seriesFromRow = (r: SeriesRow): TournamentSeries => ({ id: r.id, slug: r.slug, name: r.name, isActive: r.is_active, autoWeekday: r.auto_weekday });
const tournamentFromRow = (r: TournamentRow): Tournament => ({
  id: r.id, seriesId: r.series_id, name: r.name, eventDate: r.event_date, status: r.status,
  rulesMd: r.rules_md, prizesMd: r.prizes_md, bracketType: r.bracket_type, bracketSize: r.bracket_size, teamSize: r.team_size,
  createdBy: r.created_by, visibility: r.visibility, thirdPlaceMatch: r.third_place_match, bracketNewLook: r.bracket_new_look,
  teamMode: r.team_mode ?? 'fixed', balanceSeed: r.balance_seed ?? null, bracketSeed: r.bracket_seed ?? null,
  balanceRulesVersion: r.balance_rules_version ?? null, balanceStats: r.balance_stats ?? null,
});
/** Анкета зібрана лише коли є всі 9 полів (constraint registrations_gear_all_or_none гарантує «або все, або нічого»). */
const gearFromRow = (r: RegistrationRow): PlayerGear | null => {
  if (!r.char_class || !r.weapon_grade || !r.weapon_refine || r.weapon_pz == null || !r.armor_set || !r.armor_refine || !r.gems || !r.tract || !r.genie) return null;
  return {
    charClass: r.char_class, weaponGrade: r.weapon_grade, weaponRefine: r.weapon_refine, weaponPz: r.weapon_pz,
    armorSet: r.armor_set, armorRefine: r.armor_refine, gems: r.gems, specialSets: r.special_sets ?? [], tract: r.tract, genie: r.genie,
  };
};
const registrationFromRow = (r: RegistrationRow): Registration => ({
  id: r.id, tournamentId: r.tournament_id, nickname: r.nickname, rulesAck: r.rules_ack, status: r.status, createdAt: r.created_at,
  memberNicknames: r.member_nicknames,
  kind: r.kind ?? 'player', teamRegistrationId: r.team_registration_id ?? null, gear: gearFromRow(r),
  attackLevel: r.attack_level ?? null, defenseLevel: r.defense_level ?? null,
});
const gearToRow = (g: PlayerGear) => ({
  char_class: g.charClass, weapon_grade: g.weaponGrade, weapon_refine: g.weaponRefine, weapon_pz: g.weaponPz,
  armor_set: g.armorSet, armor_refine: g.armorRefine, gems: g.gems, special_sets: g.specialSets, tract: g.tract, genie: g.genie,
});

export async function fetchSeries(): Promise<TournamentSeries[]> {
  const { data, error } = await supabase.from('tournament_series').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data as SeriesRow[]).map(seriesFromRow);
}

/** Для публічних сторінок (Головна/Турніри/Серії/дропдаун реєстрації) —
 * турніри ГМ-ів (visibility='unlisted') сюди не потрапляють, вони видимі
 * лише за прямим посиланням (fetchTournament(id)) або в адмінці власника. */
export async function fetchPublicTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase.from('tournaments').select('*').eq('visibility', 'public').order('event_date', { ascending: false });
  if (error) throw error;
  return (data as TournamentRow[]).map(tournamentFromRow);
}

/** Для адмінки: суперадмін бачить усі турніри, ГМ — лише свої (created_by). */
export async function fetchAdminTournaments(currentUserId: string, isSuperadmin: boolean): Promise<Tournament[]> {
  let query = supabase.from('tournaments').select('*').order('event_date', { ascending: false });
  if (!isSuperadmin) query = query.eq('created_by', currentUserId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as TournamentRow[]).map(tournamentFromRow);
}

/** Пряме посилання (/t/:id, /register?t=:id) — навмисно БЕЗ фільтра
 * visibility, інакше анонімний відвідувач за посиланням від ГМ-а нічого
 * не побачив би (RLS тут не розрізняє "з переліку" від "напряму за id"). */
export async function fetchTournament(id: string): Promise<Tournament | null> {
  const { data, error } = await supabase.from('tournaments').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? tournamentFromRow(data as TournamentRow) : null;
}

export async function fetchRegistrations(tournamentId: string): Promise<Registration[]> {
  const { data, error } = await supabase.from('registrations').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: true });
  if (error) throw error;
  return (data as RegistrationRow[]).map(registrationFromRow);
}

export async function submitRegistration(input: {
  tournamentId: string; nickname: string; rulesAck: boolean; memberNicknames?: string[];
  /** Балансний фул-рандом: анкета обов'язкова (RLS відхилить заявку без char_class). */
  gear?: PlayerGear; attackLevel?: number | null; defenseLevel?: number | null;
}): Promise<void> {
  // Свіжа перевірка прямо перед вставкою — стан на сторінці міг застаріти
  // (вкладка відкрита довго, адмін тим часом закрив реєстрацію чи турнір
  // уже пройшов). RLS-політика в БД теж це перевіряє, ця — для чистого
  // повідомлення користувачу замість "new row violates row-level security".
  const tournament = await fetchTournament(input.tournamentId);
  if (!tournament || !isRegistrationOpen(tournament)) {
    throw new Error('Реєстрація на цей турнір закрита або турнір уже пройшов.');
  }
  const { error } = await supabase.from('registrations').insert({
    tournament_id: input.tournamentId,
    nickname: input.nickname,
    rules_ack: input.rulesAck,
    member_nicknames: input.memberNicknames && input.memberNicknames.length > 0 ? input.memberNicknames : null,
    ...(input.gear ? { ...gearToRow(input.gear), attack_level: input.attackLevel ?? null, defense_level: input.defenseLevel ?? null } : {}),
  });
  if (error) throw error;
}

/** Адмінська правка анкети («✎» у панелі заявок) — update-політика 0006 пропускає власника турніру/суперадміна. */
export async function updateRegistrationGear(id: string, gear: PlayerGear, attackLevel: number | null, defenseLevel: number | null): Promise<void> {
  const { error } = await supabase.from('registrations').update({ ...gearToRow(gear), attack_level: attackLevel, defense_level: defenseLevel }).eq('id', id);
  if (error) throw error;
}

export async function setRegistrationStatus(id: string, status: RegistrationStatus): Promise<void> {
  const { error } = await supabase.from('registrations').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function deleteRegistration(id: string): Promise<void> {
  const { error } = await supabase.from('registrations').delete().eq('id', id);
  if (error) throw error;
}

// ── Admin CRUD: серії ──────────────────────────────────────
export async function createSeries(input: { slug: string; name: string; autoWeekday?: number | null }): Promise<void> {
  const { error } = await supabase.from('tournament_series').insert({ slug: input.slug, name: input.name, auto_weekday: input.autoWeekday ?? null });
  if (error) throw error;
}

export async function updateSeries(id: string, fields: { name?: string; isActive?: boolean; autoWeekday?: number | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (fields.name !== undefined) patch.name = fields.name;
  if (fields.isActive !== undefined) patch.is_active = fields.isActive;
  if (fields.autoWeekday !== undefined) patch.auto_weekday = fields.autoWeekday;
  const { error } = await supabase.from('tournament_series').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteSeries(id: string): Promise<void> {
  const { error } = await supabase.from('tournament_series').delete().eq('id', id);
  if (error) throw error;
}

// ── Admin CRUD: турніри ────────────────────────────────────
export interface TournamentInput {
  seriesId: string | null;
  name: string;
  eventDate: string;
  status: TournamentStatus;
  rulesMd: string;
  prizesMd: string;
  bracketType: 'single_elim' | 'double_elim';
  /** null/0/1 = звичайний турнір; >=2 = командний (стільки нікнеймів вимагає форма заявки). */
  teamSize: number | null;
  /** Спосіб формування команд — має значення лише при teamSize >= 2 (інакше зберігається 'fixed'). */
  teamMode: TeamMode;
  /** Матч за 3-тє місце — застосовується лише коли bracketType === 'single_elim'. */
  thirdPlaceMatch: boolean;
  /** Дзеркальний вигляд сітки замість колонок — застосовується лише коли bracketType === 'single_elim'. */
  bracketNewLook: boolean;
}

/** createdBy/visibility задаються один раз при створенні (не редагуються
 * пізніше) — ГМ завжди створює 'unlisted' турнір під власним user_id,
 * суперадмін — 'public'. Це вирішується на рівні виклику (TournamentEditor),
 * не тут, щоб data-шар не знав про ролі напряму. */
export async function createTournament(input: TournamentInput, owner: { createdBy: string; visibility: 'public' | 'unlisted' }): Promise<string> {
  const { data, error } = await supabase
    .from('tournaments')
    .insert({
      series_id: input.seriesId,
      name: input.name,
      event_date: input.eventDate,
      status: input.status,
      rules_md: input.rulesMd || null,
      prizes_md: input.prizesMd || null,
      bracket_type: input.bracketType,
      team_size: input.teamSize && input.teamSize >= 2 ? input.teamSize : null,
      team_mode: input.teamSize && input.teamSize >= 2 ? input.teamMode : 'fixed',
      third_place_match: input.bracketType === 'single_elim' && input.thirdPlaceMatch,
      bracket_new_look: input.bracketType !== 'single_elim' || input.bracketNewLook,
      created_by: owner.createdBy,
      visibility: owner.visibility,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function updateTournament(id: string, input: TournamentInput): Promise<void> {
  const { error } = await supabase
    .from('tournaments')
    .update({
      series_id: input.seriesId,
      name: input.name,
      event_date: input.eventDate,
      status: input.status,
      rules_md: input.rulesMd || null,
      prizes_md: input.prizesMd || null,
      bracket_type: input.bracketType,
      team_size: input.teamSize && input.teamSize >= 2 ? input.teamSize : null,
      team_mode: input.teamSize && input.teamSize >= 2 ? input.teamMode : 'fixed',
      third_place_match: input.bracketType === 'single_elim' && input.thirdPlaceMatch,
      bracket_new_look: input.bracketType !== 'single_elim' || input.bracketNewLook,
    })
    .eq('id', id);
  if (error) throw error;
}

/** Точкова зміна статусу (без переписування всіх інших полів турніру, на
 * відміну від updateTournament) — використовується і кнопкою "Завершити
 * турнір" в адмінці, і автозавершенням при переможці вирішального матчу. */
export async function setTournamentStatus(id: string, status: TournamentStatus): Promise<void> {
  const { error } = await supabase.from('tournaments').update({ status }).eq('id', id);
  if (error) throw error;
}

export async function deleteTournament(id: string): Promise<void> {
  const { error } = await supabase.from('tournaments').delete().eq('id', id);
  if (error) throw error;
}

/** Масово видаляє ВСІ турніри конкретного власника (напр. "очистити" за ГМ-ом
 * перед/після видалення його прав) — registrations/bracket_matches йдуть
 * каскадом (on delete cascade у схемі). Лише суперадмін пройде RLS для чужих. */
export async function deleteTournamentsByOwner(userId: string): Promise<void> {
  const { error } = await supabase.from('tournaments').delete().eq('created_by', userId);
  if (error) throw error;
}

let subscriberSeq = 0;

/** Живі оновлення: рефетч на будь-яку зміну турнірної частини схеми.
 * Кілька сторінок/компонентів підписуються одночасно (Layout — для сайдбару,
 * плюс кожна сторінка окремо) — кожному виклику потрібен СВІЙ унікальний
 * канал: Supabase-канали кешуються за назвою, і повторний `.on()` на вже
 * підписаному каналі з тим самим іменем кидає помилку. */
export function subscribeToTournamentChanges(onChange: () => void): () => void {
  const channel = supabase
    .channel(`tournaments-changes-${++subscriberSeq}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_series' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'bracket_matches' }, onChange)
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
