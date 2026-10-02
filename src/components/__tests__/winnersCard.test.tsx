import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import WinnersCard, { eventDateLabel, winsWord } from '../WinnersCard';

const PODIUM = {
  first: 'Команда 3',
  second: 'Команда 6',
  third: 'Команда 1',
  members: {
    first: ['Volk', 'Infernoman(Арсен)', 'XenuS'],
    second: ['Ash', 'DudeIsFine', 'under_armour (Sergey)'],
    third: ['EddieMunson', '~FreeKill~', 'NeO[N]'],
  },
};
const STATS = [
  { nickname: 'Меркурі', count: 2 },
  { nickname: 'Infernoman(Арсен)', count: 1 },
  { nickname: 'Volk', count: 1 },
  { nickname: 'XenuS', count: 1 },
];

const render = (over: Partial<Parameters<typeof WinnersCard>[0]> = {}) =>
  renderToStaticMarkup(
    <WinnersCard name="Турнір до «Битви скринь»" eventDate="2026-09-25" statusLabel="Завершено" podium={PODIUM} stats={STATS} onOpen={() => {}} {...over} />,
  );

describe('WinnersCard', () => {
  it('пʼєдестал 2–1–3 зі складами, назва й дата турніру, кнопка до сітки', () => {
    const html = render();
    expect(html).toContain('Турнір до «Битви скринь»');
    expect(html).toContain('25 вересня 2026');
    expect(html).toContain('Сітка й результати');
    const order = [...html.matchAll(/class="home-podium-card (p\d)"/g)].map((m) => m[1]);
    expect(order).toEqual(['p2', 'p1', 'p3']);
    expect(html).toContain('>Чемпіон<');
    expect(html).toContain('<span class="home-podium-nick">Infernoman(Арсен)</span>');
    expect(html).toContain('aria-label="1 місце: Команда 3 (Volk, Infernoman(Арсен), XenuS)"');
  });

  it('зал слави: однакова кількість — однакове місце, смужка відносно лідера', () => {
    const html = render();
    const ranks = [...html.matchAll(/class="home-fame-rank">(\d+)</g)].map((m) => Number(m[1]));
    expect(ranks).toEqual([1, 2, 2, 2]);
    expect(html).toContain('style="width:100%"');
    expect(html).toContain('style="width:50%"');
    expect(html).toContain('<b>2</b> перемоги');
  });

  it('без турнірів, без переможця й без складу команд (соло) — зрозумілі стани', () => {
    expect(render({ name: null, eventDate: null, podium: null, stats: [], onOpen: null })).toContain('Ще не було жодного турніру.');
    const pending = render({ podium: null, statusLabel: 'Триває' });
    expect(pending).toContain('Переможця ще не визначено · триває.');
    const solo = render({ podium: { first: 'Volk', second: null, third: null, members: { first: null, second: null, third: null } } });
    expect(solo.match(/home-podium-card/g)).toHaveLength(1);
    expect(solo).not.toContain('home-podium-roster');
  });

  it('winsWord і дата', () => {
    expect([1, 2, 5, 11, 21, 22].map(winsWord)).toEqual(['перемога', 'перемоги', 'перемог', 'перемог', 'перемога', 'перемоги']);
    expect(eventDateLabel('2026-01-01')).toBe('1 січня 2026');
    expect(eventDateLabel('не дата')).toBe('не дата');
  });
});
