import { beforeEach, describe, expect, it, vi } from 'vitest';

// tournaments.ts тягне клієнт Supabase — тут його заміняє заглушка, що запам'ятовує
// insert/update і віддає один турнір на select (для перевірки «реєстрація відкрита»).
const db = vi.hoisted(() => ({
  tournament: null as Record<string, unknown> | null,
  writes: [] as Array<{ table: string; op: 'insert' | 'update'; row: Record<string, unknown>; id?: string }>,
}));
vi.mock('../../app/supabaseClient', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.tournament, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        db.writes.push({ table, op: 'insert', row });
        return { error: null };
      },
      update: (row: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          db.writes.push({ table, op: 'update', row, id });
          return { error: null };
        },
      }),
    }),
  },
}));

import { likePattern, registrationFromRow, submitRegistration, updateRegistrationItemPoints, type RegistrationRow } from '../tournaments';
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
  const character = { id: 'c1', revision: 3, snapshot: { v: 2, name: 'Tayforn' }, power: { off: 100, def: 200, pa: 50, pz: 40, engine: 1 } };
  const lastInsert = () => {
    const w = db.writes.find((x) => x.op === 'insert');
    if (!w) throw new Error('insert не викликано');
    return w;
  };

  beforeEach(() => {
    db.tournament = OPEN;
    db.writes.length = 0;
  });

  it('заявка без itemPoints/itemBreakdown не пише колонок 0032 (до міграції insert не падає)', async () => {
    await submitRegistration({ tournamentId: 't1', nickname: 'Tayforn', rulesAck: true, character });
    const w = lastInsert();
    expect(w.table).toBe('registrations');
    expect(w.row).toMatchObject({ tournament_id: 't1', nickname: 'Tayforn', rules_ack: true, member_nicknames: null, character_id: 'c1', character_rev: 3, doll_power: character.power });
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
});
