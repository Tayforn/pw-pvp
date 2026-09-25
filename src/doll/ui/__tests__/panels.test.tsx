// =========================================================
// ЛЯЛЬКА — панелі (характеристики, стани, перевірка урону, дельти сету):
// рендер у рядок через renderToStaticMarkup на golden-фікстурах ядра, у
// справжньому EditorProvider. Перевіряємо те, що бачить гравець: ПА/ПЗ у
// hero-рядку, знак і колір дельти сету, підписи «у скор не входить».
// =========================================================

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { shownBuffs } from '../../core/buffs';
import { DEFAULT_OPP } from '../../core/damage';
import type { CharacterDoc } from '../../model/doc';
import { setDelta, type SetDelta } from '../../model/derivedDelta';
import { CFG_MAIN, hydrate } from '../../model/hydrate';
import { createSet, equip, toggleBuff, updateInstance } from '../../model/ops';
import { isClassPassive } from '../../model/passives';
import { docFrom, loadRef, lookup } from '../../model/__tests__/testDoc';
import { EditorProvider } from '../EditorContext';
import { classSkills, DamageBody, DamageCheck, logEntry } from '../panels/DamageCheck';
import { ModsCard, ModsCardView } from '../panels/ModsCard';
import { deltaRows, SetDeltaPanel, SetDeltaView } from '../panels/SetDeltaPanel';
import { StatsPanel } from '../panels/StatsPanel';
import { calcFor, flashDir, fmt, groupCells, heroCells, signed } from '../panels/summaryGroups';

beforeAll(() => loadRef());

/** Видимий текст розмітки: без тегів, пробіли (і нерозривні теж) стиснуто. */
const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const norm = (s: string): string => s.replace(/\s+/g, ' ');
const noop = () => {};

function renderIn(doc: CharacterDoc, activeCfg: string, children: ReactNode, readOnly = false): string {
  const model = hydrate(doc, lookup);
  return renderToStaticMarkup(
    <EditorProvider doc={doc} model={model} onChange={noop} readOnly={readOnly} activeCfg={activeCfg} onActiveCfg={noop}>
      {children}
    </EditorProvider>,
  );
}

/** Воїн із ПЗ-сетом: у сеті — копія зброї Головного з доданим ролом ПЗ +20. */
function pzSetDoc(): { doc: CharacterDoc; setId: string } {
  const base = docFrom('typical-by');
  const created = createSet(base, 'pz');
  const setId = created.setId!;
  let doc = equip(created.doc, setId, 'ta', created.doc.main.ta!);
  doc = updateInstance(doc, setId, doc.main.ta!, { x: [{ t: 'sx', v: 20 }] }).doc;
  return { doc, setId };
}

describe('зведення по групах і hero-рядок', () => {
  it('жодна з 32 комірок ядра не губиться, атрибути — окремою групою', () => {
    const model = hydrate(docFrom('typical-by'), lookup);
    const calc = calcFor(model, CFG_MAIN);
    expect(calc.summary.cells).toHaveLength(32);
    const groups = groupCells(calc.summary, model.doc.attrs);
    expect(groups.map((g) => g.title)).toEqual(['Атака', 'Захист', 'Атрибути', 'Інше']);
    const core = groups.filter((g) => g.key !== 'attrs').flatMap((g) => g.cells);
    expect(core).toHaveLength(32);
    expect(new Set(core.map((c) => c.label)).size).toBe(32);
    expect(groups.find((g) => g.key === 'attrs')!.cells.map((c) => c.label)).toEqual(['Сила', 'Спритність', 'Тілобудова', 'Інтелект']);
  });

  it('воїну — фіз. атака й атак/сек, магу — маг. атака й спів; ПА і ПЗ — завжди', () => {
    const by = heroCells(calcFor(hydrate(docFrom('typical-by'), lookup), CFG_MAIN)).map((h) => h.label);
    const ga = heroCells(calcFor(hydrate(docFrom('typical-ga'), lookup), CFG_MAIN)).map((h) => h.label);
    expect(by).toEqual(['Здоровʼя', 'Фіз. атака', 'ПА', 'ПЗ', 'Крит', 'Атак/сек']);
    expect(ga).toEqual(['Здоровʼя', 'Маг. атака', 'ПА', 'ПЗ', 'Крит', 'Спів']);
  });

  it('напрям підсвітки й числа зі знаком', () => {
    expect(flashDir(undefined, '100')).toBeNull();
    expect(flashDir('1 000', '1 200')).toBe('up');
    expect(flashDir('12 874 (−5.0%)', '12 000 (−5.0%)')).toBe('down');
    expect(flashDir('−5%', '+3%')).toBe('up');
    expect(flashDir('—', '1.25')).toBeNull();
    expect(signed(20)).toBe('+20');
    expect(signed(-5)).toBe('−5');
    expect(signed(0.4)).toBe('0');
    expect(signed(0.123, 2)).toBe('+0.12');
    expect(signed(-0.001, 2)).toBe('0');
  });
});

describe('StatsPanel', () => {
  it('hero-рядок містить ПА і ПЗ з числами ядра', () => {
    const doc = docFrom('typical-by');
    const calc = calcFor(hydrate(doc, lookup), CFG_MAIN);
    const html = renderIn(doc, CFG_MAIN, <StatsPanel cfgId={CFG_MAIN} />);
    expect(html).toContain('doll-hero-cell pa');
    expect(html).toContain('doll-hero-cell pz');
    const text = visible(html);
    expect(text).toContain(norm('ПА ' + fmt(calc.derived.pa)));
    expect(text).toContain(norm('ПЗ ' + fmt(calc.derived.pz)));
    expect(text).toContain(norm('Здоровʼя ' + fmt(calc.summary.char.hp)));
    expect(text).toContain('Головний');
    expect(text).not.toContain('з бафами');
  });

  it('на вкладці сету — назва сету і заповнена конфігурація (ПЗ на 20 більше)', () => {
    const { doc, setId } = pzSetDoc();
    const model = hydrate(doc, lookup);
    const main = calcFor(model, CFG_MAIN);
    const set = calcFor(model, setId);
    expect(set.derived.pz).toBe(main.derived.pz + 20);
    const text = visible(renderIn(doc, setId, <StatsPanel cfgId={setId} />));
    expect(text).toContain(norm('ПЗ ' + fmt(set.derived.pz)));
    expect(text).toContain('порожні слоти — як у Головному');
  });

  it('увімкнений баф позначає числа «з бафами»', () => {
    const doc0 = docFrom('typical-by');
    const first = shownBuffs(calcFor(hydrate(doc0, lookup), CFG_MAIN).build).find((b) => !isClassPassive('by', b.id));
    expect(first).toBeDefined();
    const plain = visible(renderIn(doc0, CFG_MAIN, <StatsPanel cfgId={CFG_MAIN} />));
    expect(plain).toContain('+ пасивки');
    expect(plain).not.toContain('з бафами');
    const doc = toggleBuff(doc0, first!.id);
    const text = visible(renderIn(doc, CFG_MAIN, <StatsPanel cfgId={CFG_MAIN} />));
    expect(text).toContain('з бафами');
  });
});

describe('SetDeltaPanel', () => {
  it('показує дельту ПЗ зі знаком плюс і зеленим класом', () => {
    const { doc, setId } = pzSetDoc();
    const html = renderIn(doc, setId, <SetDeltaPanel setId={setId} />);
    expect(html).toMatch(/doll-delta-d up">\+20/);
    const text = visible(html);
    expect(text).toContain('Проти Головного');
    expect(text).toContain('ПЗ');
    expect(text).toContain('+20');
  });

  it('від’ємна дельта — типографський мінус і клас down; рядок виду сету виділено', () => {
    const { doc, setId } = pzSetDoc();
    const d = setDelta(hydrate(doc, lookup), setId);
    // Та сама пара, але навпаки: «сет» гірший за «Головний» на 20 ПЗ.
    const flipped: SetDelta = { main: d.set, set: d.main, delta: { ...d.delta, pz: -d.delta.pz } };
    const rows = deltaRows(flipped, 'pz');
    const pz = rows.find((r) => r.key === 'pz')!;
    expect(pz.deltaText).toBe('−20');
    expect(pz.focus).toBe(true);
    const html = renderToStaticMarkup(<SetDeltaView d={flipped} name="ПЗ" kind="pz" />);
    expect(html).toMatch(/doll-delta-d down">−20/);
    expect(html).toContain('doll-delta-row focus');
  });

  it('порожній сет = Головний: усі дельти нульові й підказка, що надіти', () => {
    const created = createSet(docFrom('typical-ga'), 'aspd');
    const setId = created.setId!;
    const rows = deltaRows(setDelta(hydrate(created.doc, lookup), setId), 'aspd');
    expect(rows.every((r) => r.delta === 0 && r.deltaText === '0')).toBe(true);
    // Рядок виду «Спів» лишається, навіть якщо значення нульове.
    expect(rows.filter((r) => r.focus).map((r) => r.key)).toEqual(['channel']);
    const text = visible(renderIn(created.doc, setId, <SetDeltaPanel setId={setId} />));
    expect(text).toContain('нічим не відрізняється');
  });

  it('невідомий сет — нічого не малює', () => {
    expect(renderIn(docFrom('typical-by'), CFG_MAIN, <SetDeltaPanel setId="snope00" />)).toBe('');
  });
});

describe('ModsCard', () => {
  it('рядки пасивок, бафів і дебафів з підписом «бафи в скор не входять», увімкнений — з позначкою', () => {
    const doc0 = docFrom('typical-by');
    const buffs = shownBuffs(calcFor(hydrate(doc0, lookup), CFG_MAIN).build).filter((b) => !isClassPassive('by', b.id));
    const doc = toggleBuff(doc0, buffs[0].id);
    const html = renderIn(doc, CFG_MAIN, <ModsCard />);
    const text = visible(html);
    expect(text).toContain('бафи в скор не входять');
    expect(text).toContain('Пасивки');
    expect(text).toContain('увімкнено 1'); // пасивки не рахуються як увімкнені стани
    expect(text).toContain('Вимкнути всі');
    // 4 техніки бою Воїна (діють завжди) + увімкнений баф
    expect(html.match(/class="doll-buff on"/g)).toHaveLength(5);
    // Іконка — спрайт yo.png через style-обʼєкт, а не рядок розмітки.
    expect(html).toContain('background-image:url');
    expect(html).toContain('aria-label="Додати баф"');
    expect(html).toContain('aria-label="Додати дебаф"');
  });

  it('лише перегляд: без «+», галочки вимкнені', () => {
    const doc = docFrom('typical-by');
    const calc = calcFor(hydrate(doc, lookup), CFG_MAIN);
    const tip = { show: noop, hide: noop, toggle: noop, hideAll: noop };
    const html = renderToStaticMarkup(
      <ModsCardView build={calc.build} readOnly tip={tip} onToggle={noop} onCfg={noop} onAdd={noop} onAllOff={noop} />,
    );
    expect(html).not.toContain('Додати баф');
    expect(html).toContain('disabled');
  });
});

describe('DamageCheck', () => {
  it('згорнута за замовчуванням і з підписом «у скор не входить»', () => {
    const html = renderIn(docFrom('typical-by'), CFG_MAIN, <DamageCheck />);
    expect(visible(html)).toContain('у скор не входить');
    expect(html).not.toContain('doll-skill-grid');
  });

  it('розгорнута: суперник, скіли класу, порожній лог', () => {
    const html = renderIn(docFrom('typical-by'), CFG_MAIN, <DamageCheck defaultOpen />);
    const skills = classSkills('by');
    expect(skills.length).toBeGreaterThan(0);
    expect(html.match(/class="doll-skill"/g)).toHaveLength(skills.length);
    const text = visible(html);
    expect(text).toContain(DEFAULT_OPP.name);
    expect(text).toContain('Натисни на скіл');
  });

  it('запис логу — урон ядра обʼєктом, показаний текстом', () => {
    const doc = docFrom('typical-by');
    const calc = calcFor(hydrate(doc, lookup), CFG_MAIN);
    const sk = classSkills('by')[0];
    const e = logEntry(calc, DEFAULT_OPP, sk, 1);
    expect(e).toMatchObject({ id: 1, mob: DEFAULT_OPP.name, skill: sk.name, an: sk.an });
    expect(e.d.max).toBeGreaterThanOrEqual(e.d.min);
    expect(e.d.min).toBeGreaterThan(0);
    const html = renderToStaticMarkup(
      <DamageBody calc={calc} opponent={DEFAULT_OPP} log={[e]} onHit={noop} onClear={noop} onEditOpp={noop} onResetOpp={noop} />,
    );
    const text = visible(html);
    expect(text).toContain('«' + sk.name + '»');
    expect(text).toContain(norm(fmt(e.d.min) + '–' + fmt(e.d.max)));
    expect(text).toContain('Очистити');
  });
});
