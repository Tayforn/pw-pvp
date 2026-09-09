import { describe, expect, it, vi } from 'vitest';

// tournaments.ts тягне клієнт Supabase; тут лише чиста функція.
vi.mock('../../app/supabaseClient', () => ({ supabase: {} }));

import { likePattern } from '../tournaments';

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
