// =========================================================
// Подача заявки: спершу бекенд, запасний шлях — прямий insert у Supabase.
//
// Заявку на балансний фул-рандом рахує й записує сервер (pw-ladder, POST
// /api/pvp/registrations; скор — та сама модель ляльки, src/server/scorer.ts):
// свій персонаж — за characterId (документ сервер бере зі своєї бази, лише
// свій), чернетка гостя — документом у тілі. Рядок, вставлений сервером, має
// item_breakdown.checked — бейджа «не перевірено» немає, жеребка не чекає.
//
// Запасний шлях (нинішній submitRegistration — insert анонімним ключем, скор
// рахував браузер): коли бекенда немає чи він не готовий — мережа, 404 без
// нашої помилки (старий бекенд без маршруту), 405, 5xx (503 not_configured —
// не задано PVP_SUPABASE_*; 502 — база турнірів не відповіла), 403 bad_origin
// (сайт не в списку дозволених джерел). Помилку бекенда для гравця (4xx з
// message: дубль ніку, реєстрацію закрито, немає зброї, частота) показуємо як є.
// Після міграції 0034 прямий insert на фул-рандом RLS не пропускає — тоді
// замість тексту про RLS кажемо, що сервер заявок недоступний.
//
// Звичайні турніри й готові команди бекенд не приймає — для них одразу insert.
//
// Прямий insert ніколи не пише character_id (лише знімок): чий персонаж,
// перевіряє тільки бекенд за сесією, тож character_id у заявці — лише від нього.
//
// Бекенд міг записати заявку, але не встигнути відповісти (тайм-аут бази,
// обрив мережі). Кожна подача несе мітку спроби (nonce, newNonce) — бекенд
// кладе її в item_breakdown.nonce. Перед запасним шляхом, після його відмови
// (дубль ніку чи RLS після 0034) і після 409 на повторну подачу (already_registered,
// duplicate_nickname) шукаємо живу заявку з цим ніком: своя — лише з нашою міткою
// (isOwnRow), а не «свіжа з тим самим ніком» (така може бути чужою). Знайшли —
// заявку прийнято, id запамʼятовується.
// =========================================================

import type { DollPower, ItemBreakdown, PlayerGear, RegistrationStatus } from './types';

export const REGISTER_URL = '/api/pvp/registrations';

/** Тіло запиту до бекенда (контракт pvpRegister.ts у pw-ladder). */
export interface ServerRegistrationBody {
  tournamentId: string;
  nickname: string;
  rulesAck: true;
  /** Збережений персонаж (вхід через Discord) — документ сервер бере з бази. */
  characterId?: string;
  /** Чернетка персонажа з цього браузера (гість). */
  doc?: unknown;
  memberNicknames?: string[];
  /** Мітка спроби подачі (newNonce): та сама для повторів, поки заявку не прийнято. */
  nonce?: string;
}

/** Мітка спроби подачі: випадковий рядок [A-Za-z0-9_-] (бекенд приймає 8–64 символи). */
export function newNonce(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Відповідь 200. */
export interface ServerRegistrationResult {
  id: string;
  itemPoints: number;
  score?: number;
  rulesVersion?: string;
  warn?: string[];
}

/** Помилка, яку бачить гравець (4xx бекенда з поясненням). */
export class RegisterApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ServerAttempt =
  | { ok: true; result: ServerRegistrationResult }
  /** Бекенд недоступний чи не налаштований — подавати запасним шляхом. */
  | { ok: false; unavailable: string };

/** Коди помилок бекенда, після яких іде запасний шлях (не вина гравця). */
const FALLBACK_CODES = new Set(['not_configured', 'upstream', 'internal', 'bad_origin']);

/** Текст для 401: свій персонаж без сесії — сесія Discord завершилась, поки форма була відкрита. */
export const SESSION_EXPIRED_TEXT = 'Сесія Discord завершилась — увійди ще раз (кнопка «Увійти» вгорі) і подай заявку знову.';

/** POST /api/pvp/registrations. Кидає RegisterApiError, коли бекенд відмовив гравцю. */
export async function postServerRegistration(body: ServerRegistrationBody, fetchImpl: typeof fetch = fetch): Promise<ServerAttempt> {
  let res: Response;
  try {
    res = await fetchImpl(REGISTER_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, unavailable: 'network' };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* не JSON (сторінка-заглушка, проксі) */
  }
  const o = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : null;
  if (res.ok) {
    // 200 без id — не наш бекенд (статика віддала сторінку) — запасний шлях.
    if (!o || typeof o.id !== 'string' || !o.id) return { ok: false, unavailable: 'bad_response' };
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    return {
      ok: true,
      result: {
        id: o.id,
        itemPoints: num(o.itemPoints) ?? 0,
        score: num(o.score),
        rulesVersion: typeof o.rulesVersion === 'string' ? o.rulesVersion : undefined,
        warn: Array.isArray(o.warn) ? o.warn.filter((w): w is string => typeof w === 'string') : [],
      },
    };
  }
  // Наша помилка — {error: код_малими, message}; у Fastify за замовчуванням (немає
  // маршруту) — {error: 'Not Found', …}, у проксі — HTML.
  const code = o && typeof o.error === 'string' && /^[a-z_]+$/.test(o.error) ? o.error : null;
  const message = o && typeof o.message === 'string' && o.message.trim() ? o.message.trim() : null;
  if (!code || res.status >= 500 || res.status === 405 || FALLBACK_CODES.has(code)) {
    return { ok: false, unavailable: code ?? 'http_' + res.status };
  }
  if (res.status === 401 || code === 'unauthorized') throw new RegisterApiError(code, res.status, SESSION_EXPIRED_TEXT);
  throw new RegisterApiError(code, res.status, message ?? 'Сервер не прийняв заявку. Спробуй ще раз.');
}

/** Що потрібно прямому insert (submitRegistration у data/tournaments.ts). */
export interface DirectRegistrationInput {
  tournamentId: string;
  nickname: string;
  rulesAck: boolean;
  memberNicknames?: string[];
  gear?: PlayerGear;
  attackLevel?: number | null;
  defenseLevel?: number | null;
  /** Знімок ляльки, сила й скор v2; character_id прямий insert не пише (див. шапку). */
  character?: { snapshot: unknown; power: DollPower | null; itemPoints?: number | null; itemBreakdown?: ItemBreakdown | null };
}

/** Жива заявка з ніком на турнір (findLiveRegistration у data/tournaments.ts); nonce — item_breakdown.nonce. */
export interface LiveRegistrationRow { id: string; createdAt: string; characterId: string | null; nonce: string | null }

export interface RegisterDeps {
  fetch?: typeof fetch;
  /** Прямий insert (submitRegistration); повертає id нової заявки. */
  submitDirect: (input: DirectRegistrationInput) => Promise<{ id: string | null }>;
  /** Статус наявної заявки з цим ніком — пояснити дубль (до 0033 відхилена блокує нік). */
  statusByNickname?: (tournamentId: string, nickname: string) => Promise<RegistrationStatus | null>;
  /** Жива заявка з цим ніком — чи не записав її вже бекенд, що не встиг відповісти. */
  findLive?: (tournamentId: string, nickname: string) => Promise<LiveRegistrationRow | null>;
}

export interface RegisterOutcome {
  id: string | null;
  /** server — заявку прийняв і порахував бекенд; direct — запасний шлях. */
  via: 'server' | 'direct';
  itemPoints?: number;
  warn: string[];
}

/** Нік зайнятий — текст залежить від того, чия заявка тримає нік. */
export function duplicateText(isTeam: boolean, existing: RegistrationStatus | null): string {
  if (existing === 'rejected') {
    return 'Заявку з цим нікнеймом на цей турнір уже відхилено. Щоб подати знову з тим самим ніком, адмін має видалити відхилену заявку — напиши адміну.';
  }
  return `Ц${isTeam ? 'я назва команди' : 'ей нікнейм'} уже зареєстрован${isTeam ? 'а' : 'ий'} на цей турнір.`;
}

const isDuplicate = (msg: string, code?: string) => code === '23505' || msg.includes('duplicate key') || msg.includes('registrations_tournament_nickname');
const isRls = (msg: string, code?: string) => code === '42501' || msg.includes('row-level security');

/** Бекенд міг уже записати заявку: обрив мережі чи тайм-аут (на клієнті — network),
 * 5xx від бекенда (upstream — база не відповіла вчасно, internal) чи від проксі
 * (http_5xx). 503 not_configured, 404/405, bad_origin, 200 без id — точно ні. */
export function serverMayHaveWritten(unavailable: string): boolean {
  return unavailable === 'network' || unavailable === 'upstream' || unavailable === 'internal' || /^http_5\d\d$/.test(unavailable);
}

/**
 * Жива заявка з цим ніком — саме та, яку бекенд записав для ЦІЄЇ подачі: у неї наша
 * мітка спроби (item_breakdown.nonce). Нік, час і персонаж не доказ — заявку з тим самим
 * ніком хвилину тому міг подати хтось інший. Без мітки — не впізнаємо нічого.
 */
export function isOwnRow(row: LiveRegistrationRow | null, server: ServerRegistrationBody): boolean {
  return !!row && !!server.nonce && row.nonce === server.nonce;
}

/** 409 на повторну подачу після тайм-ауту: персонаж чи нік уже зайнятий — можливо, нашою ж заявкою. */
const RETRY_CONFLICT_CODES = new Set(['already_registered', 'duplicate_nickname']);

/**
 * Подати заявку. `server` — тіло для бекенда (лише балансний фул-рандом:
 * персонажем чи чернеткою); без нього — одразу прямий insert. Помилки — Error
 * з текстом для гравця.
 */
export async function registerPlayer(
  input: { direct: DirectRegistrationInput; server?: ServerRegistrationBody; isTeam?: boolean },
  deps: RegisterDeps,
): Promise<RegisterOutcome> {
  let serverDown: string | null = null;
  // Заявка цієї подачі (з нашою міткою), яку бекенд уже записав, — як прийнята сервером.
  const claim = async (why: string): Promise<RegisterOutcome | null> => {
    if (!input.server?.nonce || !deps.findLive) return null;
    const row = await deps.findLive(input.server.tournamentId, input.server.nickname).catch(() => null);
    if (!row || !isOwnRow(row, input.server)) return null;
    console.warn('pvp: заявку цієї подачі бекенд уже записав (' + why + ') — заявку прийнято');
    return { id: row.id, via: 'server', warn: [] };
  };
  // Бекенд міг записати, але не відповів (обрив, 5xx).
  const written = async (): Promise<RegisterOutcome | null> =>
    serverDown && serverMayHaveWritten(serverDown) ? claim(serverDown) : null;
  if (input.server) {
    let attempt: ServerAttempt;
    try {
      attempt = await postServerRegistration(input.server, deps.fetch ?? fetch);
    } catch (e) {
      // Повтор після тайм-ауту: перша спроба вже записала заявку — 409 саме через неї.
      if (e instanceof RegisterApiError && RETRY_CONFLICT_CODES.has(e.code)) {
        const done = await claim(e.code);
        if (done) return done;
      }
      throw e;
    }
    if (attempt.ok) return { id: attempt.result.id, via: 'server', itemPoints: attempt.result.itemPoints, warn: attempt.result.warn ?? [] };
    serverDown = attempt.unavailable;
    const done = await written();
    if (done) return done;
    console.warn('pvp: бекенд заявок недоступний (' + serverDown + ') — подаю напряму');
  }
  try {
    const { id } = await deps.submitDirect(input.direct);
    return { id, via: 'direct', warn: [] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string' ? (e as { message: string }).message : String(e);
    const code = e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : undefined;
    // Нік зайнятий чи прямий insert закрито (0034) — можливо, тим самим рядком, що
    // бекенд записав уже після першої перевірки.
    if (isDuplicate(msg, code) || isRls(msg, code)) {
      const done = await written();
      if (done) return done;
    }
    if (isDuplicate(msg, code)) {
      const existing = deps.statusByNickname
        ? await deps.statusByNickname(input.direct.tournamentId, input.direct.nickname).catch(() => null)
        : null;
      throw new Error(duplicateText(!!input.isTeam, existing));
    }
    if (isRls(msg, code)) {
      // Прямий insert на фул-рандом закрито (0034), а бекенд не відповів — справа не в гравці.
      if (serverDown) throw new Error('Сервер заявок зараз недоступний — спробуй за кілька хвилин. Не виходить довго — напиши адміну.');
      // RLS (0027) не пропускає заявку без rules_ack; та сама відмова — коли
      // реєстрацію закрили, поки форма була відкрита.
      throw new Error('Заявку не прийнято: підтвердь ознайомлення з правилами (галочка нижче) і перевір, чи реєстрація ще відкрита.');
    }
    throw e instanceof Error ? e : new Error(msg);
  }
}
