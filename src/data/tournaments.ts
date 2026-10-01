// =========================================================
// pw-pvp: шар даних Supabase — серії, турніри, заявки.
// Сітка (bracket_matches) — окремо в data/bracket.ts (складніша логіка).
// =========================================================

import { supabase } from '../app/supabaseClient';
import {
  isRegistrationOpen,
  type ArmorRefine, type ArmorSet, type BalanceStats, type DollPower, type Build, type CharClass, type CharLevel, type Gems, type ItemBreakdown, type ItemBreakdownRow, type RingGrade, type Genie, type PlayerGear, type Registration,
  type RegistrationKind, type RegistrationStatus, type SpecialSet, type TeamMode, type Tournament, type TournamentSeries,
  type TournamentStatus, type Tract, type WeaponGrade, type WeaponRefine,
} from './types';
import { normalizeGemCounts } from './gearRules';
import { normalizeRuleFlags, type TournamentRuleFlags } from './ruleFlags';

interface SeriesRow { id: string; slug: string; name: string; is_active: boolean; auto_weekday: number | null }
interface TournamentRow {
  id: string; series_id: string | null; name: string; event_date: string; status: TournamentStatus;
  rules_md: string | null; prizes_md: string | null; bracket_type: 'single_elim' | 'double_elim'; bracket_size: number | null;
  team_size: number | null; created_by: string | null; visibility: 'public' | 'unlisted'; third_place_match: boolean;
  bracket_new_look: boolean;
  // 0017 — до застосування міграції цих колонок немає, тому всі читання з fallback
  team_mode?: TeamMode | null; balance_seed?: string | null; bracket_seed?: string | null;
  balance_rules_version?: string | null; balance_stats?: BalanceStats | null;
  // 0027 — правила рядками; до міграції колонок немає
  rule_flags?: unknown; rule_flags_updated_at?: string | null;
}
export interface RegistrationRow {
  id: string; tournament_id: string; nickname: string; rules_ack: boolean; status: RegistrationStatus; created_at: string;
  member_nicknames: string[] | null;
  // 0017
  kind?: RegistrationKind | null; team_registration_id?: string | null;
  char_class?: CharClass | null; weapon_grade?: WeaponGrade | null; weapon_refine?: WeaponRefine | null; weapon_pz?: boolean | null;
  armor_set?: ArmorSet | null; armor_refine?: ArmorRefine | null; gems?: Gems | null; special_sets?: SpecialSet[] | null;
  special_set_gems?: Partial<Record<SpecialSet, Gems>> | null; tract?: Tract | null; genie?: Genie | null;
  attack_level?: number | null; defense_level?: number | null;
  // 0023
  shg?: boolean | null; shg_refine?: number | null; voznes?: boolean | null; voznes_refine?: number | null;
  // 0024
  char_level?: CharLevel | null;
  // 0025
  build?: Build | null;
  // 0026
  ring1?: RingGrade | null; ring1_refine?: number | null; ring2?: RingGrade | null; ring2_refine?: number | null;
  // 0028
  character_id?: string | null; character_rev?: number | null; character_snapshot?: unknown; doll_confirmed_at?: string | null;
  // 0029
  doll_power?: DollPower | null;
  // 0032 — numeric PostgREST віддає числом, але страхуємось і від рядка
  item_points?: number | string | null; item_breakdown?: unknown;
}
/** Корекція адміна — окрема таблиця з адмінським RLS (0021): анонімному
 * читачу повертається порожньо, у Registration тоді 0 / null. */
interface AdjustmentRow { registration_id: string; score_adjust: number; note: string | null }
type Adjustments = Map<string, AdjustmentRow>;

const seriesFromRow = (r: SeriesRow): TournamentSeries => ({ id: r.id, slug: r.slug, name: r.name, isActive: r.is_active, autoWeekday: r.auto_weekday });
const tournamentFromRow = (r: TournamentRow): Tournament => ({
  id: r.id, seriesId: r.series_id, name: r.name, eventDate: r.event_date, status: r.status,
  rulesMd: r.rules_md, prizesMd: r.prizes_md, bracketType: r.bracket_type, bracketSize: r.bracket_size, teamSize: r.team_size,
  createdBy: r.created_by, visibility: r.visibility, thirdPlaceMatch: r.third_place_match, bracketNewLook: r.bracket_new_look,
  teamMode: r.team_mode ?? 'fixed', balanceSeed: r.balance_seed ?? null, bracketSeed: r.bracket_seed ?? null,
  balanceRulesVersion: r.balance_rules_version ?? null, balanceStats: r.balance_stats ?? null,
  ruleFlags: normalizeRuleFlags(r.rule_flags), ruleFlagsUpdatedAt: r.rule_flags_updated_at ?? null,
});
/** Анкета зібрана лише коли є всі 9 полів (constraint registrations_gear_all_or_none гарантує «або все, або нічого»). */
const gearFromRow = (r: RegistrationRow): PlayerGear | null => {
  if (!r.char_class || !r.weapon_grade || !r.weapon_refine || r.weapon_pz == null || !r.armor_set || !r.armor_refine || !r.gems || !r.tract || !r.genie) return null;
  return {
    charClass: r.char_class, charLevel: r.char_level ?? null, build: r.build ?? null, weaponGrade: r.weapon_grade, weaponRefine: r.weapon_refine, weaponPz: r.weapon_pz,
    armorSet: r.armor_set, armorRefine: r.armor_refine, gems: r.gems, specialSets: r.special_sets ?? [],
    specialSetGems: r.special_set_gems && typeof r.special_set_gems === 'object' ? r.special_set_gems : {}, tract: r.tract, genie: r.genie,
    // до 0023 колонок не було — «немає шмотки»
    shg: !!r.shg, shgRefine: r.shg ? r.shg_refine ?? 0 : null,
    voznes: !!r.voznes, voznesRefine: r.voznes ? r.voznes_refine ?? 0 : null,
    // до 0026 колонок не було — «кілець не вказано»
    ring1: r.ring1 ?? null, ring1Refine: r.ring1 === 'r9r1' ? r.ring1_refine ?? 0 : null,
    ring2: r.ring2 ?? null, ring2Refine: r.ring2 === 'r9r1' ? r.ring2_refine ?? 0 : null,
  };
};
/** Сила з ляльки лише коли обидва числа додатні — інакше скор з ляльки не рахуємо. */
const validPower = (p: unknown): DollPower | null => {
  if (!p || typeof p !== 'object') return null;
  const o = p as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (!(n(o.off) > 0 && n(o.def) > 0)) return null;
  const gems = normalizeGemCounts(o.gems);
  const abil = typeof o.abil === 'string' && /^[a-z_]{1,32}$/.test(o.abil) ? o.abil : undefined;
  const opt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const wpa = opt(o.wpa);
  const pzw = opt(o.pzw);
  return {
    off: n(o.off), def: n(o.def), pa: n(o.pa), pz: n(o.pz), engine: n(o.engine),
    ...(gems ? { gems } : {}), ...(abil ? { abil } : {}), ...(wpa !== undefined ? { wpa } : {}), ...(pzw !== undefined ? { pzw } : {}),
  };
};
/** Бали за речі (0032, numeric(7,2)): число або рядок з числом; до міграції колонки
 * немає (undefined), зламане чи від'ємне — null: скор тоді табличний. */
const itemPointsOf = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};
/** Розклад лише коли форма ціла (v 1, версія шкали, складові-числа, рядки-кортежі) —
 * інакше null, як validPower: itemPoints від цього не залежить. */
const validBreakdown = (b: unknown): ItemBreakdown | null => {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  if (o.v !== 1 || typeof o.ver !== 'string' || !o.sum || typeof o.sum !== 'object' || !Array.isArray(o.rows)) return null;
  const s = o.sum as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const optNum = (v: unknown) => v === undefined || num(v);
  if (!num(s.main) || !num(s.sets) || !num(s.setsRaw) || !num(s.pair) || !optNum(s.cls) || !optNum(s.lvl) || !optNum(s.genie)) return null;
  const rows: ItemBreakdownRow[] = [];
  for (const raw of o.rows as unknown[]) {
    if (!Array.isArray(raw) || raw.length < 4 || raw.length > 5) return null;
    const [cfg, slot, catId, points, why] = raw as unknown[];
    if (!num(cfg) || typeof slot !== 'string' || !num(catId) || !num(points) || (why !== undefined && typeof why !== 'string')) return null;
    rows.push(why === undefined ? [cfg, slot, catId, points] : [cfg, slot, catId, points, why]);
  }
  const warn = Array.isArray(o.warn) ? (o.warn as unknown[]).filter((w): w is string => typeof w === 'string') : undefined;
  return {
    v: 1, ver: o.ver,
    sum: {
      ...(num(s.cls) ? { cls: s.cls } : {}), ...(num(s.lvl) ? { lvl: s.lvl } : {}), ...(num(s.genie) ? { genie: s.genie } : {}),
      main: s.main, sets: s.sets, setsRaw: s.setsRaw, pair: s.pair,
    },
    rows,
    ...(warn ? { warn } : {}),
    // «перевірено» — лише справжнє true (ставить перерахунок в адмінці)
    ...(o.checked === true ? { checked: true } : {}),
  };
};
/** Експортовано для тесту маппінгу (колонок 0032 до міграції немає → null). */
export const registrationFromRow = (r: RegistrationRow, adj?: Adjustments): Registration => {
  const a = adj?.get(r.id);
  return {
    id: r.id, tournamentId: r.tournament_id, nickname: r.nickname, rulesAck: r.rules_ack, status: r.status, createdAt: r.created_at,
    memberNicknames: r.member_nicknames,
    kind: r.kind ?? 'player', teamRegistrationId: r.team_registration_id ?? null, gear: gearFromRow(r),
    attackLevel: r.attack_level ?? null, defenseLevel: r.defense_level ?? null,
    scoreAdjust: a?.score_adjust ?? 0, scoreAdjustNote: a?.note ?? null,
    characterId: r.character_id ?? null, characterRev: r.character_rev ?? null,
    characterSnapshot: r.character_snapshot ?? null, dollConfirmedAt: r.doll_confirmed_at ?? null,
    dollPower: validPower(r.doll_power),
    itemPoints: itemPointsOf(r.item_points), itemBreakdown: validBreakdown(r.item_breakdown),
  };
};
const gearToRow = (g: PlayerGear) => ({
  char_class: g.charClass, char_level: g.charLevel, build: g.build, weapon_grade: g.weaponGrade, weapon_refine: g.weaponRefine, weapon_pz: g.weaponPz,
  armor_set: g.armorSet, armor_refine: g.armorRefine, gems: g.gems, special_sets: g.specialSets, special_set_gems: g.specialSetGems,
  tract: g.tract, genie: g.genie,
  shg: g.shg, shg_refine: g.shg ? g.shgRefine ?? 0 : null,
  voznes: g.voznes, voznes_refine: g.voznes ? g.voznesRefine ?? 0 : null,
  ring1: g.ring1, ring1_refine: g.ring1 === 'r9r1' ? g.ring1Refine ?? 0 : null,
  ring2: g.ring2, ring2_refine: g.ring2 === 'r9r1' ? g.ring2Refine ?? 0 : null,
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

async function fetchAdjustments(tournamentId: string): Promise<Adjustments> {
  const { data, error } = await supabase.from('registration_adjustments').select('registration_id, score_adjust, note').eq('tournament_id', tournamentId);
  if (error) {
    // До застосування міграції 0021 таблиці немає (PGRST205 / 42P01) —
    // публічні сторінки від цього падати не повинні; решта помилок — нагору.
    if (/PGRST205|42P01/.test(error.code ?? '')) { console.warn('registration_adjustments: таблиці ще немає (міграція 0021)'); return new Map(); }
    throw error;
  }
  return new Map((data as AdjustmentRow[]).map((a) => [a.registration_id, a] as const));
}

export async function fetchRegistrations(tournamentId: string): Promise<Registration[]> {
  const [{ data, error }, adj] = await Promise.all([
    supabase.from('registrations').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: true }),
    fetchAdjustments(tournamentId),
  ]);
  if (error) throw error;
  return (data as RegistrationRow[]).map((r) => registrationFromRow(r, adj));
}

export async function submitRegistration(input: {
  tournamentId: string; nickname: string; rulesAck: boolean; memberNicknames?: string[];
  /** Балансний фул-рандом: анкета обов'язкова (RLS відхилить заявку без char_class). */
  gear?: PlayerGear; attackLevel?: number | null; defenseLevel?: number | null;
  /** Заявка персонажем із ляльки: хто, яка ревізія, знімок документа (0028).
   * itemPoints/itemBreakdown (0032, скор v2) — undefined = колонки не чіпати (до
   * міграції їх немає, insert із ними впав би); null — явно порожньо. */
  character?: { id: string; revision: number; snapshot: unknown; power: DollPower | null; itemPoints?: number | null; itemBreakdown?: ItemBreakdown | null };
}): Promise<void> {
  // Свіжа перевірка прямо перед вставкою — стан на сторінці міг застаріти
  // (вкладка відкрита довго, адмін тим часом закрив реєстрацію чи турнір
  // уже пройшов). RLS-політика в БД теж це перевіряє, ця — для чистого
  // повідомлення користувачу замість "new row violates row-level security".
  const tournament = await fetchTournament(input.tournamentId);
  if (!tournament || !isRegistrationOpen(tournament)) {
    throw new Error('Реєстрація на цей турнір закрита або турнір уже пройшов.');
  }
  const row: Record<string, unknown> = {
    tournament_id: input.tournamentId,
    nickname: input.nickname,
    rules_ack: input.rulesAck,
    member_nicknames: input.memberNicknames && input.memberNicknames.length > 0 ? input.memberNicknames : null,
    ...(input.gear ? { ...gearToRow(input.gear), attack_level: input.attackLevel ?? null, defense_level: input.defenseLevel ?? null } : {}),
    // Лише для заявки персонажем — звичайна анкета не пише нових колонок і працює й до 0028.
    ...(input.character
      ? {
          character_id: input.character.id, character_rev: input.character.revision, character_snapshot: input.character.snapshot,
          doll_confirmed_at: new Date().toISOString(),
          ...(input.character.power ? { doll_power: input.character.power } : {}),
          // 0032 — лише коли передано: заявка, що ще не рахує скор v2, працює й до міграції.
          ...(input.character.itemPoints !== undefined ? { item_points: input.character.itemPoints } : {}),
          ...(input.character.itemBreakdown !== undefined ? { item_breakdown: input.character.itemBreakdown } : {}),
        }
      : {}),
  };
  let { error } = await supabase.from('registrations').insert(row);
  // Запасний шлях до міграції 0032 (її виконує власник у SQL Editor): колонок
  // item_points/item_breakdown ще немає, і PostgREST відкидає insert. Один раз
  // повторюємо без них — заявка проходить, скор рахується таблицею з анкети
  // (registrationScore без itemPoints). Після міграції сюди не заходить.
  if (error && ('item_points' in row || 'item_breakdown' in row) && isMissingColumnError(error)) {
    console.warn('registrations: колонок 0032 ще немає — заявка без item_points/item_breakdown (виконайте міграцію)');
    const legacy = { ...row };
    delete legacy.item_points;
    delete legacy.item_breakdown;
    ({ error } = await supabase.from('registrations').insert(legacy));
  }
  if (error) throw error;
}

/** Помилка «колонки немає»: PostgREST не знайшов її в кеші схеми (PGRST204),
 * Postgres — undefined_column (42703), або текст згадує колонку 0032. */
export function isMissingColumnError(e: { code?: string | null; message?: string | null }): boolean {
  const code = e.code ?? '';
  const msg = e.message ?? '';
  return code === 'PGRST204' || code === '42703' || (/item_points|item_breakdown/.test(msg) && /column/i.test(msg));
}

/** Перерахунок скору v2 зі знімка в адмінці (0032): update-політика 0006 пропускає
 * власника турніру/суперадміна й колонки не обмежує. null — стерти обидва (скор
 * знову табличний, з анкети). До міграції 0032 — зрозуміла помилка замість «column … does not exist». */
export async function updateRegistrationItemPoints(id: string, itemPoints: number | null, itemBreakdown: ItemBreakdown | null): Promise<void> {
  const { error } = await supabase.from('registrations').update({ item_points: itemPoints, item_breakdown: itemBreakdown }).eq('id', id);
  if (error && isMissingColumnError(error)) throw new Error('Колонок item_points / item_breakdown ще немає — спершу виконайте міграцію 0032.');
  if (error) throw error;
}

/** Адмінська правка анкети («✎» у панелі заявок) — update-політика 0006 пропускає власника турніру/суперадміна. */
export async function updateRegistrationGear(id: string, gear: PlayerGear, attackLevel: number | null, defenseLevel: number | null): Promise<void> {
  const { error } = await supabase.from('registrations').update({ ...gearToRow(gear), attack_level: attackLevel, defense_level: defenseLevel }).eq('id', id);
  if (error) throw error;
}

/** Ручна корекція скору (± бали) з причиною — лише адмін (0021). */
/** Корекція адміна: 0 без причини — рядок видаляється (корекції немає), інакше upsert. */
export async function updateRegistrationAdjust(id: string, tournamentId: string, adjust: number, note: string): Promise<void> {
  const a = Math.max(-100, Math.min(100, Math.round(adjust)));
  const n = note.trim() || null;
  const { error } = a === 0 && !n
    ? await supabase.from('registration_adjustments').delete().eq('registration_id', id)
    : await supabase.from('registration_adjustments').upsert({ registration_id: id, tournament_id: tournamentId, score_adjust: a, note: n }, { onConflict: 'registration_id' });
  if (error) throw error;
}

/** Літерал для like/ilike: `%`, `_`, `\` і `*` (PostgREST міняє його на `%`)
 * у ніку — символи, а не шаблон. Інакше «Dark_Lord» підтягнув би анкету
 * «Dark-Lord». */
export function likePattern(s: string): string {
  return s.replace(/[\\%_*]/g, (c) => '\\' + c);
}

/** Остання анкета гравця з попередніх заявок (за ніком, без урахування регістру) —
 * щоб на новий турнір не вводити все заново. Гравець без акаунта, тож це
 * просто підказка: форма підтягує значення, людина перевіряє. */
export async function fetchLastGearByNickname(nickname: string): Promise<{ gear: PlayerGear; attackLevel: number | null; defenseLevel: number | null; tournamentName: string | null; eventDate: string | null } | null> {
  const nick = nickname.trim();
  if (!nick) return null;
  const { data, error } = await supabase
    .from('registrations')
    .select('*, tournaments(name, event_date)')
    .eq('kind', 'player')
    .ilike('nickname', likePattern(nick))
    .not('char_class', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as RegistrationRow & { tournaments?: { name: string; event_date: string } | null };
  const gear = gearFromRow(row);
  if (!gear) return null;
  return { gear, attackLevel: row.attack_level ?? null, defenseLevel: row.defense_level ?? null, tournamentName: row.tournaments?.name ?? null, eventDate: row.tournaments?.event_date ?? null };
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
  /** Правила рядками (0027). undefined — колонку не чіпати (до міграції збереження
   * без правил не має падати на «column rule_flags does not exist»); null — очистити. */
  ruleFlags?: TournamentRuleFlags | null;
}

const ruleFlagsPatch = (input: TournamentInput): { rule_flags?: TournamentRuleFlags | null } =>
  input.ruleFlags !== undefined ? { rule_flags: input.ruleFlags } : {};

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
      ...ruleFlagsPatch(input),
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
      ...ruleFlagsPatch(input),
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
