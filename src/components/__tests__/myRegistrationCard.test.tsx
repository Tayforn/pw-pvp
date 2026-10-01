// =========================================================
// Статус своєї заявки (MyRegistrationCard) — «Мої заявки», сторінка заявки,
// банер на сторінці турніру: статус пігулкою, причина відхилення, команда після
// жеребки (свій рядок виділено), «Подати знову» лише для відхиленої при
// відкритій реєстрації. Рендер у рядок (jsdom у проєкті нема); Supabase — заглушка.
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../app/supabaseClient', () => ({ supabase: {} }));

const { default: MyRegistrationCard, reapplyUrl } = await import('../MyRegistrationCard');
const { RejectModal, unverifiedTitle } = await import('../../pages/admin/RegistrationsPanel');
const { BUILTIN_RULES_VERSION } = await import('../../data/gearRules');
import type { BalanceStats, ItemBreakdown, Registration, Tournament } from '../../data/types';

const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const FUTURE = iso(new Date(Date.now() + 7 * 864e5));
const T = {
  id: 't-1', name: 'Фул-рандом 3×3', eventDate: FUTURE, status: 'registration_open', teamSize: 3, teamMode: 'balanced_random', balanceStats: null,
} as unknown as Tournament;
function reg(over: Partial<Registration> = {}): Registration {
  return {
    id: 'r1', tournamentId: 't-1', nickname: 'Tayforn', rulesAck: true, status: 'pending', createdAt: '2026-10-01T10:00:00Z', memberNicknames: null,
    kind: 'player', teamRegistrationId: null, gear: null, attackLevel: null, defenseLevel: null, scoreAdjust: 0, scoreAdjustNote: null,
    characterId: null, characterRev: null, characterSnapshot: null, dollConfirmedAt: null, dollPower: null, itemPoints: null, itemBreakdown: null,
    rejectReason: null,
    ...over,
  };
}

describe('MyRegistrationCard', () => {
  it('на розгляді: нік, жовта пігулка, пояснення; без «Подати знову»', () => {
    const html = renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg(), tournament: T, team: null }} />);
    expect(html).toContain('<span class="badge warn">на розгляді</span>');
    expect(visible(html)).toContain('Tayforn');
    expect(visible(html)).toContain('Адмін перевіряє заявку');
    expect(html).not.toContain('Подати знову');
  });

  it('банер: «Твоя заявка: …», роль status; «Мої заявки» — назва турніру з посиланням', () => {
    const banner = renderToStaticMarkup(<MyRegistrationCard banner item={{ reg: reg({ status: 'confirmed' }), tournament: T, team: null }} />);
    expect(banner).toContain('role="status"');
    expect(visible(banner)).toMatch(/^Твоя заявка: Tayforn підтверджено/);
    expect(visible(banner)).toContain('Команду сформує система після закриття реєстрації');
    const listed = renderToStaticMarkup(<MyRegistrationCard showTournament item={{ reg: reg(), tournament: T, team: null }} />);
    expect(listed).toContain('href="/t/t-1"');
    expect(visible(listed)).toContain('Фул-рандом 3×3');
    expect(visible(renderToStaticMarkup(<MyRegistrationCard showTournament item={{ reg: reg(), tournament: null, team: null }} />))).toContain('Турнір видалено');
  });

  it('відхилено з причиною при відкритій реєстрації — «Подати знову» (посилання з again=1 чи кнопка на сторінці заявки)', () => {
    const item = { reg: reg({ status: 'rejected', rejectReason: 'лялька не збігається з грою: інший трактат' }), tournament: T, team: null };
    const html = renderToStaticMarkup(<MyRegistrationCard item={item} />);
    expect(html).toContain('<span class="badge bad">відхилено</span>');
    expect(visible(html)).toContain('Причина: лялька не збігається з грою: інший трактат');
    expect(html).toContain(`href="${reapplyUrl('t-1').replace(/&/g, '&amp;')}"`);
    expect(reapplyUrl('t-1')).toBe('/register?t=t-1&again=1');
    const onPage = renderToStaticMarkup(<MyRegistrationCard item={item} onReapply={() => {}} />);
    expect(onPage).toMatch(/<button[^>]*class="btn btn-primary btn-sm"[^>]*>Подати знову<\/button>/);
    // над відкритою формою — без кнопки; закрита реєстрація — без кнопки
    expect(renderToStaticMarkup(<MyRegistrationCard item={item} noActions />)).not.toContain('Подати знову');
    expect(renderToStaticMarkup(<MyRegistrationCard item={{ ...item, tournament: { ...T, status: 'registration_closed' } }} />)).not.toContain('Подати знову');
    // інша жива своя заявка на турнір — теж ні
    expect(renderToStaticMarkup(<MyRegistrationCard item={item} ownOnTournament={[item.reg, reg({ id: 'r2' })]} />)).not.toContain('Подати знову');
    // жива заявка не отримує «Подати знову», навіть коли свої (без знайдених лише за персонажем) — відхилені
    const live = { reg: reg({ id: 'x1', nickname: 'Чужий' }), tournament: T, team: null, byCharacterOnly: true };
    expect(renderToStaticMarkup(<MyRegistrationCard item={live} ownOnTournament={[item.reg]} />)).not.toContain('Подати знову');
  });

  it('знайдена лише за персонажем (не з цього браузера) — пояснення, що подати свою можна', () => {
    const html = renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg({ characterId: 'char-1' }), tournament: T, team: null, byCharacterOnly: true }} />);
    expect(visible(html)).toContain('Знайдено за твоїм збереженим персонажем — заявку подано не з цього браузера. Не подавав(ла) її — подай свою й напиши адміну.');
    expect(visible(renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg(), tournament: T, team: null }} />))).not.toContain('Знайдено за твоїм');
  });

  it('після жеребки — команда зі складом і класами, свій рядок виділено; вибулий — «вибув» без старої причини відхилення', () => {
    const team = {
      id: 'tm', name: 'Команда 3',
      members: [
        { id: 'r1', nickname: 'Tayforn', charClass: 'archer' as const, status: 'confirmed' as const },
        { id: 'r2', nickname: 'Ксенус', charClass: null, status: 'confirmed' as const },
      ],
    };
    const html = renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg({ status: 'confirmed', teamRegistrationId: 'tm' }), tournament: T, team }} />);
    expect(visible(html)).toContain('Команда «Команда 3»');
    expect(html).toMatch(/<li class="me">.*Tayforn.*Лучник.*це ти/);
    expect(visible(html)).toContain('Ксенус');
    const out = { ...T, status: 'in_progress', balanceStats: { teams: [{ name: 'Команда 3', total: 0, members: [] }], reserve: [], substitutions: [{ teamId: 'tm', out: 'r1', in: 'r5', reason: 'no_show', at: '' }] } as unknown as BalanceStats } as Tournament;
    const gone = renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg({ status: 'rejected', rejectReason: 'не зʼявився на старт' }), tournament: out, team: null }} />);
    expect(gone).toContain('<span class="badge bad">вибув</span>');
    expect(visible(gone)).toContain('Тебе замінили в команді');
    expect(visible(gone)).not.toContain('Причина');
    // підтверджений поза командами після жеребки — резерв
    const reserve = renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg({ id: 'r7', status: 'confirmed' }), tournament: out, team: null }} />);
    expect(reserve).toContain('<span class="badge mute">резерв</span>');
    expect(visible(reserve)).toContain('ти в резерві');
    // минулий турнір — підсумок, а не «що буде далі»
    const done = { ...out, status: 'completed' } as Tournament;
    expect(visible(renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg({ id: 'r7', status: 'confirmed' }), tournament: done, team: null }} />)))
      .toContain('Був у резерві — до команди не потрапив.');
    expect(visible(renderToStaticMarkup(<MyRegistrationCard item={{ reg: reg({ id: 'r8' }), tournament: done, team: null }} />)))
      .toContain('Турнір уже пройшов, а заявку так і не розглянули.');
  });
});

describe('RejectModal (адмінка, причина відхилення)', () => {
  it('поле причини до 200 символів (необовʼязкове), підказка про гравця, «Скасувати» й «Відхилити»; закриття — лише кнопки й ✕', () => {
    const html = renderToStaticMarkup(<RejectModal reg={reg({ nickname: 'Dark_Lord' })} onClose={() => {}} onDone={() => {}} />);
    expect(visible(html)).toContain('Відхилити заявку «Dark_Lord»');
    expect(html).toMatch(/<input[^>]*type="text"[^>]*maxLength="200"/);
    expect(html).not.toMatch(/<input[^>]*required/);
    expect(visible(html)).toContain('Причина (необовʼязково) — її побачить гравець');
    expect(visible(html)).toContain('може подати заявку знову');
    expect(html).toContain('aria-label="Закрити"');
    expect(html).toMatch(/<button[^>]*class="btn btn-bad"[^>]*>Відхилити<\/button>/);
    // оверлей без onClick — клік повз вікно нічого не закриває
    expect(html).toMatch(/^<div class="modal-overlay">/);
  });
});

describe('бейдж «не перевірено» в адмінці (unverifiedTitle)', () => {
  const BD: ItemBreakdown = { v: 1, ver: 'balance-v0.9-стара', sum: { main: 1, sets: 0, setsRaw: 0, pair: 0 }, rows: [], checked: true };
  it('клієнт гравця — про перерахунок; інша версія шкали — обидві версії', () => {
    expect(unverifiedTitle({ itemPoints: 10, itemBreakdown: null }, { balanceRulesVersion: null })).toMatch(/^Бали за речі порахував клієнт гравця/);
    const t = unverifiedTitle({ itemPoints: 10, itemBreakdown: BD }, { balanceRulesVersion: null });
    expect(t).toContain('за шкалою balance-v0.9-стара, а турнір рахується за ' + BUILTIN_RULES_VERSION);
    expect(t).toContain('перерахуй зі знімка');
  });
});
