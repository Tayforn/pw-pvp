// =========================================================
// Свої заявки, подані з цього браузера: {турнір, id заявки, нік}. Звідси
// «Мої заявки» (/my), статус на сторінці заявки й банер «Твоя заявка» на
// сторінці турніру знаходять свою заявку — гравець без акаунта (гість) інакше
// її не знайде. Хто увійшов через Discord, того заявки персонажами шукаються
// ще й за id його персонажів (з будь-якого пристрою).
//
// Це ж — клієнтська перевірка «з цього браузера вже подано заявку»: доповнює
// (не замінює!) серверний unique-індекс на (tournament_id, kind, lower(nickname)),
// який блокує лише повтор ТОГО САМОГО нікнейму. Відхилена заявка подачу вже не
// блокує (повторна подача, 0033) — це вирішує сторінка заявки за статусом.
//
// Старий формат сховища — масив id турнірів (рядки): такі записи читаються як
// {tournamentId, registrationId: null, nickname: null} — статус для них сторінка
// шукає за останнім ніком (lastNickname.ts).
// =========================================================

const KEY = 'pwpvp-registered';
/** Скільки записів тримати (найновіші) — сховище не росте безмежно. */
export const REFS_KEEP = 100;

export interface RegistrationRef {
  tournamentId: string;
  /** id рядка registrations; null — запис старого формату (до збереження id). */
  registrationId: string | null;
  /** Нік, з яким подано (назва команди — у fixed-командному); null — старий запис. */
  nickname: string | null;
}

type RefStorage = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): RefStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Усі свої записи (найновіші — в кінці); зламане сховище — порожньо. */
export function readRegistrationRefs(storage: RefStorage | null = defaultStorage()): RegistrationRef[] {
  if (!storage) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(storage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: RegistrationRef[] = [];
  for (const x of raw) {
    if (typeof x === 'string') {
      if (x.trim()) out.push({ tournamentId: x.trim(), registrationId: null, nickname: null });
      continue;
    }
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const tournamentId = str(o.tournamentId);
    if (!tournamentId) continue;
    out.push({ tournamentId, registrationId: str(o.registrationId), nickname: str(o.nickname) });
  }
  return out;
}

/** Записи одного турніру. */
export function refsForTournament(tournamentId: string, storage: RefStorage | null = defaultStorage()): RegistrationRef[] {
  return readRegistrationRefs(storage).filter((r) => r.tournamentId === tournamentId);
}

export function hasRegistered(tournamentId: string, storage: RefStorage | null = defaultStorage()): boolean {
  return refsForTournament(tournamentId, storage).length > 0;
}

/** Запамʼятати подану заявку. Той самий id удруге не дублюється; запис старого
 * формату того самого турніру замінюється новим (тепер відомо, яка це заявка). */
export function markRegistered(
  tournamentId: string,
  registrationId: string | null = null,
  nickname: string | null = null,
  storage: RefStorage | null = defaultStorage(),
): void {
  if (!storage) return;
  const next: RegistrationRef = { tournamentId, registrationId: str(registrationId), nickname: str(nickname) };
  const kept = readRegistrationRefs(storage).filter((r) =>
    next.registrationId
      ? r.registrationId !== next.registrationId && !(r.tournamentId === tournamentId && r.registrationId === null)
      : !(r.tournamentId === tournamentId && r.registrationId === null),
  );
  kept.push(next);
  try {
    storage.setItem(KEY, JSON.stringify(kept.slice(-REFS_KEEP)));
  } catch {
    /* сховище недоступне (приватний режим тощо) — не критично, це лише допоміжна памʼять */
  }
}
