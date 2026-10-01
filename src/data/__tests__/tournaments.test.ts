import { beforeEach, describe, expect, it, vi } from 'vitest';

// tournaments.ts тягне клієнт Supabase — тут його заміняє заглушка, що запам'ятовує
// insert/update і віддає один турнір на select (для перевірки «реєстрація відкрита»);
// select заявок (id нової заявки, статус за ніком) — з черги lookups, фільтри — у selects.
type DbError = { code?: string; message?: string } | null;
const db = vi.hoisted(() => ({
  tournament: null as Record<string, unknown> | null,
  writes: [] as Array<{ table: string; op: 'insert' | 'update'; row: Record<string, unknown>; id?: string }>,
  /** Помилки наступних insert/update по черзі (порожня черга — успіх). */
  insertErrors: [] as Array<{ code?: string; message?: string } | null>,
  updateErrors: [] as Array<{ code?: string; message?: string } | null>,
  /** Відповіді наступних select із registrations (порожня черга — {id: 'reg-new'}). */
  lookups: [] as Array<{ data: unknown; error: { code?: string; message?: string } | null }>,
  selects: [] as Array<{ table: string; calls: unknown[][] }>,
}));
vi.mock('../../app/supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      select: (cols?: string) => {
        const calls: unknown[][] = [['select', cols]];
        db.selects.push({ table, calls });
        const b: Record<string, unknown> = {};
        for (const m of ['eq', 'neq', 'ilike', 'in', 'or', 'order', 'limit']) {
          b[m] = (...args: unknown[]) => {
            calls.push([m, ...args]);
            return b;
          };
        }
        b.maybeSingle = async () =>
          table === 'tournaments' ? { data: db.tournament, error: null } : db.lookups.shift() ?? { data: { id: 'reg-new' }, error: null };
        return b;
      },
      insert: async (row: Record<string, unknown>) => {
        db.writes.push({ table, op: 'insert', row });
        return { error: db.insertErrors.shift() ?? null };
      },
      update: (row: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          db.writes.push({ table, op: 'update', row, id });
          return { error: db.updateErrors.shift() ?? null };
        },
      }),
    }),
  },
}));

import {
  LIVE_DUPLICATE_TEXT, fetchPlayerStatusByNickname, findLiveRegistration, isMissingColumnError, likePattern, registrationFromRow, setRegistrationStatus, submitRegistration,
  updateRegistrationItemPoints, type RegistrationRow,
} from '../tournaments';
import { isPastTournament, type ItemBreakdown } from '../types';

describe('likePattern (екранування ніка для ilike)', () => {
  it('«_», «%», «\\» і «*» стають літералами, решта — без змін', () => {
    expect(likePattern('Dark_Lord')).toBe('Dark\\_Lord');
    expect(likePattern('100%')).toBe('100\\%');
    expect(likePattern('a\\b')).toBe('a\\\\b');
    expect(likePattern('*Star*')).toBe('\\*Star\\*');
    expect(likePattern('Тайфорн')).toBe('Тайфорн');
    expect(likePattern('')).toBe('');
  });
});

describe('isPastTournament (що гість бачить без входу)', () => {
  const today = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const yesterday = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const tomorrow = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

  it('завершений і скасований — минулі, хоч би й із майбутньою датою', () => {
    expect(isPastTournament({ status: 'completed', eventDate: tomorrow })).toBe(true);
    expect(isPastTournament({ status: 'cancelled', eventDate: tomorrow })).toBe(true);
  });

  it('дата минула, а статус не перевели — теж минулий; «Триває» — ні', () => {
    expect(isPastTournament({ status: 'registration_closed', eventDate: yesterday })).toBe(true);
    expect(isPastTournament({ status: 'registration_open', eventDate: yesterday })).toBe(true);
    expect(isPastTournament({ status: 'in_progress', eventDate: yesterday })).toBe(false);
  });

  it('сьогоднішній і майбутній — поточні', () => {
    expect(isPastTournament({ status: 'registration_open', eventDate: iso(today) })).toBe(false);
    expect(isPastTournament({ status: 'registration_closed', eventDate: tomorrow })).toBe(false);
  });
});

// ── Скор v2 у заявці (0032): маппінг колонок і запис лише коли передано ──

const ROW: RegistrationRow = {
  id: 'r1', tournament_id: 't1', nickname: 'Tayforn', rules_ack: true, status: 'pending', created_at: '2026-09-25T16:23:52Z', member_nicknames: null,
};
const BREAKDOWN: ItemBreakdown = {
  v: 1, ver: 'balance-v1.0',
  sum: { cls: 8, lvl: 7, genie: 10, main: 251.85, sets: 11.83, setsRaw: 11.83, pair: 5 },
  rows: [[0, 'ta', 1927, 101.17, 'r9r2 60 · +12 25 · кам 1.2 · ka 15'], [2, 'ta', 1816, 21, 'свап: ПЗ 21'], [1, 'qn', 92, 8]],
  warn: ['«Шлем героя» у 2 екземплярах'],
};

describe('registrationFromRow: item_points / item_breakdown (0032)', () => {
  it('до міграції колонок немає → null; решта рядка читається як раніше', () => {
    const r = registrationFromRow(ROW);
    expect(r.itemPoints).toBeNull();
    expect(r.itemBreakdown).toBeNull();
    expect(r).toMatchObject({ id: 'r1', kind: 'player', gear: null, dollPower: null, scoreAdjust: 0, characterSnapshot: null });
    expect(registrationFromRow({ ...ROW, item_points: null, item_breakdown: null })).toMatchObject({ itemPoints: null, itemBreakdown: null });
  });

  it('число — як є, numeric рядком — Number(); зламане чи від’ємне → null', () => {
    expect(registrationFromRow({ ...ROW, item_points: 268.68 }).itemPoints).toBe(268.68);
    expect(registrationFromRow({ ...ROW, item_points: 0 }).itemPoints).toBe(0);
    expect(registrationFromRow({ ...ROW, item_points: '268.68' }).itemPoints).toBe(268.68);
    expect(registrationFromRow({ ...ROW, item_points: -1 }).itemPoints).toBeNull();
    expect(registrationFromRow({ ...ROW, item_points: 'abc' }).itemPoints).toBeNull();
    expect(registrationFromRow({ ...ROW, item_points: '' }).itemPoints).toBeNull();
    expect(registrationFromRow({ ...ROW, item_points: Number.NaN }).itemPoints).toBeNull();
  });

  it('розклад цілої форми проходить як є (JSON-копія); зайві ключі відкидаються', () => {
    const r = registrationFromRow({ ...ROW, item_points: 268.68, item_breakdown: JSON.parse(JSON.stringify(BREAKDOWN)) });
    expect(r.itemBreakdown).toEqual(BREAKDOWN);
    expect(r.itemBreakdown).not.toBe(BREAKDOWN);
    // без необов’язкових складових і без warn — теж ціла форма
    const min = registrationFromRow({ ...ROW, item_breakdown: { v: 1, ver: 'balance-v1.0', sum: { main: 1, sets: 0, setsRaw: 0, pair: 0 }, rows: [] } }).itemBreakdown;
    expect(min).toEqual({ v: 1, ver: 'balance-v1.0', sum: { main: 1, sets: 0, setsRaw: 0, pair: 0 }, rows: [] });
    expect(min).not.toHaveProperty('warn');
    const extra = registrationFromRow({ ...ROW, item_breakdown: { ...BREAKDOWN, junk: 1, sum: { ...BREAKDOWN.sum, junk: 2 }, warn: ['ok', 5, null] } }).itemBreakdown!;
    expect(extra).not.toHaveProperty('junk');
    expect(extra.sum).not.toHaveProperty('junk');
    expect(extra.warn).toEqual(['ok']);
  });

  it('checked («перевірено» після перерахунку в адмінці) проходить лише як справжнє true', () => {
    expect(registrationFromRow({ ...ROW, item_breakdown: { ...BREAKDOWN, checked: true } }).itemBreakdown).toEqual({ ...BREAKDOWN, checked: true });
    for (const v of [false, 'true', 1, null]) {
      expect(registrationFromRow({ ...ROW, item_breakdown: { ...BREAKDOWN, checked: v } }).itemBreakdown, String(v)).not.toHaveProperty('checked');
    }
  });

  it('зламаний розклад → null, а itemPoints від нього не залежить', () => {
    const bad: unknown[] = [
      'x', 5, [], { v: 2, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: [] }, { v: 1, sum: BREAKDOWN.sum, rows: [] },
      { v: 1, ver: 'balance-v1.0', rows: [] }, { v: 1, ver: 'balance-v1.0', sum: { main: 1, sets: 0, setsRaw: 0 }, rows: [] },
      { v: 1, ver: 'balance-v1.0', sum: { main: 'x', sets: 0, setsRaw: 0, pair: 0 }, rows: [] },
      { v: 1, ver: 'balance-v1.0', sum: { main: 1, sets: 0, setsRaw: 0, pair: 0, cls: '8' }, rows: [] },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: {} },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: [[0, 'ta', 1927]] },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: [[0, 'ta', 1927, 'x']] },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: [['0', 'ta', 1927, 1]] },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: [[0, 7, 1927, 1]] },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: [[0, 'ta', 1927, 1, 5]] },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: [[0, 'ta', 1927, 1, 'why', 'extra']] },
      { v: 1, ver: 'balance-v1.0', sum: BREAKDOWN.sum, rows: ['not a row'] },
    ];
    for (const b of bad) {
      const r = registrationFromRow({ ...ROW, item_points: 12.5, item_breakdown: b });
      expect(r.itemBreakdown, JSON.stringify(b)).toBeNull();
      expect(r.itemPoints).toBe(12.5);
    }
  });
});

describe('submitRegistration / updateRegistrationItemPoints (0032)', () => {
  const OPEN = {
    id: 't1', series_id: null, name: 'Турнір', event_date: '2999-12-31', status: 'registration_open', rules_md: null, prizes_md: null,
    bracket_type: 'single_elim', bracket_size: null, team_size: 3, created_by: null, visibility: 'public', third_place_match: false, bracket_new_look: true,
    team_mode: 'balanced_random',
  };
  const character = { snapshot: { v: 2, name: 'Tayforn' }, power: { off: 100, def: 200, pa: 50, pz: 40, engine: 1 } };
  const lastInsert = () => {
    const w = db.writes.find((x) => x.op === 'insert');
    if (!w) throw new Error('insert не викликано');
    return w;
  };

  const inserts = () => db.writes.filter((w) => w.op === 'insert');
  /** PostgREST до міграції 0032: колонки немає в кеші схеми. */
  const NO_COLUMN: DbError = { code: 'PGRST204', message: "Could not find the 'item_points' column of 'registrations' in the schema cache" };
  const withV2 = { tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character: { ...character, itemPoints: 268.68, itemBreakdown: BREAKDOWN } };

  beforeEach(() => {
    db.tournament = OPEN;
    db.writes.length = 0;
    db.insertErrors.length = 0;
    db.updateErrors.length = 0;
    db.lookups.length = 0;
    db.selects.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // ── Шлях гравця: id нової заявки («Мої заявки» шукають свою заявку за ним) ──

  it('після insert повертає id живої заявки з цим ніком на турнір (не відхиленої)', async () => {
    db.lookups.push({ data: { id: 'r-77' }, error: null });
    await expect(submitRegistration({ tournamentId: 't1', nickname: ' Dark_Lord ', rulesAck: true })).resolves.toEqual({ id: 'r-77' });
    const q = db.selects.find((x) => x.table === 'registrations')!;
    expect(q.calls).toEqual(expect.arrayContaining([
      ['select', 'id, created_at, character_id, nonce:item_breakdown->>nonce'], ['eq', 'tournament_id', 't1'], ['eq', 'kind', 'player'], ['neq', 'status', 'rejected'], ['ilike', 'nickname', 'Dark\\_Lord'],
    ]));
  });

  it('findLiveRegistration: id, час створення, персонаж і мітка спроби живої заявки з ніком; нічого — null', async () => {
    db.lookups.push({ data: { id: 'r-5', created_at: '2026-10-01T10:00:00Z', character_id: 'c1', nonce: 'n-12345678' }, error: null });
    await expect(findLiveRegistration('t1', 'Tayforn')).resolves.toEqual({ id: 'r-5', createdAt: '2026-10-01T10:00:00Z', characterId: 'c1', nonce: 'n-12345678' });
    db.lookups.push({ data: { id: 'r-6', created_at: '2026-10-01T10:00:00Z', nonce: null }, error: null });
    await expect(findLiveRegistration('t1', 'Гість')).resolves.toEqual({ id: 'r-6', createdAt: '2026-10-01T10:00:00Z', characterId: null, nonce: null });
    db.lookups.push({ data: null, error: null });
    await expect(findLiveRegistration('t1', 'Ніхто')).resolves.toBeNull();
    db.lookups.push({ data: null, error: { code: '500', message: 'мережа' } });
    await expect(findLiveRegistration('t1', 'Tayforn')).rejects.toMatchObject({ message: 'мережа' });
  });

  it('fetchPlayerStatusByNickname: нік тримає жива заявка — її статус, навіть коли є й відхилена (повторна подача, 0033)', async () => {
    db.lookups.push({ data: { status: 'pending' }, error: null });
    await expect(fetchPlayerStatusByNickname('t1', 'Tayforn')).resolves.toBe('pending');
    const regs = db.selects.filter((x) => x.table === 'registrations');
    expect(regs).toHaveLength(1);
    expect(regs[0].calls).toEqual(expect.arrayContaining([['eq', 'tournament_id', 't1'], ['eq', 'kind', 'player'], ['ilike', 'nickname', 'Tayforn'], ['neq', 'status', 'rejected']]));
    // живої немає — лише тоді відхилена (до 0033 вона блокує нік)
    db.selects.length = 0;
    db.lookups.push({ data: null, error: null }, { data: { status: 'rejected' }, error: null });
    await expect(fetchPlayerStatusByNickname('t1', 'Tayforn')).resolves.toBe('rejected');
    const two = db.selects.filter((x) => x.table === 'registrations');
    expect(two).toHaveLength(2);
    expect(two[1].calls.some((c) => c[0] === 'neq')).toBe(false);
    // ні живої, ні відхиленої — null; помилка — нагору
    db.lookups.push({ data: null, error: null }, { data: null, error: null });
    await expect(fetchPlayerStatusByNickname('t1', 'Tayforn')).resolves.toBeNull();
    db.lookups.push({ data: null, error: { code: '500', message: 'мережа' } });
    await expect(fetchPlayerStatusByNickname('t1', 'Tayforn')).rejects.toMatchObject({ message: 'мережа' });
  });

  it('заявку прийнято, а id прочитати не вдалося — не помилка подачі: id null', async () => {
    db.lookups.push({ data: null, error: { code: '500', message: 'мережа' } });
    await expect(submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true })).resolves.toEqual({ id: null });
    expect(inserts()).toHaveLength(1);
    // insert упав — до читання id не доходить
    db.selects.length = 0;
    db.insertErrors.push({ code: '23505', message: 'duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"' });
    await expect(submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true })).rejects.toMatchObject({ code: '23505' });
    expect(db.selects.filter((x) => x.table === 'registrations')).toHaveLength(0);
  });

  it('прямий insert ніколи не пише character_id (чий персонаж — перевіряє лише бекенд): null, знімок — як є', async () => {
    const snapshot = { v: 2, name: '' };
    await submitRegistration({ tournamentId: 't1', nickname: 'Гість', rulesAck: true, character: { snapshot, power: null } });
    const w = lastInsert();
    expect(w.row).toMatchObject({ character_id: null, character_rev: null });
    expect(w.row.character_snapshot).toBe(snapshot);
    expect(w.row).not.toHaveProperty('doll_power');
  });

  it('заявка без itemPoints/itemBreakdown не пише колонок 0032 (до міграції insert не падає)', async () => {
    await submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character });
    const w = lastInsert();
    expect(w.table).toBe('registrations');
    expect(w.row).toMatchObject({ tournament_id: 't1', nickname: 'Tayforn', rules_ack: true, member_nicknames: null, character_id: null, character_rev: null, doll_power: character.power });
    expect(w.row.character_snapshot).toBe(character.snapshot);
    expect(w.row).not.toHaveProperty('item_points');
    expect(w.row).not.toHaveProperty('item_breakdown');
    // звичайна анкета без персонажа — теж без них (і без колонок 0028/0029, як і раніше)
    db.writes.length = 0;
    await submitRegistration({ tournamentId: 't1', nickname: 'Гість', rulesAck: true });
    expect(Object.keys(lastInsert().row).sort()).toEqual(['member_nicknames', 'nickname', 'rules_ack', 'tournament_id']);
  });

  it('передані itemPoints і itemBreakdown ідуть у item_points / item_breakdown як є', async () => {
    await submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character: { ...character, itemPoints: 268.68, itemBreakdown: BREAKDOWN } });
    const w = lastInsert();
    expect(w.row.item_points).toBe(268.68);
    expect(w.row.item_breakdown).toBe(BREAKDOWN);
    // явний null — теж пишеться (колонка порожня, скор табличний)
    db.writes.length = 0;
    await submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character: { ...character, itemPoints: null, itemBreakdown: null } });
    expect(lastInsert().row).toMatchObject({ item_points: null, item_breakdown: null });
  });

  it('закрита реєстрація — помилка ще до insert', async () => {
    db.tournament = { ...OPEN, status: 'registration_closed' };
    await expect(submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character })).rejects.toThrow(/закрита/);
    db.tournament = null;
    await expect(submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character })).rejects.toThrow(/закрита/);
    expect(db.writes).toEqual([]);
  });

  it('updateRegistrationItemPoints пише обидві колонки за id; null — стирає', async () => {
    await updateRegistrationItemPoints('r1', 268.68, BREAKDOWN);
    expect(db.writes).toEqual([{ table: 'registrations', op: 'update', id: 'r1', row: { item_points: 268.68, item_breakdown: BREAKDOWN } }]);
    db.writes.length = 0;
    await updateRegistrationItemPoints('r1', null, null);
    expect(db.writes).toEqual([{ table: 'registrations', op: 'update', id: 'r1', row: { item_points: null, item_breakdown: null } }]);
  });

  // ── Запасний шлях до міграції 0032 (власник ще не виконав її) ──

  it('до 0032: insert падає на відсутній колонці → один повтор без item_points/item_breakdown, решта колонок як була', async () => {
    db.insertErrors.push(NO_COLUMN);
    await submitRegistration(withV2);
    const ins = inserts();
    expect(ins).toHaveLength(2);
    expect(ins[0].row).toMatchObject({ item_points: 268.68, item_breakdown: BREAKDOWN });
    expect(ins[1].row).not.toHaveProperty('item_points');
    expect(ins[1].row).not.toHaveProperty('item_breakdown');
    expect(ins[1].row).toMatchObject({ tournament_id: 't1', nickname: 'Tayforn', character_id: null, character_rev: null, doll_power: character.power });
    expect(ins[1].row.character_snapshot).toBe(character.snapshot);
    expect(Object.keys(ins[1].row).sort()).toEqual(Object.keys(ins[0].row).filter((k) => k !== 'item_points' && k !== 'item_breakdown').sort());
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('0032'));
    // Postgres undefined_column і текст про колонку без коду — теж запасний шлях
    for (const e of [{ code: '42703', message: 'column "item_breakdown" of relation "registrations" does not exist' }, { message: 'column item_points does not exist' }]) {
      db.writes.length = 0;
      db.insertErrors.push(e);
      await submitRegistration(withV2);
      expect(inserts(), JSON.stringify(e)).toHaveLength(2);
    }
  });

  it('повтор лише один: друга помилка йде нагору; інша помилка (дубль ніка, RLS) — без повтору; без полів 0032 — без повтору', async () => {
    db.insertErrors.push(NO_COLUMN, { code: '23505', message: 'duplicate key value violates unique constraint "registrations_tournament_nickname"' });
    await expect(submitRegistration(withV2)).rejects.toMatchObject({ code: '23505' });
    expect(inserts()).toHaveLength(2);
    db.writes.length = 0;
    db.insertErrors.push({ code: '42501', message: 'new row violates row-level security policy for table "registrations"' });
    await expect(submitRegistration(withV2)).rejects.toMatchObject({ code: '42501' });
    expect(inserts()).toHaveLength(1);
    // заявка без itemPoints/itemBreakdown (чи без персонажа) повторювати нічого — помилка як є
    db.writes.length = 0;
    db.insertErrors.push(NO_COLUMN);
    await expect(submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character })).rejects.toMatchObject({ code: 'PGRST204' });
    expect(inserts()).toHaveLength(1);
  });

  it('updateRegistrationItemPoints до 0032 — зрозуміла помилка про міграцію; інші помилки — як є', async () => {
    db.updateErrors.push(NO_COLUMN);
    await expect(updateRegistrationItemPoints('r1', 1, null)).rejects.toThrow(/міграцію 0032/);
    db.updateErrors.push({ code: '42501', message: 'row-level security' });
    await expect(updateRegistrationItemPoints('r1', 1, null)).rejects.toMatchObject({ code: '42501' });
  });

  it('isMissingColumnError: коди PGRST204 / 42703 або текст про колонку 0032', () => {
    expect(isMissingColumnError({ code: 'PGRST204', message: 'x' })).toBe(true);
    expect(isMissingColumnError({ code: '42703', message: 'x' })).toBe(true);
    expect(isMissingColumnError({ message: 'Column item_breakdown not found' })).toBe(true);
    expect(isMissingColumnError({ message: 'column foo does not exist' })).toBe(false); // не наша колонка
    expect(isMissingColumnError({ message: 'item_points must be >= 0' })).toBe(false); // CHECK, не відсутня колонка
    expect(isMissingColumnError({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingColumnError({})).toBe(false);
  });
});

describe('шлях гравця: причина відхилення (0033)', () => {
  beforeEach(() => {
    db.writes.length = 0;
    db.updateErrors.length = 0;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('registrationFromRow: reject_reason — обрізаний текст; до міграції, порожньо чи не рядок — null', () => {
    expect(registrationFromRow({ ...ROW, status: 'rejected', reject_reason: '  інший трактат  ' }).rejectReason).toBe('інший трактат');
    expect(registrationFromRow(ROW).rejectReason).toBeNull();
    expect(registrationFromRow({ ...ROW, reject_reason: '   ' }).rejectReason).toBeNull();
    expect(registrationFromRow({ ...ROW, reject_reason: 5 as unknown as string }).rejectReason).toBeNull();
  });

  it('відхилення пише статус і причину (порожня — null, щоб не лишалась стара; довга — до 200)', async () => {
    await expect(setRegistrationStatus('r1', 'rejected', '  лялька не збігається з грою ')).resolves.toEqual({ reasonSaved: true });
    await setRegistrationStatus('r2', 'rejected', '');
    await setRegistrationStatus('r3', 'rejected', 'x'.repeat(250));
    expect(db.writes).toEqual([
      { table: 'registrations', op: 'update', id: 'r1', row: { status: 'rejected', reject_reason: 'лялька не збігається з грою' } },
      { table: 'registrations', op: 'update', id: 'r2', row: { status: 'rejected', reject_reason: null } },
      { table: 'registrations', op: 'update', id: 'r3', row: { status: 'rejected', reject_reason: 'x'.repeat(200) } },
    ]);
    // будь-який інший статус стирає стару причину; відхилення без аргументу причини (старі виклики) — лише статус
    db.writes.length = 0;
    await expect(setRegistrationStatus('r1', 'confirmed')).resolves.toEqual({ reasonSaved: true });
    await setRegistrationStatus('r1', 'pending', 'ігнорується');
    await setRegistrationStatus('r1', 'rejected');
    expect(db.writes.map((w) => w.row)).toEqual([{ status: 'confirmed', reject_reason: null }, { status: 'pending', reject_reason: null }, { status: 'rejected' }]);
  });

  it('підтвердження до 0033 (колонки немає): повтор лише зі статусом, без зайвих попереджень гравцю', async () => {
    db.updateErrors.push({ code: 'PGRST204', message: "Could not find the 'reject_reason' column of 'registrations' in the schema cache" });
    await expect(setRegistrationStatus('r1', 'confirmed')).resolves.toEqual({ reasonSaved: true });
    expect(db.writes.map((w) => w.row)).toEqual([{ status: 'confirmed', reject_reason: null }, { status: 'confirmed' }]);
  });

  it('підтвердити відхилену, коли нік уже тримає жива заявка (0033), — зрозумілий текст замість сирого 23505', async () => {
    const dup = { code: '23505', message: 'duplicate key value violates unique constraint "registrations_tournament_nickname_uidx"' };
    db.updateErrors.push(dup);
    await expect(setRegistrationStatus('r1', 'confirmed')).rejects.toThrow(LIVE_DUPLICATE_TEXT);
    expect(db.writes).toHaveLength(1);
    // і в повторі до 0033 (теоретично) — так само
    db.writes.length = 0;
    db.updateErrors.push({ code: '42703', message: 'column "reject_reason" does not exist' }, { message: 'violates unique constraint "registrations_tournament_nickname_uidx"' });
    await expect(setRegistrationStatus('r1', 'pending')).rejects.toThrow(LIVE_DUPLICATE_TEXT);
    // інша помилка підтвердження — як є
    db.updateErrors.push({ code: '42501', message: 'new row violates row-level security policy' });
    await expect(setRegistrationStatus('r1', 'confirmed')).rejects.toMatchObject({ code: '42501' });
  });

  it('до 0033 (колонки немає): повтор лише зі статусом; причину не збережено — так і кажемо; інша помилка — нагору', async () => {
    db.updateErrors.push({ code: 'PGRST204', message: "Could not find the 'reject_reason' column of 'registrations' in the schema cache" });
    await expect(setRegistrationStatus('r1', 'rejected', 'дубль акаунта')).resolves.toEqual({ reasonSaved: false });
    expect(db.writes.map((w) => w.row)).toEqual([{ status: 'rejected', reject_reason: 'дубль акаунта' }, { status: 'rejected' }]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('0033'));
    // без причини втрачати нічого — reasonSaved true
    db.writes.length = 0;
    db.updateErrors.push({ code: '42703', message: 'column "reject_reason" of relation "registrations" does not exist' });
    await expect(setRegistrationStatus('r1', 'rejected', '  ')).resolves.toEqual({ reasonSaved: true });
    expect(db.writes).toHaveLength(2);
    db.writes.length = 0;
    db.updateErrors.push({ code: '42501', message: 'new row violates row-level security policy' });
    await expect(setRegistrationStatus('r1', 'rejected', 'x')).rejects.toMatchObject({ code: '42501' });
    expect(db.writes).toHaveLength(1);
  });

  it('isMissingColumnError з назвою колонки: текст про неї, а не про колонки 0032', () => {
    expect(isMissingColumnError({ message: 'column reject_reason does not exist' }, 'reject_reason')).toBe(true);
    expect(isMissingColumnError({ message: 'column item_points does not exist' }, 'reject_reason')).toBe(false);
    expect(isMissingColumnError({ code: 'PGRST204', message: 'x' }, 'reject_reason')).toBe(true);
  });
});
