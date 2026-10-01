// Блок «Команди»: підпис блокування жеребки «N заявок не перевірено» — відмінки
// за числом. Сам блок — живі заявки й RPC, тож тут лише чиста функція;
// Supabase — заглушка (її тягнуть імпорти панелі).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../app/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));

const { unverifiedLabel } = await import('../TeamsPanel');

describe('unverifiedLabel', () => {
  it('1 заявка не перевірена · 2–4 заявки · 5+ заявок; 11–14 і 21 — як у мові', () => {
    expect(unverifiedLabel(1)).toBe('1 заявка не перевірена');
    expect(unverifiedLabel(2)).toBe('2 заявки не перевірено');
    expect(unverifiedLabel(4)).toBe('4 заявки не перевірено');
    expect(unverifiedLabel(5)).toBe('5 заявок не перевірено');
    expect(unverifiedLabel(11)).toBe('11 заявок не перевірено');
    expect(unverifiedLabel(12)).toBe('12 заявок не перевірено');
    expect(unverifiedLabel(21)).toBe('21 заявка не перевірена');
    expect(unverifiedLabel(22)).toBe('22 заявки не перевірено');
  });
});
