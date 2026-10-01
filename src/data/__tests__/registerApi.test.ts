// =========================================================
// Подача заявки (registerApi.ts): спершу бекенд (POST /api/pvp/registrations,
// скор рахує сервер), запасний шлях — прямий insert, коли бекенда немає чи він
// не готовий (мережа, 404 без нашої помилки, 405, 5xx, 503 not_configured,
// bad_origin); помилку бекенда для гравця (4xx з message) показуємо як є.
// Бекенд записав заявку, але не відповів (тайм-аут, обрив) — свіжа жива заявка
// цього ж гравця з ніком означає «прийнято». fetch, прямий insert і пошук — заглушки.
// =========================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REGISTER_URL, RegisterApiError, SESSION_EXPIRED_TEXT, duplicateText, isOwnRow, newNonce, postServerRegistration, registerPlayer, serverMayHaveWritten,
  type DirectRegistrationInput, type LiveRegistrationRow, type ServerRegistrationBody,
} from '../registerApi';

const BODY: ServerRegistrationBody = { tournamentId: '0b1c2d3e-0000-4000-8000-000000000001', nickname: 'Tayforn', rulesAck: true, characterId: '0b1c2d3e-0000-4000-8000-0000000000c1' };
const DIRECT: DirectRegistrationInput = { tournamentId: BODY.tournamentId, nickname: 'Tayforn', rulesAck: true };

/** fetch, що відповідає статусом і тілом (обʼєкт — JSON, рядок — як є, Error — мережа). */
function reply(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    if (body instanceof Error) throw body;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    } as unknown as Response;
  });
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('postServerRegistration', () => {
  it('POST з cookie сесії й JSON-тілом; 200 — id, бали й примітки', async () => {
    const f = reply(200, { id: 'r-1', itemPoints: 189.01, score: 217, rulesVersion: 'balance-v1.2', warn: ['ранг 17+', 5] });
    const res = await postServerRegistration(BODY, f as unknown as typeof fetch);
    expect(res).toEqual({ ok: true, result: { id: 'r-1', itemPoints: 189.01, score: 217, rulesVersion: 'balance-v1.2', warn: ['ранг 17+'] } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(REGISTER_URL);
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(String(init!.body))).toEqual(BODY);
  });

  it('бекенд недоступний чи не налаштований — запасний шлях (не помилка гравця)', async () => {
    const cases: Array<[number, unknown, string]> = [
      [503, { error: 'not_configured', message: 'Прийом заявок бекендом не налаштовано.' }, 'not_configured'],
      [502, { error: 'upstream', message: 'База турнірів зараз не відповідає' }, 'upstream'],
      [500, { error: 'internal', message: 'Внутрішня помилка.' }, 'internal'],
      // старий бекенд без маршруту: Fastify за замовчуванням
      [404, { message: 'Route POST:/api/pvp/registrations not found', error: 'Not Found', statusCode: 404 }, 'http_404'],
      [405, 'not json', 'http_405'],
      [403, { error: 'bad_origin', message: 'Некоректне джерело запиту.' }, 'bad_origin'],
      // статика віддала сторінку з 200
      [200, '<!doctype html>', 'bad_response'],
      [200, { ok: true }, 'bad_response'],
    ];
    for (const [status, body, why] of cases) {
      const f = typeof body === 'string' && body.startsWith('<')
        ? vi.fn(async () => ({ ok: true, status, json: async () => { throw new SyntaxError('Unexpected token <'); } }) as unknown as Response)
        : reply(status, body);
      await expect(postServerRegistration(BODY, f as unknown as typeof fetch), `${status} ${why}`).resolves.toEqual({ ok: false, unavailable: why });
    }
    await expect(postServerRegistration(BODY, reply(0, new TypeError('Failed to fetch')) as unknown as typeof fetch)).resolves.toEqual({ ok: false, unavailable: 'network' });
  });

  it('відмова гравцю (4xx з нашою помилкою) — RegisterApiError з текстом сервера', async () => {
    const cases: Array<[number, { error: string; message: string }]> = [
      [409, { error: 'duplicate_nickname', message: 'Нікнейм «Tayforn» уже зареєстровано на цей турнір.' }],
      [409, { error: 'registration_closed', message: 'Реєстрація на цей турнір закрита або турнір уже пройшов.' }],
      [400, { error: 'bad_request', message: 'Заявку не подати: у персонажа немає зброї (ні в Головному, ні в сеті).' }],
      [404, { error: 'not_found', message: 'Персонажа не знайдено.' }],
      [429, { error: 'rate_limited', message: 'Забагато спроб поспіль — зачекай кілька секунд.' }],
    ];
    for (const [status, body] of cases) {
      const p = postServerRegistration(BODY, reply(status, body) as unknown as typeof fetch);
      await expect(p, body.error).rejects.toBeInstanceOf(RegisterApiError);
      await expect(postServerRegistration(BODY, reply(status, body) as unknown as typeof fetch)).rejects.toMatchObject({ code: body.error, status, message: body.message });
    }
  });

  it('401 (свій персонаж, сесія завершилась) — зрозумілий текст про вхід', async () => {
    await expect(postServerRegistration(BODY, reply(401, { error: 'unauthorized', message: 'Потрібен вхід через Discord.' }) as unknown as typeof fetch))
      .rejects.toMatchObject({ code: 'unauthorized', message: SESSION_EXPIRED_TEXT });
  });
});

describe('registerPlayer: бекенд → запасний шлях', () => {
  it('сервер прийняв — прямого insert немає', async () => {
    const submitDirect = vi.fn(async () => ({ id: 'direct' }));
    const out = await registerPlayer({ direct: DIRECT, server: BODY }, { fetch: reply(200, { id: 'r-9', itemPoints: 10, warn: [] }) as unknown as typeof fetch, submitDirect });
    expect(out).toEqual({ id: 'r-9', via: 'server', itemPoints: 10, warn: [] });
    expect(submitDirect).not.toHaveBeenCalled();
  });

  it('503 / мережа — прямий insert з тими самими даними', async () => {
    for (const f of [reply(503, { error: 'not_configured', message: 'x' }), reply(0, new TypeError('Failed to fetch'))]) {
      const submitDirect = vi.fn(async () => ({ id: 'direct-1' }));
      const out = await registerPlayer({ direct: DIRECT, server: BODY }, { fetch: f as unknown as typeof fetch, submitDirect });
      expect(out).toEqual({ id: 'direct-1', via: 'direct', warn: [] });
      expect(submitDirect).toHaveBeenCalledWith(DIRECT);
    }
  });

  it('без тіла для сервера (звичайний турнір, готові команди) — одразу insert, fetch не викликається', async () => {
    const f = reply(200, { id: 'x' });
    const submitDirect = vi.fn(async () => ({ id: null }));
    await expect(registerPlayer({ direct: DIRECT }, { fetch: f as unknown as typeof fetch, submitDirect })).resolves.toEqual({ id: null, via: 'direct', warn: [] });
    expect(f).not.toHaveBeenCalled();
  });

  it('відмова сервера гравцю — помилка з його текстом, запасного шляху немає', async () => {
    const submitDirect = vi.fn(async () => ({ id: 'direct' }));
    await expect(registerPlayer({ direct: DIRECT, server: BODY }, {
      fetch: reply(409, { error: 'duplicate_nickname', message: 'Нікнейм «Tayforn» уже зареєстровано на цей турнір.' }) as unknown as typeof fetch, submitDirect,
    })).rejects.toThrow('Нікнейм «Tayforn» уже зареєстровано на цей турнір.');
    expect(submitDirect).not.toHaveBeenCalled();
  });

  it('прямий insert: дубль ніку — текст за статусом наявної заявки (відхилена до 0033 — «адмін має видалити»)', async () => {
    const dup = Object.assign(new Error('duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"'), { code: '23505' });
    const submitDirect = vi.fn(async () => { throw dup; });
    await expect(registerPlayer({ direct: DIRECT }, { submitDirect, statusByNickname: async () => 'rejected' })).rejects.toThrow(/адмін має видалити відхилену заявку/);
    await expect(registerPlayer({ direct: DIRECT }, { submitDirect, statusByNickname: async () => 'pending' })).rejects.toThrow('Цей нікнейм уже зареєстрований на цей турнір.');
    await expect(registerPlayer({ direct: DIRECT, isTeam: true }, { submitDirect, statusByNickname: async () => { throw new Error('мережа'); } }))
      .rejects.toThrow('Ця назва команди уже зареєстрована на цей турнір.');
    // PostgrestError — не Error, а обʼєкт з message/code
    const pg = vi.fn(async () => { throw { code: '23505', message: 'duplicate key value' }; });
    await expect(registerPlayer({ direct: DIRECT }, { submitDirect: pg })).rejects.toThrow('Цей нікнейм уже зареєстрований на цей турнір.');
  });

  it('прямий insert: RLS — після недоступного сервера «сервер заявок недоступний» (0034), без сервера — про правила', async () => {
    const rls = vi.fn(async () => { throw { code: '42501', message: 'new row violates row-level security policy for table "registrations"' }; });
    await expect(registerPlayer({ direct: DIRECT, server: BODY }, { fetch: reply(502, { error: 'upstream', message: 'x' }) as unknown as typeof fetch, submitDirect: rls }))
      .rejects.toThrow(/Сервер заявок зараз недоступний/);
    await expect(registerPlayer({ direct: DIRECT }, { submitDirect: rls })).rejects.toThrow(/підтвердь ознайомлення з правилами/);
    // інша помилка — як є
    const other = vi.fn(async () => { throw new Error('Реєстрація на цей турнір закрита або турнір уже пройшов.'); });
    await expect(registerPlayer({ direct: DIRECT }, { submitDirect: other })).rejects.toThrow('Реєстрація на цей турнір закрита або турнір уже пройшов.');
  });

  it('duplicateText', () => {
    expect(duplicateText(false, null)).toBe('Цей нікнейм уже зареєстрований на цей турнір.');
    expect(duplicateText(true, 'confirmed')).toBe('Ця назва команди уже зареєстрована на цей турнір.');
    expect(duplicateText(false, 'rejected')).toMatch(/уже відхилено.*адмін має видалити відхилену заявку/);
  });
});

describe('бекенд записав заявку, але не відповів (тайм-аут бази, обрив мережі)', () => {
  const NONCE = 'b7f0c2d4-1e2f-4a5b-8c9d-0e1f2a3b4c5d';
  const SB: ServerRegistrationBody = { ...BODY, nonce: NONCE };
  const GUEST: ServerRegistrationBody = { tournamentId: BODY.tournamentId, nickname: 'Гість', rulesAck: true, doc: { v: 2 }, nonce: NONCE };
  const mine = (over: Partial<LiveRegistrationRow> = {}): LiveRegistrationRow => ({
    id: 'r-written', createdAt: '2026-10-01T18:00:00Z', characterId: BODY.characterId!, nonce: NONCE, ...over,
  });
  const upstream = () => reply(502, { error: 'upstream', message: 'База турнірів зараз не відповідає' }) as unknown as typeof fetch;

  it('newNonce: 8–64 символи [A-Za-z0-9_-], щоразу інша', () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(newNonce()).not.toBe(a);
  });

  it('serverMayHaveWritten: обрив, 5xx бекенда чи проксі — так; не налаштовано, немає маршруту, bad_origin, 200 без id — ні', () => {
    for (const w of ['network', 'upstream', 'internal', 'http_502', 'http_504']) expect(serverMayHaveWritten(w), w).toBe(true);
    for (const w of ['not_configured', 'bad_origin', 'http_404', 'http_405', 'bad_response']) expect(serverMayHaveWritten(w), w).toBe(false);
  });

  it('isOwnRow: своя — лише з нашою міткою спроби; нік, свіжість і персонаж не доказ', () => {
    expect(isOwnRow(mine(), SB)).toBe(true);
    expect(isOwnRow(mine({ characterId: null }), GUEST)).toBe(true);
    // чужа заявка з тим самим ніком: інша мітка чи без мітки (подана напряму)
    expect(isOwnRow(mine({ nonce: 'other-nonce-123' }), SB)).toBe(false);
    expect(isOwnRow(mine({ nonce: null }), SB)).toBe(false);
    // без мітки в нашому запиті — не впізнаємо нічого
    expect(isOwnRow(mine({ nonce: null }), BODY)).toBe(false);
    expect(isOwnRow(null, SB)).toBe(false);
  });

  it('502 upstream, а заявка з нашою міткою вже є — прийнято сервером: id запамʼятовується, прямого insert немає', async () => {
    const submitDirect = vi.fn(async () => ({ id: 'direct' }));
    const findLive = vi.fn(async () => mine());
    const out = await registerPlayer({ direct: DIRECT, server: SB }, { fetch: upstream(), submitDirect, findLive });
    expect(out).toEqual({ id: 'r-written', via: 'server', warn: [] });
    expect(findLive).toHaveBeenCalledWith(BODY.tournamentId, 'Tayforn');
    expect(submitDirect).not.toHaveBeenCalled();
    // обрив мережі — так само; гість — заявка без персонажа
    const guestOut = await registerPlayer(
      { direct: { ...DIRECT, nickname: 'Гість' }, server: GUEST },
      { fetch: reply(0, new TypeError('Failed to fetch')) as unknown as typeof fetch, submitDirect, findLive: async () => mine({ characterId: null }) },
    );
    expect(guestOut).toEqual({ id: 'r-written', via: 'server', warn: [] });
    expect(submitDirect).not.toHaveBeenCalled();
  });

  it('чужа заявка гостя з тим самим ніком (інша мітка) — НЕ своя: запасний шлях і звичайний текст про дубль', async () => {
    const foreign = async () => mine({ characterId: null, nonce: 'someone-else-nonce' });
    const dup = vi.fn(async () => { throw { code: '23505', message: 'duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"' }; });
    await expect(registerPlayer({ direct: { ...DIRECT, nickname: 'Гість' }, server: GUEST }, { fetch: upstream(), submitDirect: dup, findLive: foreign, statusByNickname: async () => 'pending' }))
      .rejects.toThrow('Цей нікнейм уже зареєстрований на цей турнір.');
    expect(dup).toHaveBeenCalledTimes(1);
  });

  it('знайдена заявка без нашої мітки, пошук упав, у запиті немає мітки — як раніше: запасний шлях', async () => {
    for (const [server, findLive] of [
      [SB, async () => mine({ nonce: 'other-nonce-123' })],
      [SB, async () => mine({ nonce: null })],
      [SB, async () => null],
      [SB, async () => { throw new Error('мережа'); }],
      [BODY, async () => mine()],
    ] as Array<[ServerRegistrationBody, () => Promise<LiveRegistrationRow | null>]>) {
      const submitDirect = vi.fn(async () => ({ id: 'direct-2' }));
      await expect(registerPlayer({ direct: DIRECT, server }, { fetch: upstream(), submitDirect, findLive })).resolves.toEqual({ id: 'direct-2', via: 'direct', warn: [] });
      expect(submitDirect).toHaveBeenCalledTimes(1);
    }
  });

  it('бекенд точно нічого не записав (503 not_configured, 404 без маршруту) — не шукаємо', async () => {
    for (const f of [reply(503, { error: 'not_configured', message: 'x' }), reply(404, { error: 'Not Found', message: 'Route not found' })]) {
      const findLive = vi.fn(async () => mine());
      const out = await registerPlayer({ direct: DIRECT, server: SB }, { fetch: f as unknown as typeof fetch, submitDirect: async () => ({ id: 'direct-3' }), findLive });
      expect(out.via).toBe('direct');
      expect(findLive).not.toHaveBeenCalled();
    }
  });

  it('запис бекенда став видно лише після першої перевірки: прямий insert — дубль (до 0034) чи RLS (після) — і тоді заявку прийнято', async () => {
    const dup = vi.fn(async () => { throw { code: '23505', message: 'duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"' }; });
    const rls = vi.fn(async () => { throw { code: '42501', message: 'new row violates row-level security policy for table "registrations"' }; });
    for (const submitDirect of [dup, rls]) {
      const findLive = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(mine());
      const out = await registerPlayer({ direct: DIRECT, server: SB }, { fetch: upstream(), submitDirect, findLive, statusByNickname: async () => 'pending' });
      expect(out).toEqual({ id: 'r-written', via: 'server', warn: [] });
      expect(findLive).toHaveBeenCalledTimes(2);
    }
    await expect(registerPlayer({ direct: DIRECT, server: SB }, { fetch: upstream(), submitDirect: rls, findLive: async () => null }))
      .rejects.toThrow(/Сервер заявок зараз недоступний/);
  });

  it('повтор після тайм-ауту: 409 already_registered чи duplicate_nickname через нашу ж заявку — прийнято; через чужу — текст сервера', async () => {
    for (const code of ['already_registered', 'duplicate_nickname']) {
      const f = reply(409, { error: code, message: 'Цим персонажем уже подано заявку…' }) as unknown as typeof fetch;
      const submitDirect = vi.fn(async () => ({ id: 'direct' }));
      await expect(registerPlayer({ direct: DIRECT, server: SB }, { fetch: f, submitDirect, findLive: async () => mine() }))
        .resolves.toEqual({ id: 'r-written', via: 'server', warn: [] });
      await expect(registerPlayer({ direct: DIRECT, server: SB }, { fetch: f, submitDirect, findLive: async () => mine({ nonce: 'other-nonce-123' }) }))
        .rejects.toMatchObject({ code, message: 'Цим персонажем уже подано заявку…' });
      expect(submitDirect).not.toHaveBeenCalled();
    }
    // інші 4xx (закрито, немає зброї) — без пошуку
    const findLive = vi.fn(async () => mine());
    await expect(registerPlayer({ direct: DIRECT, server: SB }, { fetch: reply(409, { error: 'registration_closed', message: 'Закрито' }) as unknown as typeof fetch, submitDirect: async () => ({ id: 'x' }), findLive }))
      .rejects.toThrow('Закрито');
    expect(findLive).not.toHaveBeenCalled();
  });

  it('без бекенда (звичайний турнір, готові команди) дубль — без пошуку «своєї» заявки: та сама назва може бути чужою', async () => {
    const findLive = vi.fn(async () => mine({ characterId: null }));
    const dup = vi.fn(async () => { throw { code: '23505', message: 'duplicate key value' }; });
    await expect(registerPlayer({ direct: DIRECT, isTeam: true }, { submitDirect: dup, findLive })).rejects.toThrow('Ця назва команди уже зареєстрована на цей турнір.');
    expect(findLive).not.toHaveBeenCalled();
  });
});
