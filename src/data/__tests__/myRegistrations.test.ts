// =========================================================
// Шлях гравця: памʼять браузера про свої заявки (registeredTournaments.ts) і
// правила статусу (myRegistrations.ts) — «на розгляді / підтверджено /
// відхилено / вибув», резерв, своя заявка серед заявок турніру, повторна подача
// після відхилення, команда після жеребки; завантаження «Моїх заявок» —
// із заглушкою шару даних; що показати на сторінці заявки (registerGate):
// збіг лише за персонажем не ховає форму, збій пошуку не вішає сторінку.
// =========================================================

import { beforeEach, describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => ({
  own: [] as unknown[],
  byNick: new Map<string, unknown[]>(),
  tournaments: [] as unknown[],
  teams: new Map<string, unknown>(),
  calls: [] as Array<[string, unknown]>,
}));
vi.mock('../tournaments', () => ({
  fetchOwnRegistrations: async (q: unknown) => { data.calls.push(['own', q]); return data.own; },
  fetchRegistrationsByNickname: async (tids: string[], nick: string) => { data.calls.push(['nick', { tids, nick }]); return data.byNick.get(nick) ?? []; },
  fetchTournamentsByIds: async (ids: string[]) => { data.calls.push(['tournaments', ids]); return data.tournaments; },
  fetchTeamsLite: async (ids: string[]) => { data.calls.push(['teams', ids]); return data.teams; },
}));

import { REFS_KEEP, hasRegistered, markRegistered, readRegistrationRefs, refsForTournament } from '../../app/registeredTournaments';
import {
  canReapply, loadMyRegistrations, ownBanner, ownInTournament, pickOwn, playerStatus, reapplyBasis, registerGate, teamFromRegistrations, type MyRegistrationItem,
} from '../myRegistrations';
import type { BalanceStats, Registration, Tournament } from '../types';

/** Сховище в памʼяті (localStorage-подібне). */
function mem(init?: unknown) {
  const m = new Map<string, string>();
  if (init !== undefined) m.set('pwpvp-registered', JSON.stringify(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: () => m.get('pwpvp-registered') };
}

const T1 = '00000000-0000-4000-8000-0000000000a1';
const T2 = '00000000-0000-4000-8000-0000000000a2';

function reg(over: Partial<Registration> = {}): Registration {
  return {
    id: 'r1', tournamentId: T1, nickname: 'Tayforn', rulesAck: true, status: 'pending', createdAt: '2026-10-01T10:00:00Z', memberNicknames: null,
    kind: 'player', teamRegistrationId: null, gear: null, attackLevel: null, defenseLevel: null, scoreAdjust: 0, scoreAdjustNote: null,
    characterId: null, characterRev: null, characterSnapshot: null, dollConfirmedAt: null, dollPower: null, itemPoints: null, itemBreakdown: null,
    rejectReason: null,
    ...over,
  };
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FUTURE = iso(new Date(Date.now() + 7 * 864e5));
function tour(over: Partial<Tournament> = {}): Tournament {
  return {
    id: T1, seriesId: null, name: 'Фул-рандом', eventDate: FUTURE, status: 'registration_open', rulesMd: null, prizesMd: null,
    bracketType: 'single_elim', bracketSize: null, teamSize: 3, createdBy: null, visibility: 'public', thirdPlaceMatch: false, bracketNewLook: true,
    teamMode: 'balanced_random', balanceSeed: null, bracketSeed: null, balanceRulesVersion: null, balanceStats: null, ruleFlags: null, ruleFlagsUpdatedAt: null,
    ...over,
  } as Tournament;
}
const stats = (over: Partial<BalanceStats>): BalanceStats => ({ teams: [], reserve: [], substitutions: [], ...over }) as unknown as BalanceStats;

describe('registeredTournaments: свої заявки цього браузера', () => {
  it('старий формат (масив id турнірів) читається як записи без id і ніку; сміття — порожньо', () => {
    expect(readRegistrationRefs(mem([T1, '  ', T2]))).toEqual([
      { tournamentId: T1, registrationId: null, nickname: null },
      { tournamentId: T2, registrationId: null, nickname: null },
    ]);
    expect(readRegistrationRefs(mem({ x: 1 }))).toEqual([]);
    const broken = { getItem: () => '{не json', setItem: () => {} };
    expect(readRegistrationRefs(broken)).toEqual([]);
    expect(readRegistrationRefs(null)).toEqual([]);
    expect(readRegistrationRefs(mem([{ tournamentId: T1, registrationId: 'r1', nickname: 'A' }, { registrationId: 'x' }, null, 5]))).toEqual([
      { tournamentId: T1, registrationId: 'r1', nickname: 'A' },
    ]);
  });

  it('markRegistered: id і нік; той самий id не дублюється; запис без id того ж турніру замінюється', () => {
    const s = mem([T1]);
    expect(hasRegistered(T1, s)).toBe(true);
    markRegistered(T1, 'r1', 'Tayforn', s);
    expect(refsForTournament(T1, s)).toEqual([{ tournamentId: T1, registrationId: 'r1', nickname: 'Tayforn' }]);
    markRegistered(T1, 'r1', 'Tayforn', s);
    markRegistered(T1, 'r2', 'Tayforn', s); // повторна подача після відхилення — обидві
    markRegistered(T2, null, 'Гість', s);
    expect(readRegistrationRefs(s).map((r) => r.registrationId)).toEqual(['r1', 'r2', null]);
    expect(hasRegistered(T2, s)).toBe(true);
    expect(hasRegistered('nope', s)).toBe(false);
  });

  it('тримає лише найновіші записи; сховище, що кидає, — без винятків', () => {
    const s = mem();
    for (let i = 0; i < REFS_KEEP + 5; i++) markRegistered(T1, 'r' + i, null, s);
    const refs = readRegistrationRefs(s);
    expect(refs).toHaveLength(REFS_KEEP);
    expect(refs[0].registrationId).toBe('r5');
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceeded'); } };
    expect(() => markRegistered(T1, 'r1', 'x', full)).not.toThrow();
  });
});

describe('playerStatus', () => {
  it('на розгляді / підтверджено / відхилено', () => {
    expect(playerStatus(reg(), tour())).toEqual({ key: 'pending', label: 'на розгляді', tone: 'warn', reserve: false });
    expect(playerStatus(reg({ status: 'confirmed' }), tour())).toEqual({ key: 'confirmed', label: 'підтверджено', tone: 'good', reserve: false });
    expect(playerStatus(reg({ status: 'rejected' }), tour())).toEqual({ key: 'rejected', label: 'відхилено', tone: 'bad', reserve: false });
    expect(playerStatus(reg(), null).key).toBe('pending');
  });

  it('вибулий після заміни (rejected + у substitutions) — «вибув»; підтверджений поза сформованими командами — резерв', () => {
    const t = tour({ balanceStats: stats({ teams: [{ name: 'Команда 1', total: 1, members: [] }], substitutions: [{ teamId: 'tm', out: 'r1', in: 'r9', reason: 'no_show', at: '' }] }) });
    expect(playerStatus(reg({ status: 'rejected' }), t)).toMatchObject({ key: 'out', label: 'вибув', tone: 'bad' });
    expect(playerStatus(reg({ id: 'r2', status: 'rejected' }), t).key).toBe('rejected');
    expect(playerStatus(reg({ id: 'r3', status: 'confirmed' }), t)).toMatchObject({ key: 'confirmed', reserve: true });
    expect(playerStatus(reg({ id: 'r3', status: 'confirmed', teamRegistrationId: 'tm' }), t).reserve).toBe(false);
    // команд ще немає — не резерв
    expect(playerStatus(reg({ status: 'confirmed' }), tour()).reserve).toBe(false);
  });
});

describe('своя заявка серед заявок турніру', () => {
  const regs = [
    reg({ id: 'a', nickname: 'Old', status: 'rejected', createdAt: '2026-10-01T09:00:00Z' }),
    reg({ id: 'b', nickname: 'New', status: 'pending', createdAt: '2026-10-01T11:00:00Z' }),
    reg({ id: 'c', nickname: 'Чужий', characterId: 'char-1' }),
    reg({ id: 'tm', kind: 'team', nickname: 'Команда 1' }),
  ];

  it('pickOwn: за id і за персонажем; живі спершу; team-рядки — ні', () => {
    expect(pickOwn(regs, { ids: ['a', 'b'] }).map((r) => r.id)).toEqual(['b', 'a']);
    expect(pickOwn(regs, { ids: [], characterIds: ['char-1'] }).map((r) => r.id)).toEqual(['c']);
    expect(pickOwn(regs, { ids: ['tm'] })).toEqual([]);
  });

  it('ownInTournament: записи цього турніру; без id — за ніком запису, без ніку — за останнім', () => {
    const refs = [{ tournamentId: T1, registrationId: 'a', nickname: 'Old' }, { tournamentId: T2, registrationId: 'b', nickname: 'New' }];
    expect(ownInTournament(regs, T1, { refs }).map((r) => r.id)).toEqual(['a']);
    expect(ownInTournament(regs, T1, { refs: [{ tournamentId: T1, registrationId: null, nickname: 'new' }] }).map((r) => r.id)).toEqual(['b']);
    expect(ownInTournament(regs, T1, { refs: [{ tournamentId: T1, registrationId: null, nickname: null }], lastNickname: ' OLD ' }).map((r) => r.id)).toEqual(['a']);
    expect(ownInTournament(regs, T1, { refs: [], lastNickname: 'Old' })).toEqual([]);
  });

  it('ownBanner: знайдена лише за персонажем — позначена й не входить у basis; жива з цього браузера — першою', () => {
    const chars = ['char-1'];
    // Своя відхилена з цього браузера + жива лише за персонажем: банер — жива з поясненням, basis — лише своя.
    expect(ownBanner(regs, T1, { refs: [{ tournamentId: T1, registrationId: 'a', nickname: 'Old' }], characterIds: chars })).toEqual({
      reg: regs[2], byCharacterOnly: true, basis: [regs[0]],
    });
    // Жива з цього браузера переважає новішу живу, знайдену лише за персонажем.
    const newerForeign = reg({ id: 'c2', nickname: 'Чужий2', characterId: 'char-1', createdAt: '2026-10-01T12:00:00Z' });
    const withNewer = [...regs, newerForeign];
    expect(ownBanner(withNewer, T1, { refs: [{ tournamentId: T1, registrationId: 'b', nickname: 'New' }], characterIds: chars })).toEqual({
      reg: regs[1], byCharacterOnly: false, basis: [regs[1]],
    });
    // Лише за персонажем (гравець увійшов, а з цього браузера не подавав).
    expect(ownBanner(regs, T1, { refs: [], characterIds: chars })).toEqual({ reg: regs[2], byCharacterOnly: true, basis: [] });
    // Запис старого формату за ніком — своя.
    expect(ownBanner(regs, T1, { refs: [{ tournamentId: T1, registrationId: null, nickname: 'new' }] })).toEqual({
      reg: regs[1], byCharacterOnly: false, basis: [regs[1]],
    });
    expect(ownBanner(regs, T1, { refs: [], characterIds: [] })).toBeNull();
  });

  it('canReapply: усі свої відхилені й реєстрація відкрита; «вибув», жива заявка чи закрита реєстрація — ні', () => {
    const rej = reg({ status: 'rejected' });
    expect(canReapply([rej], tour())).toBe(true);
    expect(canReapply([rej, reg({ id: 'r2' })], tour())).toBe(false);
    expect(canReapply([], tour())).toBe(false);
    expect(canReapply([rej], tour({ status: 'registration_closed' }))).toBe(false);
    expect(canReapply([rej], tour({ eventDate: '2020-01-01' }))).toBe(false);
    expect(canReapply([rej], tour({ balanceStats: stats({ substitutions: [{ teamId: 't', out: 'r1', in: null, reason: '', at: '' }] }) }))).toBe(false);
  });

  it('teamFromRegistrations: назва team-рядка й склад із класами', () => {
    const all = [
      reg({ id: 'tm', kind: 'team', nickname: 'Команда 1', status: 'confirmed' }),
      reg({ id: 'p1', status: 'confirmed', teamRegistrationId: 'tm', gear: { charClass: 'archer' } as Registration['gear'] }),
      reg({ id: 'p2', nickname: 'Ксенус', status: 'confirmed', teamRegistrationId: 'tm' }),
    ];
    expect(teamFromRegistrations(all, 'tm')).toEqual({
      id: 'tm', name: 'Команда 1',
      members: [
        { id: 'p1', nickname: 'Tayforn', charClass: 'archer', status: 'confirmed' },
        { id: 'p2', nickname: 'Ксенус', charClass: null, status: 'confirmed' },
      ],
    });
    expect(teamFromRegistrations(all, null)).toBeNull();
    expect(teamFromRegistrations(all, 'nope')).toBeNull();
  });
});

describe('loadMyRegistrations («Мої заявки»)', () => {
  beforeEach(() => {
    data.own = [];
    data.byNick = new Map();
    data.tournaments = [];
    data.teams = new Map();
    data.calls = [];
  });

  it('за id і персонажами, записи без id — за ніком; турніри й команди дочитуються; новіші турніри вище', async () => {
    const team = { id: 'tm', name: 'Команда 1', members: [] };
    data.own = [reg({ id: 'r1', tournamentId: T1 }), reg({ id: 'r2', tournamentId: T2, status: 'confirmed', teamRegistrationId: 'tm' })];
    data.byNick = new Map([['Гість', [reg({ id: 'r3', tournamentId: T2, nickname: 'Гість', status: 'rejected' })]]]);
    data.tournaments = [tour({ id: T1, eventDate: '2026-10-05' }), tour({ id: T2, eventDate: '2026-10-12' })];
    data.teams = new Map([['tm', team]]);
    const items = await loadMyRegistrations({
      refs: [{ tournamentId: T1, registrationId: 'r1', nickname: 'Tayforn' }, { tournamentId: T2, registrationId: null, nickname: 'Гість' }],
      characterIds: ['char-1'],
      lastNickname: 'Інший',
    });
    expect(data.calls[0]).toEqual(['own', { ids: ['r1'], characterIds: ['char-1'], tournamentId: undefined }]);
    expect(data.calls).toContainEqual(['nick', { tids: [T2], nick: 'Гість' }]);
    expect(items.map((i) => i.reg.id)).toEqual(['r2', 'r3', 'r1']);
    expect(items[0].team).toBe(team);
    expect(items[2].tournament?.id).toBe(T1);
    expect(items[1].team).toBeNull();
    // r2 знайшовся лише за персонажем (id цього браузера — r1, нік — r3)
    expect(items.map((i) => [i.reg.id, i.byCharacterOnly])).toEqual([['r2', true], ['r3', false], ['r1', false]]);
  });

  it('лише один турнір; нічого не знайдено — без зайвих запитів', async () => {
    const items = await loadMyRegistrations({ refs: [{ tournamentId: T1, registrationId: 'r1', nickname: null }, { tournamentId: T2, registrationId: 'r2', nickname: null }], tournamentId: T1 });
    expect(items).toEqual([]);
    expect(data.calls).toEqual([['own', { ids: ['r1'], characterIds: [], tournamentId: T1 }]]);
  });
});

describe('сторінка заявки: що показати замість форми (registerGate)', () => {
  const item = (over: Partial<Registration> = {}, byCharacterOnly = false): MyRegistrationItem => ({ reg: reg(over), tournament: tour(), team: null, byCharacterOnly });
  const ref = (registrationId: string | null, nickname: string | null = 'Tayforn') => ({ tournamentId: T1, registrationId, nickname });
  const ready = (items: MyRegistrationItem[]) => ({ status: 'ready' as const, items, current: true });

  it('поки шукаємо (чи результат для іншого турніру/персонажів) — «перевіряю»', () => {
    expect(registerGate({ own: { status: 'loading', items: [], current: true }, refs: [], again: false })).toEqual({ view: 'checking' });
    expect(registerGate({ own: { status: 'ready', items: [], current: false }, refs: [], again: false })).toEqual({ view: 'checking' });
  });

  it('пошук своїх заявок упав: без записів браузера — форма (дубль зупинить унікальний нік чи бекенд); із записами — помилка з повтором, а не вічне «перевіряю»', () => {
    // учасник клану з персонажами, з цього браузера ще не подавав
    expect(registerGate({ own: { status: 'error', items: [], current: true }, refs: [], again: false })).toEqual({ view: 'form', rejected: [], foreign: [], basis: [] });
    expect(registerGate({ own: { status: 'error', items: [], current: true }, refs: [ref('r1')], again: false })).toEqual({ view: 'error' });
    // збій для іншого ключа (турнір змінили) — ще перевіряємо
    expect(registerGate({ own: { status: 'error', items: [], current: false }, refs: [], again: false })).toEqual({ view: 'checking' });
  });

  it('жива своя заявка (id цього браузера) — статус замість форми', () => {
    const mine = item({ id: 'r1' });
    const g = registerGate({ own: ready([mine]), refs: [ref('r1')], again: false });
    expect(g).toEqual({ view: 'status', cards: [mine], basis: [mine.reg] });
    // «Подати знову» на живій — нічого не міняє
    expect(registerGate({ own: ready([mine]), refs: [ref('r1')], again: true }).view).toBe('status');
  });

  it('збіг лише за character_id (до 0034 його міг підставити будь-хто) — форма не ховається, картка над нею', () => {
    const foreign = item({ id: 'x1', nickname: 'Чужий', characterId: 'char-1' }, true);
    expect(registerGate({ own: ready([foreign]), refs: [], again: false })).toEqual({ view: 'form', rejected: [], foreign: [foreign], basis: [] });
    // своя відхилена + чужа жива за персонажем — «Подати знову» лишається (чужа не доказ, що подавати не можна)
    const rejected = item({ id: 'r1', status: 'rejected', rejectReason: 'інший трактат' });
    const g = registerGate({ own: ready([foreign, rejected]), refs: [ref('r1')], again: false });
    expect(g).toEqual({ view: 'status', cards: [rejected], basis: [rejected.reg] });
    expect(registerGate({ own: ready([foreign, rejected]), refs: [ref('r1')], again: true })).toEqual({ view: 'form', rejected: [rejected], foreign: [foreign], basis: [rejected.reg] });
    // своя жива з цього браузера — статус, як і раніше (чужу не показуємо)
    const live = item({ id: 'r2' });
    expect(registerGate({ own: ready([foreign, live]), refs: [ref('r2')], again: false })).toEqual({ view: 'status', cards: [live], basis: [live.reg] });
  });

  it('відхилені свої — статус із «Подати знову»; натиснув — форма, а відхилена над нею', () => {
    const rejected = item({ id: 'r1', status: 'rejected' });
    expect(registerGate({ own: ready([rejected]), refs: [ref('r1')], again: false }).view).toBe('status');
    expect(registerGate({ own: ready([rejected]), refs: [ref('r1')], again: true })).toEqual({ view: 'form', rejected: [rejected], foreign: [], basis: [rejected.reg] });
  });

  it('запис браузера старого формату (без id і ніку), заявку не знайдено — блокуємо, як раніше; запис з id чи ніком без заявки (видалив адмін) — форма', () => {
    expect(registerGate({ own: ready([]), refs: [ref(null, null)], again: false })).toEqual({ view: 'unknown' });
    expect(registerGate({ own: ready([item({ id: 'x1' }, true)]), refs: [ref(null, null)], again: false })).toEqual({ view: 'unknown' });
    expect(registerGate({ own: ready([]), refs: [ref('r-deleted')], again: false }).view).toBe('form');
    expect(registerGate({ own: ready([]), refs: [ref(null, 'Tayforn')], again: false }).view).toBe('form');
  });

  it('reapplyBasis («Мої заявки»): свої заявки за турнірами без знайдених лише за персонажем', () => {
    const a = item({ id: 'a', status: 'rejected' });
    const b = { ...item({ id: 'b', characterId: 'char-1' }, true) };
    const c = { ...item({ id: 'c' }), reg: reg({ id: 'c', tournamentId: T2 }) };
    const m = reapplyBasis([a, b, c]);
    expect(m.get(T1)?.map((r) => r.id)).toEqual(['a']);
    expect(m.get(T2)?.map((r) => r.id)).toEqual(['c']);
    expect(canReapply(m.get(T1)!, tour())).toBe(true);
  });
});
