// =========================================================
// pw-pvp: типи даних (дзеркалять Supabase-схему з
// supabase/migrations/0001_init.sql).
// =========================================================

export interface TournamentSeries {
  id: string;
  slug: string;
  name: string;
  isActive: boolean;
}

export type TournamentStatus = 'draft' | 'registration_open' | 'registration_closed' | 'in_progress' | 'completed' | 'cancelled';
export type BracketType = 'single_elim' | 'double_elim';

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
}

export type BracketSide = 'winners' | 'losers' | 'final';

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

export const STATUS_LABELS: Record<TournamentStatus, string> = {
  draft: 'Чернетка',
  registration_open: 'Реєстрація відкрита',
  registration_closed: 'Реєстрація закрита',
  in_progress: 'Триває',
  completed: 'Завершено',
  cancelled: 'Скасовано',
};
