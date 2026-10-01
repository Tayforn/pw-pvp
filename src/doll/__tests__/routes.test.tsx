// =========================================================
// ЛЯЛЬКА — стик із сайтом: адреси /characters і /characters/:id, доступ
// гостя без входу й пункт «Персонаж» у сайдбарі. Сторінку відкривають за
// посиланням (F5, «Поділитися»), тож розбір адреси — частина контракту.
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ROUTE_ACCESS, canOpen } from '../../app/access';
import { confirmLeave, setLeaveGuard } from '../../app/leaveGuard';
import { handlePopState, noteHistoryChange, routeUrl, useRoute, type Route } from '../../app/useRoute';
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
  setLeaveGuard(null);
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

  it('dev-сторінка ляльки /dev/doll (у тестах, як і в dev-збірці, import.meta.env.DEV = true)', () => {
    expect(parse('/dev/doll')).toEqual({ name: 'dev-doll' });
    expect(parse('/dev/bracket')).toEqual({ name: 'dev-bracket' });
    expect(parse('/dev/nope')).toEqual({ name: 'home' });
    expect(routeUrl({ name: 'dev-doll' })).toBe('/dev/doll');
    expect(ROUTE_ACCESS['dev-doll']).toBe('public');
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

// ── Застереження перед відходом (leaveGuard) ──────────────────────
// Сторінка з незбереженими змінами реєструє guard; роутер питає window.confirm
// перед кліком по меню (navigate) і перед «Назад / Вперед» (handlePopState):
// «Скасувати» лишає маршрут і адресу, «ОК» — переходить.

const HREF = 'http://localhost';

/** Сторінка на pathname + стаби history/confirm; повертає navigate роутера й моки. */
function routerAt(pathname: string, answer: boolean) {
  const pushState = vi.fn();
  const confirm = vi.fn(() => answer);
  vi.stubGlobal('location', { pathname, search: '', hash: '', href: HREF + pathname });
  vi.stubGlobal('history', { pushState, replaceState: vi.fn(), state: null });
  vi.stubGlobal('window', { confirm });
  let navigate!: (r: Route) => boolean;
  function Probe() {
    navigate = useRoute()[1];
    return null;
  }
  renderToStaticMarkup(<Probe />);
  // у застосунку це робить ефект useRoute при монтуванні (ефекти в SSR не виконуються)
  noteHistoryChange();
  return { navigate, pushState, confirm };
}

describe('застереження про незбережені зміни при переході', () => {
  it('без guard перехід мовчазний: pushState на нову адресу, confirm не питають', () => {
    const { navigate, pushState, confirm } = routerAt('/characters/k7', false);
    expect(navigate({ name: 'rules' })).toBe(true);
    expect(pushState).toHaveBeenCalledWith(null, '', '/rules');
    expect(confirm).not.toHaveBeenCalled();
    expect(confirmLeave()).toBe(true);
  });

  it('guard з текстом: «Скасувати» — лишаємось (без pushState), «ОК» — переходимо', () => {
    const stay = routerAt('/characters/k7', false);
    setLeaveGuard(() => 'Є незбережені зміни. Піти зі сторінки без збереження?');
    expect(stay.navigate({ name: 'characters' })).toBe(false);
    expect(stay.confirm).toHaveBeenCalledWith('Є незбережені зміни. Піти зі сторінки без збереження?');
    expect(stay.pushState).not.toHaveBeenCalled();

    const go = routerAt('/characters/k7', true);
    setLeaveGuard(() => 'Є незбережені зміни. Піти зі сторінки без збереження?');
    expect(go.navigate({ name: 'characters' })).toBe(true);
    expect(go.confirm).toHaveBeenCalledTimes(1);
    expect(go.pushState).toHaveBeenCalledWith(null, '', '/characters');
  });

  it('guard мовчить (null) — перехід без питання; та сама адреса — не перехід, guard не питають', () => {
    const { navigate, pushState, confirm } = routerAt('/characters/k7', false);
    setLeaveGuard(() => null);
    expect(navigate({ name: 'rules' })).toBe(true);
    expect(pushState).toHaveBeenCalledTimes(1);
    setLeaveGuard(() => 'не відпускаю');
    expect(navigate({ name: 'character', id: 'k7' })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it('«Назад» браузера: «Скасувати» повертає адресу сторінки pushState-ом і не міняє маршрут; «ОК» — застосовує адресу', () => {
    // сторінка персонажа на вкладці сету ?set=… — саме цю адресу треба повернути
    const pushState = vi.fn();
    const confirm = vi.fn(() => false);
    vi.stubGlobal('history', { pushState, replaceState: vi.fn(), state: null });
    vi.stubGlobal('window', { confirm });
    vi.stubGlobal('location', { pathname: '/characters/k7', search: '?set=abc123', hash: '', href: HREF + '/characters/k7?set=abc123' });
    noteHistoryChange(); // сторінка змінила ?set= replaceState-ом і сказала про це роутеру
    setLeaveGuard(() => 'Є незбережені зміни. Піти зі сторінки без збереження?');
    // браузер уже перейшов на /rules і кинув popstate
    vi.stubGlobal('location', { pathname: '/rules', search: '', hash: '', href: HREF + '/rules' });
    const apply = vi.fn();
    handlePopState(apply);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
    expect(pushState).toHaveBeenCalledWith(null, '', HREF + '/characters/k7?set=abc123');

    confirm.mockReturnValue(true);
    handlePopState(apply);
    expect(apply).toHaveBeenCalledWith({ name: 'rules' });
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it('«Назад» без guard — маршрут з адреси, confirm не питають', () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('history', { pushState: vi.fn(), replaceState: vi.fn(), state: null });
    vi.stubGlobal('window', { confirm });
    vi.stubGlobal('location', { pathname: '/characters', search: '', hash: '', href: HREF + '/characters' });
    const apply = vi.fn();
    handlePopState(apply);
    expect(apply).toHaveBeenCalledWith({ name: 'characters' });
    expect(confirm).not.toHaveBeenCalled();
  });
});
