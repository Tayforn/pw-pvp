// =========================================================
// pw-pvp: типи даних (дзеркалять Supabase-схему з
// supabase/migrations/0001_init.sql).
// =========================================================

export interface TournamentSeries {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
  /** День тижня для автостворення турнірів цієї серії: 0=неділя..6=субота
   * (як Postgres extract(dow)); null = автостворення вимкнене. */
  autoWeekday: number | null;
}

export type TournamentStatus = 'draft' | 'registration_open' | 'registration_closed' | 'in_progress' | 'completed' | 'cancelled';
export type BracketType = 'single_elim' | 'double_elim';
/** Спосіб формування команд у командному турнірі: 'fixed' — заявка = готова
 * команда (назва + N ніків, як було завжди); 'balanced_random' — «Балансний
 * фул-рандом»: гравці реєструються поодинці з анкетою спорядження, команди
 * формує адмін алгоритмом (src/data/balance.ts). */
export type TeamMode = 'fixed' | 'balanced_random';

// ── Анкета спорядження (0017) — дискретні відповіді, бали рахуються
// на читанні за версією правил (src/data/gearRules.ts). ──
export type RegistrationKind = 'player' | 'team';
export type CharClass = 'blademaster' | 'wizard' | 'cleric' | 'archer' | 'venomancer' | 'barbarian' | 'assassin' | 'psychic' | 'seeker' | 'mystic';
export type WeaponGrade = 'other' | 'nirvana' | 'r8r' | 'cgd' | 'r9' | 'r9r1' | 'rcgd' | 'r9r2';
export type WeaponRefine = 'w0_5' | 'w6_7' | 'w8_9' | 'w10' | 'w11' | 'w12';
/** Чистий R8 прибрано (0020): без рекасту він гірший за Нірвану, ніхто його не носить. */
export type ArmorSet = 'other' | 'nirvana' | 'nirvana_r8_mix' | 'r8r' | 'r9';
/** «Круг точки» — рівень заточки всього круга: броня + біжутерія + кільця. */
export type ArmorRefine = 'a0_4' | 'a5' | 'a6' | 'a7' | 'a8' | 'a9' | 'a10' | 'a11' | 'a12';
export type SpecialSet = 'pz' | 'pa' | 'aspd';
export type Tract = 't1_3' | 't4_5' | 't6' | 't7' | 't8' | 'emperor';
/** Джин за рівнем (0020): до 60 · 61–70 · 71–80 · 81–90 · 91–99 · 100/100. */
export type Genie = 'g60' | 'g61_70' | 'g71_80' | 'g81_90' | 'g91_99' | 'g100';
/** Камені у броні (до 6 шмоток × 4 дірки = 24 камені), за вартістю по зростанню:
 * рівневі 0–9 / 10 / 11 → Сюаньки → Сюаньки/ПА → ПА → Сюаньки/Лагеря → Лагеря (2 ПЗ кожен, до 48 ПЗ). */
export type Gems = 'g0_9' | 'g10' | 'g11' | 'xuan' | 'xuan_pa' | 'pa' | 'xuan_camp' | 'camp';
/** Рівень персонажа (0024): 90–100 одним кошиком, далі кожен рівень окремо. */
export type CharLevel = 'l90_100' | 'l101' | 'l102' | 'l103' | 'l104' | 'l105';
/** Збірка персонажа (0025): ДД / гібрид / кон. Гір той самий, а урон — ні:
 * кон-Сін не вбиває, тому в рольовому шарі його kill множиться на коефіцієнт збірки. */
export type Build = 'dd' | 'hybrid' | 'con';
export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

/** Усі поля завжди присутні (constraint registrations_gear_all_or_none):
 * невідмічений чекбокс — це false / [] / {}, а не null. */
export interface PlayerGear {
  charClass: CharClass;
  /** Рівень персонажа (0024); null — анкета, подана до появи поля (рахується як 90–100). */
  charLevel: CharLevel | null;
  /** Збірка (0025); null — анкета до появи поля (рахується як ДД). */
  build: Build | null;
  weaponGrade: WeaponGrade;
  weaponRefine: WeaponRefine;
  /** ПЗ-зброя — запасна зброя з показником захисту, на яку свапаються під уроном. */
  weaponPz: boolean;
  armorSet: ArmorSet;
  armorRefine: ArmorRefine;
  /** камені в основному сеті */
  gems: Gems;
  specialSets: SpecialSet[];
  /** камені в кожному відміченому свап-сеті (ключ = сет); сет без запису = камені 0–9 */
  specialSetGems: Partial<Record<SpecialSet, Gems>>;
  tract: Tract;
  genie: Genie;
  /** ШГ (0023): є шмотка — і її точка окремо (0–12; null, коли шмотки немає). */
  shg: boolean;
  shgRefine: number | null;
  /** Вознєс (0023): є шмотка — і її точка окремо (0–12; null, коли шмотки немає). */
  voznes: boolean;
  voznesRefine: number | null;
}

/** Що саме подавалось на вхід алгоритму — достатньо, щоб відтворити
 * результат після зміни таблиць балів (score вже пораховані). */
export interface BalanceSnapshot {
  algoVersion: string;
  rulesVersion: string;
  seed: string;
  teamSize: number;
  teamCount: number;
  reservePolicy: string;
  inputHash: string;
  /** [registrationId, клас, score, kill, amp] — відсортовано за id; kill/amp
   * (профіль для рольового шару, teams-ls-v2) у старих знімках відсутні. */
  players: Array<[string, CharClass, number, number?, number?]>;
}

/** tournaments.balance_stats — знімок генерації + склади на момент затвердження. */
export interface BalanceStats extends BalanceSnapshot {
  formedAt: string;
  penalty: number;
  bestPenalty: number;
  candidates: number;
  teams: {
    name: string;
    total: number;
    members: { registrationId: string; nickname: string; charClass: CharClass; score: number; tier: Tier }[];
  }[];
  reserve: { registrationId: string; nickname: string }[];
  substitutions: { teamId: string; out: string; in: string | null; reason: string; at: string }[];
}

export interface Tournament {
  id: string;
  seriesId: string | null;
  name: string;
  eventDate: string; // 'YYYY-MM-DD'
  status: TournamentStatus;
  rulesMd: string | null;
  prizesMd: string | null;
  bracketType: BracketType;
  bracketSize: number | null;
  /** null/undefined = звичайний (одноосібний) турнір; N>=2 = командний, реєстрація вимагає N нікнеймів учасників. */
  teamSize: number | null;
  createdBy: string | null;
  /** 'unlisted' = створено ГМ-ом — не показується на публічних сторінках, лише за прямим посиланням. */
  visibility: 'public' | 'unlisted';
  /** Матч за 3-тє місце між програними півфіналістів — лише для single_elim. */
  thirdPlaceMatch: boolean;
  /** Дзеркальна сітка з конекторами (true) чи колонки по раундах (false) —
   * впливає лише на single_elim, для double_elim вигляд один. */
  bracketNewLook: boolean;
  /** Має значення лише при teamSize >= 2; для соло-турнірів завжди 'fixed'. */
  teamMode: TeamMode;
  /** Seed останнього формування команд (balanced_random). */
  balanceSeed: string | null;
  /** Seed посіву сітки — новий при кожному «Решафл сітки»; null = сітку ще не генерували з seed. */
  bracketSeed: string | null;
  /** Версія таблиць балів, якою рахувався цей турнір (напр. 'balance-v1.0'); null до формування. */
  balanceRulesVersion: string | null;
  balanceStats: BalanceStats | null;
}

export type RegistrationStatus = 'pending' | 'confirmed' | 'rejected';

export interface Registration {
  id: string;
  tournamentId: string;
  /** Нікнейм гравця (одноосібний турнір) або назва команди (командний). */
  nickname: string;
  rulesAck: boolean;
  status: RegistrationStatus;
  createdAt: string;
  /** Нікнейми учасників команди — заповнено лише для командних турнірів. */
  memberNicknames: string[] | null;
  /** 'player' — заявка гравця (або готової команди у fixed-режимі); 'team' —
   * згенерована командa балансного фул-рандому (нік = назва команди). */
  kind: RegistrationKind;
  /** Для гравця фул-рандому — id його team-рядка після формування. */
  teamRegistrationId: string | null;
  /** Анкета спорядження — лише у balanced_random; null для решти. */
  gear: PlayerGear | null;
  /** Калібрувальні поля (не рахуються у v1.0): показник атаки/захисту без бафів. */
  attackLevel: number | null;
  defenseLevel: number | null;
  /** Ручна корекція скору адміном (± бали) з причиною — лише адмінам (0021). */
  scoreAdjust: number;
  scoreAdjustNote: string | null;
}

/** Балансний фул-рандом = командний турнір з індивідуальною реєстрацією. */
export function isBalancedRandom(t: Pick<Tournament, 'teamSize' | 'teamMode'>): boolean {
  return !!t.teamSize && t.teamMode === 'balanced_random';
}

/** Хто йде в сітку: у фул-рандомі — згенеровані team-рядки, інакше —
 * звичайні заявки (усі старі рядки мають kind='player'). */
export function isBracketParticipant(t: Pick<Tournament, 'teamSize' | 'teamMode'>, r: Pick<Registration, 'status' | 'kind'>): boolean {
  if (r.status !== 'confirmed') return false;
  return isBalancedRandom(t) ? r.kind === 'team' : r.kind === 'player';
}

export type BracketSide = 'winners' | 'losers' | 'final' | 'third_place';

export interface BracketMatch {
  id: string;
  tournamentId: string;
  bracketSide: BracketSide;
  round: number;
  slot: number;
  format: string;
  participant1Id: string | null;
  participant2Id: string | null;
  winnerId: string | null;
  /** Рахунок серії (напр. "2-1") — для bo1 виставляється автоматично "1-0"/"0-1". */
  score: string | null;
  nextMatchId: string | null;
  nextMatchSlot: 1 | 2 | null;
  loserNextMatchId: string | null;
  loserNextMatchSlot: 1 | 2 | null;
}

/** Реєстрація дозволена лише поки статус 'registration_open' і турнір ще не
 * пройшов (event_date не в минулому) — обидві умови незалежні: адмін може
 * забути закрити реєстрацію після дати турніру. */
export function isRegistrationOpen(t: Pick<Tournament, 'status' | 'eventDate'>): boolean {
  if (t.status !== 'registration_open') return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return t.eventDate >= today;
}

/** Статус для відображення (беджі): якщо в БД ще 'registration_open', але
 * event_date вже минула, показуємо його як закритий — не чекаючи, поки
 * серверний крон (close_past_tournament_registrations, 0016) перезапише
 * сам запис раз на 2 години. */
export function effectiveStatus(t: Pick<Tournament, 'status' | 'eventDate'>): TournamentStatus {
  if (t.status === 'registration_open' && !isRegistrationOpen(t)) return 'registration_closed';
  return t.status;
}

/** Індекс — той самий 0=неділя..6=субота, що й Postgres extract(dow). */
export const WEEKDAY_LABELS = ['Неділя', 'Понеділок', 'Вівторок', 'Середа', 'Четвер', "П'ятниця", 'Субота'] as const;

export const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Чернетка',
  registration_open: 'Реєстрація відкрита',
  registration_closed: 'Реєстрація закрита',
  in_progress: 'Триває',
  completed: 'Завершено',
  cancelled: 'Скасовано',
};
