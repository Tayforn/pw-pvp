// =========================================================
// Панель заявок (адмінка): підтвердження — спершу статус, потім перерахунок
// неперевіреного скору v2 (клієнт гравця чи інша версія шкали); відхилена
// заявка, чий нік уже тримає жива (повторна подача, 0033), — без «Підтвердити».
// Supabase і перерахунок — заглушки.
// =========================================================

import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../app/supabaseClient', () => ({ supabase: {} }));

const { confirmRegistration, rejectedWithLiveTwin } = await import('../RegistrationsPanel');
const { BUILTIN_RULES_VERSION } = await import('../../../data/gearRules');
import type { ItemBreakdown, Registration, Tournament } from '../../../data/types';

const BD: ItemBreakdown = { v: 1, ver: BUILTIN_RULES_VERSION, sum: { main: 1, sets: 0, setsRaw: 0, pair: 0 }, rows: [], checked: true };
const T: Pick<Tournament, 'balanceRulesVersion'> = { balanceRulesVersion: null };

function reg(over: Partial<Registration> = {}): Registration {
  return {
    id: 'r1', tournamentId: 't-1', nickname: 'Tayforn', rulesAck: true, status: 'pending', createdAt: '2026-10-01T10:00:00Z', memberNicknames: null,
    kind: 'player', teamRegistrationId: null, gear: null, attackLevel: null, defenseLevel: null, scoreAdjust: 0, scoreAdjustNote: null,
    characterId: null, characterRev: null, characterSnapshot: { v: 2 }, dollConfirmedAt: null, dollPower: null, itemPoints: 200, itemBreakdown: null,
    rejectReason: null,
    ...over,
  };
}

describe('confirmRegistration', () => {
  it('спершу статус, потім перерахунок неперевіреного (клієнт гравця чи інша версія шкали)', async () => {
    const order: string[] = [];
    const run = { setStatus: vi.fn(async () => { order.push('status'); }), recalc: vi.fn(async () => { order.push('recalc'); }) };
    await confirmRegistration(reg(), T, run);
    expect(order).toEqual(['status', 'recalc']);
    order.length = 0;
    await confirmRegistration(reg({ itemBreakdown: { ...BD, ver: 'balance-v0.1-стара' } }), T, run);
    expect(order).toEqual(['status', 'recalc']);
  });

  it('перевірений за версією турніру, табличний чи без знімка — лише статус', async () => {
    for (const r of [reg({ itemBreakdown: BD }), reg({ itemPoints: null }), reg({ characterSnapshot: null })]) {
      const run = { setStatus: vi.fn(async () => {}), recalc: vi.fn(async () => {}) };
      await confirmRegistration(r, T, run);
      expect(run.setStatus).toHaveBeenCalledWith('r1');
      expect(run.recalc).not.toHaveBeenCalled();
    }
  });

  it('статус не змінився (нік уже тримає жива заявка) — перерахунок не запускається, нічого не записано', async () => {
    const run = { setStatus: vi.fn(async () => { throw new Error('У турнірі вже є жива заявка з цим ніком — підтвердь її, а стару видали.'); }), recalc: vi.fn(async () => {}) };
    await expect(confirmRegistration(reg(), T, run)).rejects.toThrow(/жива заявка з цим ніком/);
    expect(run.recalc).not.toHaveBeenCalled();
  });
});

describe('rejectedWithLiveTwin', () => {
  it('відхилена з ніком живої заявки (без урахування регістру) — так; інші — ні', () => {
    const rows = [
      reg({ id: 'old', status: 'rejected', nickname: 'Tayforn' }),
      reg({ id: 'new', status: 'pending', nickname: 'TAYFORN' }),
      reg({ id: 'solo', status: 'rejected', nickname: 'Ксенус' }),
      reg({ id: 'x', status: 'rejected', nickname: 'Volk' }),
      reg({ id: 'y', status: 'rejected', nickname: 'volk' }),
    ];
    expect([...rejectedWithLiveTwin(rows)]).toEqual(['old']);
    expect(rejectedWithLiveTwin([])).toEqual(new Set());
  });
});
