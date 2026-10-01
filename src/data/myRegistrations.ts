// =========================================================
// Шлях гравця: свої заявки та їхній статус — «на розгляді / підтверджено /
// відхилено (причина) / вибув», а після жеребки — своя команда (назва, склад).
//
// Свою заявку знаходимо за id, які браузер запамʼятав при подачі
// (app/registeredTournaments.ts), а того, хто увійшов через Discord, — ще й за
// id його персонажів (заявка персонажем з будь-якого пристрою). Записи без id
// (старий формат — лише турнір; або id після прямого insert не вдалося
// дізнатись) — за ніком запису, а без нього — за останнім ніком (app/lastNickname.ts).
// Читання заявок публічне (0001), тож усе це працює й для гостя.
//
// Збіг лише за character_id (без id цього браузера) — не доказ, що заявка своя:
// до міграції 0034 прямий insert анонімним ключем міг підставити чужий
// character_id. Такі заявки показуємо («Мої заявки», картка над формою), але
// подати свою вони не заважають (registerGate, reapplyBasis).
//
// Тут — чисті правила (статус, своя заявка, повторна подача) і завантаження
// для «Моїх заявок» та сторінки заявки; сторінка турніру бере заявки, які вже
// завантажила (useTournamentLive), і рахує те саме локально.
// =========================================================

import type { RegistrationRef } from '../app/registeredTournaments';
import {
  fetchOwnRegistrations, fetchRegistrationsByNickname, fetchTeamsLite, fetchTournamentsByIds,
  type TeamLite, type TeamMemberLite,
} from './tournaments';
import { isRegistrationOpen, type Registration, type Tournament } from './types';

export type { TeamLite, TeamMemberLite };

export type PlayerStatusKey = 'pending' | 'confirmed' | 'rejected' | 'out';

export interface PlayerStatusView {
  key: PlayerStatusKey;
  /** «на розгляді» / «підтверджено» / «відхилено» / «вибув». */
  label: string;
  tone: 'warn' | 'good' | 'bad';
  /** Підтверджений, команди сформовано, а його в жодну не взяли — резерв. */
  reserve: boolean;
}

const LABEL: Record<PlayerStatusKey, string> = { pending: 'на розгляді', confirmed: 'підтверджено', rejected: 'відхилено', out: 'вибув' };
const TONE: Record<PlayerStatusKey, PlayerStatusView['tone']> = { pending: 'warn', confirmed: 'good', rejected: 'bad', out: 'bad' };

/** Статус заявки для гравця. Вибулий після заміни (RPC substitute_team_member ставить
 * rejected) — «вибув», як в адмінці; резерв — підтверджений поза сформованими командами. */
export function playerStatus(
  reg: Pick<Registration, 'id' | 'status' | 'teamRegistrationId'>,
  tournament: Pick<Tournament, 'balanceStats'> | null,
): PlayerStatusView {
  const stats = tournament?.balanceStats ?? null;
  const out = reg.status === 'rejected' && !!stats?.substitutions?.some((s) => s.out === reg.id);
  const key: PlayerStatusKey = out ? 'out' : reg.status;
  const reserve = reg.status === 'confirmed' && !reg.teamRegistrationId && (stats?.teams?.length ?? 0) > 0;
  return { key, label: LABEL[key], tone: TONE[key], reserve };
}

/** Заявка ще жива (не відхилена) — повторно подаватись на цей турнір не можна. */
export const isActiveRegistration = (r: Pick<Registration, 'status'>): boolean => r.status !== 'rejected';

/** Свої заявки гравців серед заявок турніру: за id із браузера чи за id своїх персонажів.
 * Порядок: живі спершу, далі новіші. */
export function pickOwn(regs: readonly Registration[], q: { ids: readonly string[]; characterIds?: readonly string[] | null }): Registration[] {
  const ids = new Set(q.ids);
  const chars = new Set(q.characterIds ?? []);
  return regs
    .filter((r) => r.kind === 'player' && (ids.has(r.id) || (!!r.characterId && chars.has(r.characterId))))
    .sort((a, b) => Number(isActiveRegistration(b)) - Number(isActiveRegistration(a)) || (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Свої заявки серед уже завантажених заявок турніру (сторінка турніру): за записами
 * браузера цього турніру, за своїми персонажами, а запис старого формату (без id) —
 * за останнім ніком. */
export function ownInTournament(
  regs: readonly Registration[],
  tournamentId: string,
  q: { refs: readonly RegistrationRef[]; characterIds?: readonly string[] | null; lastNickname?: string },
): Registration[] {
  const refs = q.refs.filter((r) => r.tournamentId === tournamentId);
  const own = pickOwn(regs, { ids: refs.map((r) => r.registrationId).filter((x): x is string => !!x), characterIds: q.characterIds });
  const nicks = new Set(
    refs.filter((r) => !r.registrationId).map((r) => (r.nickname ?? q.lastNickname ?? '').trim().toLowerCase()).filter(Boolean),
  );
  if (own.length || !nicks.size) return own;
  return pickOwn(regs, { ids: regs.filter((r) => r.kind === 'player' && nicks.has(r.nickname.trim().toLowerCase())).map((r) => r.id) });
}

/** Банер «Твоя заявка» на сторінці турніру (ownInTournament): жива заявка з записів
 * цього браузера — першою, інакше перша своя (жива, новіша). byCharacterOnly — знайдена
 * лише за персонажем (картка пояснює, що подано не з цього браузера); basis — свої
 * заявки для правила повторної подачі без знайдених лише за персонажем (як reapplyBasis). */
export function ownBanner(
  regs: readonly Registration[],
  tournamentId: string,
  q: { refs: readonly RegistrationRef[]; characterIds?: readonly string[] | null; lastNickname?: string },
): { reg: Registration; byCharacterOnly: boolean; basis: Registration[] } | null {
  const own = ownInTournament(regs, tournamentId, q);
  if (!own.length) return null;
  const trusted = new Set(ownInTournament(regs, tournamentId, { ...q, characterIds: [] }).map((r) => r.id));
  const reg = own.find((r) => isActiveRegistration(r) && trusted.has(r.id)) ?? own[0];
  return { reg, byCharacterOnly: !trusted.has(reg.id), basis: own.filter((r) => trusted.has(r.id)) };
}

/** Можна подати знову: усі свої заявки на турнір відхилені (не «вибув» — тих замінили
 * вже після жеребки) і реєстрація ще відкрита. */
export function canReapply(own: readonly Registration[], tournament: Pick<Tournament, 'status' | 'eventDate' | 'balanceStats'>): boolean {
  return own.length > 0 && own.every((r) => playerStatus(r, tournament).key === 'rejected') && isRegistrationOpen(tournament);
}

/** Команда гравця з уже завантажених заявок турніру (сторінка турніру). */
export function teamFromRegistrations(regs: readonly Registration[], teamId: string | null): TeamLite | null {
  if (!teamId) return null;
  const team = regs.find((r) => r.id === teamId);
  if (!team) return null;
  const members: TeamMemberLite[] = regs
    .filter((r) => r.teamRegistrationId === teamId)
    .map((r) => ({ id: r.id, nickname: r.nickname, charClass: r.gear?.charClass ?? null, status: r.status }));
  return { id: team.id, name: team.nickname, members };
}

export interface MyRegistrationItem {
  reg: Registration;
  /** null — турнір видалено. */
  tournament: Tournament | null;
  /** Команда після жеребки; null — ще немає (або гравець у резерві). */
  team: TeamLite | null;
  /** Знайдено лише за character_id свого персонажа (не за id чи ніком із цього
   * браузера) — показуємо, але подавати свою заявку це не заважає. */
  byCharacterOnly?: boolean;
}

/** Свої заявки на кожен турнір для правила повторної подачі (canReapply) — без
 * знайдених лише за character_id: жива чужа заявка з підставленим персонажем не
 * має ховати «Подати знову». */
export function reapplyBasis(items: readonly MyRegistrationItem[]): Map<string, Registration[]> {
  const m = new Map<string, Registration[]>();
  for (const it of items) if (!it.byCharacterOnly) m.set(it.reg.tournamentId, [...(m.get(it.reg.tournamentId) ?? []), it.reg]);
  return m;
}

/**
 * Що показати на сторінці заявки замість (чи над) формою:
 *  • checking — свої заявки ще шукаємо;
 *  • error — пошук не вдався, а з цього браузера на турнір уже подавали: помилка й «Спробувати ще»
 *    (без записів браузера — форма: дубль однаково зупинить унікальний нік чи бекенд);
 *  • status — жива своя заявка (статус замість форми) або лише відхилені, поки не натиснули «Подати знову»;
 *  • unknown — запис браузера старого формату (без id і ніку), заявку не знайдено — як раніше, блокуємо;
 *  • form — форма; над нею відхилені свої (повторна подача) і знайдені лише за персонажем
 *    (`foreign`, не заважають подати). `basis` — свої заявки для правила повторної подачі.
 */
export type RegisterGate =
  | { view: 'checking' }
  | { view: 'error' }
  | { view: 'unknown' }
  | { view: 'status'; cards: MyRegistrationItem[]; basis: Registration[] }
  | { view: 'form'; rejected: MyRegistrationItem[]; foreign: MyRegistrationItem[]; basis: Registration[] };

export function registerGate(q: {
  /** Результат пошуку своїх заявок на цей турнір; current — саме для нинішнього турніру/персонажів. */
  own: { status: 'loading' | 'ready' | 'error'; items: readonly MyRegistrationItem[]; current: boolean };
  /** Записи цього браузера про подані на цей турнір заявки. */
  refs: readonly RegistrationRef[];
  /** «Подати знову» натиснуто (чи ?again=1). */
  again: boolean;
}): RegisterGate {
  const { own, refs } = q;
  if (!own.current || own.status === 'loading') return { view: 'checking' };
  if (own.status === 'error') return refs.length > 0 ? { view: 'error' } : { view: 'form', rejected: [], foreign: [], basis: [] };
  const trusted = own.items.filter((i) => !i.byCharacterOnly);
  const foreign = own.items.filter((i) => i.byCharacterOnly);
  const basis = trusted.map((i) => i.reg);
  const active = trusted.filter((i) => isActiveRegistration(i.reg));
  if (active.length > 0) return { view: 'status', cards: active, basis };
  // Запис з id чи ніком, якого вже немає в базі, — заявку видалив адмін: подавати можна.
  if (trusted.length === 0 && refs.some((r) => !r.registrationId && !r.nickname)) return { view: 'unknown' };
  if (trusted.length > 0 && !q.again) return { view: 'status', cards: trusted, basis };
  return { view: 'form', rejected: trusted, foreign, basis };
}

/**
 * Свої заявки з базою: id з браузера (`refs`), персонажі (`characterIds`, вхід через
 * Discord), записи старого формату — за `lastNickname`. `tournamentId` — лише цей
 * турнір. Новіші турніри — вище.
 */
export async function loadMyRegistrations(q: {
  refs: readonly RegistrationRef[];
  characterIds?: readonly string[] | null;
  lastNickname?: string;
  tournamentId?: string;
}): Promise<MyRegistrationItem[]> {
  const refs = q.tournamentId ? q.refs.filter((r) => r.tournamentId === q.tournamentId) : q.refs;
  const ids = refs.map((r) => r.registrationId).filter((x): x is string => !!x);
  // Записи без id (старий формат чи id не вдалося дізнатись) — за ніком запису, інакше за останнім.
  const byNickTids = new Map<string, string[]>();
  for (const r of refs) {
    if (r.registrationId) continue;
    const nick = (r.nickname ?? q.lastNickname ?? '').trim();
    if (nick) byNickTids.set(nick, [...(byNickTids.get(nick) ?? []), r.tournamentId]);
  }
  const [byId, ...byNick] = await Promise.all([
    fetchOwnRegistrations({ ids, characterIds: q.characterIds ?? [], tournamentId: q.tournamentId }),
    ...[...byNickTids].map(([nick, tids]) => fetchRegistrationsByNickname(tids, nick)),
  ]);
  // Своя напевно — за id чи ніком із записів браузера; решта знайдена лише за персонажем.
  const known = new Set([...ids, ...byNick.flat().map((r) => r.id)]);
  const regs = new Map<string, Registration>();
  for (const r of [...byId, ...byNick.flat()]) regs.set(r.id, r);
  if (!regs.size) return [];
  const list = [...regs.values()];
  const [tournaments, teams] = await Promise.all([
    fetchTournamentsByIds(list.map((r) => r.tournamentId)),
    fetchTeamsLite(list.map((r) => r.teamRegistrationId).filter((x): x is string => !!x)),
  ]);
  const tById = new Map(tournaments.map((t) => [t.id, t] as const));
  return list
    .map((reg) => ({
      reg,
      tournament: tById.get(reg.tournamentId) ?? null,
      team: reg.teamRegistrationId ? teams.get(reg.teamRegistrationId) ?? null : null,
      byCharacterOnly: !known.has(reg.id),
    }))
    .sort((a, b) => {
      const da = a.tournament?.eventDate ?? '';
      const db = b.tournament?.eventDate ?? '';
      if (da !== db) return da < db ? 1 : -1;
      return Number(isActiveRegistration(b.reg)) - Number(isActiveRegistration(a.reg)) || (a.reg.createdAt < b.reg.createdAt ? 1 : -1);
    });
}
