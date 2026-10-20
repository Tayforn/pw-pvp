// =========================================================
// ЛЯЛЬКА — «Мої соклани» (pages/ClanPage): чисті помічники сторінки (групи за
// власником, документ копії) і перший рендер списку та картки чужого персонажа
// через renderToStaticMarkup (jsdom у проєкті нема, ефекти не виконуються —
// тож це стан «завантажую» без мережі; сам редактор перевіряє димовий тест
// сторінки персонажа, а бекенд — server/test/pvp.test.ts у pw-ladder).
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));
import { emptyDoc } from '../model/doc';
import type { ClanCharacterSummary } from '../api/characters';
import ClanPage, { copyDoc, groupByOwner } from '../../pages/ClanPage';

const sum = (id: string, ownerId: string, nickname: string, over: Partial<ClanCharacterSummary> = {}): ClanCharacterSummary => ({
  id, name: 'Перс ' + id, cls: 'rl', level: 105, revision: 1, updatedAt: '2026-10-01T10:00:00Z', items: 3, sets: 1,
  owner: { id: ownerId, nickname, avatarUrl: null }, ...over,
});

describe('groupByOwner', () => {
  it('тримає порядок сервера, персонажі одного власника — в одній групі', () => {
    const groups = groupByOwner([sum('a', 'p1', 'Alice'), sum('b', 'p2', 'Bob'), sum('c', 'p1', 'Alice')]);
    expect(groups.map((g) => [g.owner.nickname, g.characters.map((c) => c.id)])).toEqual([
      ['Alice', ['a', 'c']],
      ['Bob', ['b']],
    ]);
    expect(groupByOwner([])).toEqual([]);
  });
});

describe('copyDoc', () => {
  it('копія — уся лялька з примірками, але без імені; оригінал не змінюється', () => {
    const src = { ...emptyDoc('rl'), name: 'Лучник Боба', level: 104 };
    const c = copyDoc(src);
    expect(c.name).toBe('');
    expect({ ...c, name: src.name }).toEqual(src);
    expect(src.name).toBe('Лучник Боба');
  });
});

describe('ClanPage — перший рендер', () => {
  it('список: заголовок і стан завантаження', () => {
    const html = renderToStaticMarkup(<ClanPage id={null} />);
    expect(html).toContain('Мої соклани');
    expect(html).toContain('Завантажую персонажів сокланів…');
  });
  it('чужий персонаж: стан завантаження без редактора', () => {
    const html = renderToStaticMarkup(<ClanPage id="58bad6ae-3041-4311-bb22-4b58ab40eda9" />);
    expect(html).toContain('Завантажую персонажа…');
    expect(html).not.toContain('doll-bar');
  });
});
