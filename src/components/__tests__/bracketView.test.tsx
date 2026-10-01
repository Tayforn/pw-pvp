// =========================================================
// BracketView у статичному рендері (jsdom у проєкті нема — renderToStaticMarkup):
// уся сітка (верхня й нижня) — одне полотно з однією прокруткою; склад у
// картці скорочено до «+N», а повний — у підписі рядка (aria-label) і на
// пʼєдесталі; «Підсумок турніру» з медалями; блок переможця; лінії шляху
// чемпіона; публічно рядки — кнопки (клік/Enter — панель матчу), у редакторі —
// вибір переможця й формат, без панелі. Смужка «Шлях»: прокручуються лише
// етапи, підсумок і «✕ Скинути» — поза прокруткою. Список: повний склад,
// розгортання лише за закріпленим шляхом. Шапка редактора не обрізає
// керування. Пояснення нижньої сітки — видимим підзаголовком.
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BracketMatch } from '../../data/types';
import BracketView, { matchOpener, roundAutoOpen } from '../BracketView';
import { PathBar } from '../bracket/Strips';
import { LB_HINT, LB_NOTE } from '../bracket/layout';
import { bracketInfo, nameFor, podiumIds, rosterFor, type BracketData } from '../bracket/model';
import { applyWinner, doubleElim, fakeTeams } from '../../pages/DevBracketPage';

const T = (n: number) => `team-${n}`;
const REGS = fakeTeams(8, 3, 't').map((r, i) => (i === 0 ? { ...r, memberNicknames: ['EddieMunson', '~FreeKill~', 'NeO[N]'] } : r));
const PLAYS: [string, number, string][] = [
  ['w1-0', 1, '2-0'], ['w1-1', 3, '2-0'], ['w1-2', 2, '1-2'], ['w1-3', 6, '1-2'],
  ['w2-0', 1, '2-1'], ['w2-1', 6, '0-2'], ['w3-0', 6, '1-2'],
  ['l1-0', 5, '1-2'], ['l1-1', 7, '2-1'], ['l2-0', 3, '0-2'], ['l2-1', 7, '2-0'], ['l3-0', 3, '2-0'], ['l4-0', 3, '2-1'],
  ['gf', 3, '2-3'],
];

function played(upTo = PLAYS.length): BracketMatch[] {
  let ms = doubleElim([T(1), T(8), T(3), T(5), T(7), T(2), T(4), T(6)]).map((m) => ({ ...m, format: 'bo3' }));
  for (const [id, w, score] of PLAYS.slice(0, upTo)) ms = applyWinner(ms, id, T(w), score);
  return ms;
}

const count = (html: string, needle: string) => html.split(needle).length - 1;
const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();
/** Шапка картки матчу (від data-match-id до першого рядка-слота). */
function cardHead(html: string, id: string): string {
  const i = html.indexOf(`data-match-id="${id}"`);
  expect(i, id).toBeGreaterThan(-1);
  return html.slice(i, html.indexOf('class="trn-slot', i));
}
/** Елемент <span …> разом із вмістом — від `openTag` до парного </span>. */
function spanAt(html: string, openTag: string): string {
  const start = html.indexOf(openTag);
  expect(start, openTag).toBeGreaterThan(-1);
  const re = /<(\/?)span\b[^>]*>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  return html.slice(start);
}
function bracketData(ms: BracketMatch[]): BracketData {
  const info = bracketInfo(ms);
  return { matches: ms, registrations: REGS, info, podium: podiumIds(ms, info), rosterOf: (id) => rosterFor(id, REGS), nameOf: (id) => nameFor(id, REGS) };
}
const EDIT = { onSetWinner: () => {}, onSetFormat: () => {} };

describe('BracketView — публічна сітка завершеного турніру', () => {
  const html = renderToStaticMarkup(<BracketView matches={played()} registrations={REGS} title="Тест" />);

  it('верхня й нижня сітки — в одному полотні з однією прокруткою', () => {
    expect(count(html, 'class="bracket-scroll trn-scroll"')).toBe(1);
    expect(count(html, 'class="trn-canvas"')).toBe(1);
    expect(html).toContain('Верхня · Раунд 1');
    expect(html).toContain('Нижня · Раунд 1');
    expect(html).toContain('Гранд-фінал');
    expect(count(html, 'class="trn-divider"')).toBe(1);
  });

  it('склад у картці — скорочено «+N», повний — у підписі рядка; нічого не губиться', () => {
    expect(html).toMatch(/class="trn-slot-members-txt">EddieMunson<\/span><span class="trn-slot-more">\+2<\/span>/);
    expect(html).toContain('aria-label="Команда 1 (EddieMunson, ~FreeKill~, NeO[N]), матч В1.1, перемога, рахунок 2:0. Подробиці матчу"');
  });

  it('підсумок турніру з медалями й повними складами; блок переможця під гранд-фіналом', () => {
    const text = visible(html);
    expect(text).toContain('Підсумок турніру');
    expect(text).toContain('зіграно 14 з 14');
    expect(html).toContain('class="trn-podium-cell p1"');
    expect(html).toContain('aria-label="1 місце: Команда 3');
    expect(html).toContain('aria-label="3 місце: Команда 1 (EddieMunson, ~FreeKill~, NeO[N]). Показати шлях у сітці"');
    expect(html).toMatch(/<button type="button" class="trn-champ"[^>]*aria-label="Переможець: Команда 3\. Показати шлях у сітці"/);
  });

  it('лінії шляху чемпіона яскравіші: переходи перемогою + лінія до блоку переможця', () => {
    // Команда 3: В1.2→В2.1 (перемога), далі пониження й Н2.1→Н3.1→Н4.1→ГФ (перемоги), ГФ → блок переможця
    expect(count(html, 'class="trn-edge champ"')).toBe(5);
  });

  it('публічно рядки — кнопки з клавіатури; підказка про наведення; без керування редактора', () => {
    expect(html).toContain('role="button" tabindex="0"');
    expect(html).toContain('Наведи на команду — її шлях і склад.');
    expect(html).not.toContain('class="trn-ctl"');
  });

  it('картка фокусується програмно (tabIndex=-1) — є куди повернути фокус після панелі', () => {
    expect(html).toMatch(/class="trn-match[^"]*clickable" data-match-id="w1-0" tabindex="-1"/);
    // без наведення підказки зі складом немає — і посилань на неї з рядків теж
    expect(html).not.toMatch(/class="trn-slot[^"]*"[^>]*aria-describedby=/);
  });

  it('легенда: «шлях чемпіона», коли чемпіон уже є (підпис «шлях команди» — прихований, у тій самій клітинці)', () => {
    expect(html).toContain('<span class="trn-legend-path"><span class="sw-path"></span><span class="trn-legend-alt"><span class="is-hidden">шлях команди</span><span>шлях чемпіона</span></span></span>');
  });

  it('нижня сітка: видимий підзаголовок «другий програш — виліт», повне пояснення — у title й описі полотна', () => {
    expect(html).toContain(`<span aria-hidden="true">${LB_NOTE}</span>`);
    expect(html).toMatch(new RegExp(`class="trn-head-note"[^>]*title="${LB_HINT}"`));
    const id = /class="trn-canvas"[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}" class="trn-sr">Нижня сітка. ${LB_HINT}</span>`);
  });
});

describe('BracketView — легенда до появи чемпіона', () => {
  it('турнір ще йде — пункт шляху прихований, але місце під нього зарезервоване (тулбар не стрибає від наведення)', () => {
    const html = renderToStaticMarkup(<BracketView matches={played(6)} registrations={REGS} />);
    expect(html).toContain('class="trn-legend"');
    expect(html).toContain('<span class="trn-legend-path is-off"><span class="sw-path"></span><span class="trn-legend-alt">');
    expect(html).not.toContain('class="trn-legend-path"');
  });
});

describe('Смужка «Шлях» — прокручуються лише етапи', () => {
  const noop = () => {};

  it('шлях команди: пігулки — у власному контейнері, підсумок і «✕ Скинути» — після нього', () => {
    const html = renderToStaticMarkup(
      <PathBar data={bracketData(played())} focusId={T(3)} nick="Volk" query="Volk" hits={[{ id: T(3), nick: 'Volk' }]} canClear interactive onPick={noop} onClear={noop} onStep={noop} />,
    );
    const steps = spanAt(html, '<span class="trn-pathbar-steps">');
    expect(count(steps, 'class="trn-step ')).toBe(6);
    expect(steps).not.toContain('trn-standing');
    expect(steps).not.toContain('trn-pathbar-clear');
    const after = html.slice(html.indexOf(steps) + steps.length);
    expect(after).toMatch(/^<span class="trn-standing gold">Чемпіон<\/span><button[^>]*class="btn btn-ghost btn-sm trn-pathbar-clear"[^>]*>✕ Скинути<\/button><\/div>$/);
    // мітка й назва команди — до прокручуваної частини
    expect(html.indexOf('trn-pathbar-team')).toBeLessThan(html.indexOf('trn-pathbar-steps'));
  });

  it('кілька збігів: чипи — у прокручуваному контейнері, «✕ Скинути» — поза ним', () => {
    const html = renderToStaticMarkup(
      <PathBar data={bracketData(played())} focusId={null} query="Команда" hits={[{ id: T(1) }, { id: T(2) }, { id: T(3) }]} canClear interactive onPick={noop} onClear={noop} onStep={noop} />,
    );
    const chips = spanAt(html, '<span class="trn-pathbar-steps">');
    expect(count(chips, 'class="trn-chip"')).toBe(3);
    expect(chips).not.toContain('trn-pathbar-clear');
    expect(html).toContain('trn-pathbar-clear');
  });
});

describe('BracketView — вигляд «Список»', () => {
  afterEach(() => vi.unstubAllGlobals());
  const asList = () => vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'pw-pvp:bracketView' ? 'list' : null), setItem: () => {} });

  it('склад — повністю одним рядком (CSS-трикрапка), без «+N» за шириною картки сітки', () => {
    asList();
    const html = renderToStaticMarkup(<BracketView matches={played()} registrations={REGS} />);
    expect(html).toContain('class="trn-list"');
    expect(html).toContain('<span class="trn-slot-members-txt">EddieMunson, ~FreeKill~, NeO[N]</span>');
    expect(html).not.toContain('trn-slot-more');
    // пояснення нижньої сітки — видимим текстом під заголовком секції
    expect(visible(html)).toContain(LB_HINT);
  });

  it('розгорнуто лише раунди, що ще граються; зіграні (і шлях чемпіона без закріплення) — згорнуті', () => {
    asList();
    const done = renderToStaticMarkup(<BracketView matches={played()} registrations={REGS} />);
    expect(count(done, 'class="card trn-list-round"')).toBe(8);
    expect(count(done, 'class="card trn-list-round" open=""')).toBe(0);
    const going = renderToStaticMarkup(<BracketView matches={played(4)} registrations={REGS} />);
    // В1 зіграно — згорнуто; решта ще грається або чекає учасників — розгорнуто
    const opens = going.split('<details ').slice(1).map((d) => d.startsWith('class="card trn-list-round" open=""'));
    expect(opens).toEqual([false, true, true, true, true, true, true, true]);
  });
});

describe('roundAutoOpen — розгортання раунду списку', () => {
  const ms = played();
  const r1 = ms.filter((m) => m.bracketSide === 'winners' && m.round === 1);

  it('зіграний раунд розгортається лише матчем закріпленого/знайденого шляху', () => {
    expect(roundAutoOpen(r1, new Set())).toBe(false);
    expect(roundAutoOpen(r1, new Set(['w1-1']))).toBe(true);
    expect(roundAutoOpen(r1, new Set(['w2-0']))).toBe(false);
  });

  it('раунд, що ще грається, — розгорнутий', () => {
    const live = played(2).filter((m) => m.bracketSide === 'winners' && m.round === 1);
    expect(roundAutoOpen(live, new Set())).toBe(true);
  });
});

describe('matchOpener — куди повернути фокус після панелі матчу', () => {
  type Fake = { closest?: (s: string) => unknown };
  const slot1: Fake = {};
  const slot2: Fake = {};
  slot1.closest = () => slot1;
  slot2.closest = () => slot2;
  const outside: Fake = {};
  outside.closest = () => outside;
  const card = (first: Fake | null) => ({ contains: (x: unknown) => x === slot1 || x === slot2, querySelector: () => first }) as unknown as HTMLElement;
  const target = (x: Fake | null) => x as unknown as EventTarget;

  it('клік по рядку — цей рядок', () => {
    expect(matchOpener(card(slot1), target(slot2))).toBe(slot2);
  });

  it('клік по шапці — перший рядок-кнопка картки', () => {
    expect(matchOpener(card(slot1), target({ closest: () => null }))).toBe(slot1);
    // знайдена «кнопка» поза карткою не рахується
    expect(matchOpener(card(slot1), target(outside))).toBe(slot1);
  });

  it('рядків-кнопок немає (порожній матч) — сама картка', () => {
    const c = card(null);
    expect(matchOpener(c, target({ closest: () => null }))).toBe(c);
    expect(matchOpener(c, null)).toBe(c);
  });
});

describe('BracketView — редактор', () => {
  it('live-слоти — вибір переможця, формат селектом; без панелі й підсказок наведення', () => {
    const html = renderToStaticMarkup(
      <BracketView matches={played(4)} registrations={REGS} editable={EDIT} />,
    );
    expect(html).toContain('title="Клік — +1 перемога в серії"');
    expect(html).toContain('aria-label="Формат матчу"');
    expect(html).not.toContain('Наведи на команду');
    expect(html).not.toContain('Подробиці матчу');
    // турнір не завершено — пʼєдесталу немає, блок переможця — заглушка; пункт шляху в легенді — прихований
    expect(html).not.toContain('Підсумок турніру');
    expect(html).toContain('class="trn-champ empty"');
    expect(html).toContain('trn-legend-path is-off');
    // у редакторі картка програмно не фокусується (панелі немає)
    expect(html).not.toContain('tabindex="-1"');
  });

  it('шапка не обрізає керування: при ↺ чи власному форматі «↓ Нх.у» ховається (адреса — у підказці)', () => {
    const ms = played(4).map((m) => (m.id === 'w2-1' ? { ...m, format: 'bo7' } : m.id === 'w2-0' ? { ...m, score: '1-0' } : m));
    const html = renderToStaticMarkup(<BracketView matches={ms} registrations={REGS} editable={EDIT} />);
    // В1.1 вирішено, наступний ще ні — є ↺, «↓ Н1.1» сховано в title адреси
    const w10 = cardHead(html, 'w1-0');
    expect(w10).toContain('title="Скасувати результат матчу"');
    expect(w10).not.toContain('↓ Н1.1');
    expect(w10).toContain('title="Матч В1.1 · програвший переходить у Н1.1"');
    // В2.1: проміжний рахунок 1:0 — ↺ «Скинути рахунок серії», «↓» сховано
    const w20 = cardHead(html, 'w2-0');
    expect(w20).toContain('title="Скинути рахунок серії"');
    expect(w20).not.toContain('trn-drop');
    // В2.2 з форматом bo7 — поле власного формату й ↺ «до BO1/BO3/BO5», «↓» сховано
    const w21 = cardHead(html, 'w2-1');
    expect(w21).toContain('placeholder="напр. bo7"');
    expect(w21).toContain('title="Повернутись до BO1/BO3/BO5"');
    expect(w21).not.toContain('trn-drop');
    // шапки редактора в крайньому разі переносяться (CSS .trn-match.editing), а не обрізаються
    expect(html).toMatch(/class="trn-match trn-decided[^"]* editing" data-match-id="w1-0"/);
  });

  it('без ↺ і з селектом формату — «↓ Нх.у» на місці', () => {
    const html = renderToStaticMarkup(<BracketView matches={played(1)} registrations={REGS} editable={EDIT} />);
    const w11 = cardHead(html, 'w1-1');
    expect(w11).toContain('↓ Н1.1');
    expect(w11).toContain('title="Матч В1.2"');
    expect(w11).toContain('aria-label="Формат матчу"');
  });
});
