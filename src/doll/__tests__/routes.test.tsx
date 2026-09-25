// =========================================================
// ЛЯЛЬКА — стик із сайтом: адреси /characters і /characters/:id, доступ
// гостя без входу й пункт «Персонаж» у сайдбарі. Сторінку відкривають за
// посиланням (F5, «Поділитися»), тож розбір адреси — частина контракту.
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_ACCESS, canOpen } from '../../app/access';
import { routeUrl, useRoute, type Route } from '../../app/useRoute';
import Sidebar from '../../components/Sidebar';

const GUEST = { member: false, admin: false };

/** Маршрут, який useRoute розбере з адреси (перший рендер читає location). */
function parse(pathname: string): Route {
  vi.stubGlobal('location', { pathname, search: '', hash: '', href: 'http://localhost' + pathname });
  let got: Route | null = null;
  function Probe() {
    got = useRoute()[0];
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return got!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('маршрути персонажа', () => {
  it('/characters і /characters/:id розбираються, решта — як було', () => {
    expect(parse('/characters')).toEqual({ name: 'characters' });
    expect(parse('/characters/')).toEqual({ name: 'characters' });
    expect(parse('/characters/new')).toEqual({ name: 'character', id: 'new' });
    expect(parse('/characters/ab12_x-9')).toEqual({ name: 'character', id: 'ab12_x-9' });
    // id зі спецсимволами не потрапляє в сторінку — просто список (поки = чернетка)
    expect(parse('/characters/' + encodeURIComponent('<x>'))).toEqual({ name: 'characters' });
    expect(parse('/rules')).toEqual({ name: 'rules' });
    expect(parse('/t/abc/bracket')).toEqual({ name: 'tournament-bracket', id: 'abc' });
  });

  it('routeUrl — зворотне до розбору', () => {
    expect(routeUrl({ name: 'characters' })).toBe('/characters');
    expect(routeUrl({ name: 'character', id: 'new' })).toBe('/characters/new');
    expect(parse(routeUrl({ name: 'character', id: 'k7' }))).toEqual({ name: 'character', id: 'k7' });
  });

  it('обидва маршрути відкриті гостю', () => {
    expect(ROUTE_ACCESS.characters).toBe('public');
    expect(ROUTE_ACCESS.character).toBe('public');
    expect(canOpen('characters', GUEST)).toBe(true);
    expect(canOpen('character', GUEST)).toBe(true);
  });

  it('сайдбар гостя має «Персонаж», і він підсвічений на /characters/:id', () => {
    const html = renderToStaticMarkup(<Sidebar route={{ name: 'character', id: 'new' }} viewer={GUEST} onNavigate={() => {}} />);
    expect(html).toMatch(/class="tab active"[^>]*>(?:(?!<\/button>).)*Персонаж/);
    expect(html.match(/class="tab active"/g)).toHaveLength(1);
    expect(html).not.toContain('Адмінка');
  });
});
