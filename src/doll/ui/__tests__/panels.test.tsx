// =========================================================
// ЛЯЛЬКА — картки середньої й правої колонок (характеристики зі смужкою
// станів, перевірка урону, дельти сету, готовність до турніру, атрибути,
// пасивки класу, плашка стану): рендер у рядок через renderToStaticMarkup на
// golden-фікстурах ядра, у справжньому EditorProvider. Перевіряємо те, що
// бачить гравець: ПА/ПЗ у плитках, «Чисті / У бою», знак і колір дельти сету,
// скор і тир, «вивчено» пасивок, «+97 → 552» атрибутів, підписи «у скор не входить»,
// картка «Джин» (пігулка балів, слоти, підсумки червоним).
// =========================================================

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Картки «Готовність» і «Атрибути» тягнуть шкалу балів (rulesStore → Supabase) — у тестах без мережі.
vi.mock('../../../app/supabaseClient', () => ({ supabase: { from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }) } }));
import {
  BUILTIN_RULES_VERSION, listRulesVersions, normalizeRules, registerRules, rulesFor, tierForWith, type GearRules,
} from '../../../data/gearRules';
import { affPointsAtLevel } from '../../../data/genie';
import { shownBuffs } from '../../core/buffs';
import { DEFAULT_OPP } from '../../core/damage';
import { computeStats } from '../../core/stats';
import { emptyDoc, type CharacterDoc } from '../../model/doc';
import { setDelta, type SetDelta } from '../../model/derivedDelta';
import { CFG_MAIN, hydrate, toDollState } from '../../model/hydrate';
import { buffRow, createSet, equip, setBuffSide, setLevel, stepBuffLvl, toggleBuff, updateInstance } from '../../model/ops';
import { classPassives, isClassPassive } from '../../model/passives';
import { dollScorePreview, PREVIEW_TEAM_SIZE } from '../../model/readiness';
import { buildOf, vitShare, type Sheet } from '../../model/sheet';
import { docFrom, loadRef, lookup } from '../../model/__tests__/testDoc';
import { EditorProvider, useEditor } from '../EditorContext';
import { AttrsCard, BuildScale, clampAttr } from '../panels/AttrsCard';
import { classSkills, DamageBody, DamageCheck, logEntry } from '../panels/DamageCheck';
import { GenieCard, GenieCardView, genieSums } from '../panels/GenieCard';
import { PassivesCard, passiveShort } from '../panels/PassivesCard';
import { ReadinessCard } from '../panels/ReadinessCard';
import { deltaRows, SetDeltaPanel, SetDeltaView } from '../panels/SetDeltaPanel';
import { StatesStrip, StatesStripView } from '../panels/StatesStrip';
import { StatsPanel } from '../panels/StatsPanel';
import { StatusPlate, StatusPlateView } from '../panels/StatusPlate';
import { calcFor, flashDir, fmt, groupCells, heroCells, signed } from '../panels/summaryGroups';

beforeAll(() => loadRef());
afterEach(() => {
  vi.unstubAllGlobals();
});

/** Видимий текст розмітки: без тегів, пробіли (і нерозривні теж) стиснуто. */
const visible = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const norm = (s: string): string => s.replace(/\s+/g, ' ');
const count = (html: string, re: RegExp): number => (html.match(re) || []).length;
const noop = () => {};
const tip = { show: noop, hide: noop, toggle: noop, hideAll: noop };

function renderIn(doc: CharacterDoc, activeCfg: string, children: ReactNode, readOnly = false): string {
  const model = hydrate(doc, lookup);
  return renderToStaticMarkup(
    <EditorProvider doc={doc} model={model} onChange={noop} readOnly={readOnly} activeCfg={activeCfg} onActiveCfg={noop}>
      {children}
    </EditorProvider>,
  );
}

/** Режим «Чисті / У бою» живе в localStorage браузера — у тесті сховище в памʼяті. */
function withStatsMode(mode: 'clean' | 'battle'): void {
  const store = new Map<string, string>([['pvpDollStatsMode', mode]]);
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
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

/** Воїн з увімкненим бафом, що справді міняє характеристики (щоб «Чисті» й «У бою» різнились). */
function buffedBy(): { doc: CharacterDoc; id: number } {
  const doc0 = docFrom('typical-by');
  const clean = calcFor(hydrate(doc0, lookup), CFG_MAIN, false).summary.cells;
  for (const b of shownBuffs(calcFor(hydrate(doc0, lookup), CFG_MAIN).build)) {
    if (isClassPassive('by', b.id)) continue;
    const doc = toggleBuff(doc0, b.id);
    const battle = calcFor(hydrate(doc, lookup), CFG_MAIN, true).summary.cells;
    if (JSON.stringify(battle) !== JSON.stringify(clean)) return { doc, id: b.id };
  }
  throw new Error('жоден баф воїна не міняє характеристик');
}

/** Стара «Анкета для турнірів» у збереженому персонажі (без джина): у бали й у картки не йде. */
const OLD_SHEET: Sheet = { weaponGrade: 'other', armorSet: 'other', tract: 't1_3', ring1: 'r9r1', ring2: 'r9r1' };
/** Готовий до турніру лучник: фікстура + імʼя і шлях (очки фікстури роздано всі); анкета не потрібна. */
const readyJs = (): CharacterDoc => ({ ...docFrom('typical-js'), name: 'Тайфорн', path: 'rs' });

/** Тимчасово зробити поточною іншу версію шкали — і повернути вбудовану. */
function withRules(rules: GearRules, fn: () => void): void {
  const builtin = rulesFor(BUILTIN_RULES_VERSION);
  const info = listRulesVersions().find((v) => v.version === BUILTIN_RULES_VERSION)!;
  registerRules({ version: 'test-scale', note: null, createdAt: null, builtin: false }, rules, true);
  try {
    fn();
  } finally {
    registerRules(info, builtin, true);
  }
}

describe('зведення по групах і плитки', () => {
  it('жодна з 32 комірок ядра не губиться; групи «Атака / Захист / Інше», атрибутів у таблицях немає', () => {
    const model = hydrate(docFrom('typical-by'), lookup);
    const calc = calcFor(model, CFG_MAIN);
    expect(calc.summary.cells).toHaveLength(32);
    const groups = groupCells(calc.summary);
    expect(groups.map((g) => g.title)).toEqual(['Атака', 'Захист', 'Інше']);
    const cells = groups.flatMap((g) => g.cells);
    expect(cells).toHaveLength(32);
    expect(new Set(cells.map((c) => c.label)).size).toBe(32);
    // атрибути (з бонусами речей) — у картці «Атрибути», не в таблицях
    for (const a of ['Сила', 'Спритність', 'Тілобудова', 'Інтелект']) expect(cells.some((c) => c.label === a), a).toBe(false);
  });

  it('порядок макета: атака (×2, з середнім), ПА, ПЗ / здоровʼя (×2), крит, атак/сек — магу маг. атака й спів', () => {
    const calc = calcFor(hydrate(docFrom('typical-by'), lookup), CFG_MAIN);
    const by = heroCells(calc);
    const ga = heroCells(calcFor(hydrate(docFrom('typical-ga'), lookup), CFG_MAIN));
    expect(by.map((h) => h.label)).toEqual(['Фіз. атака', 'ПА', 'ПЗ', 'Здоровʼя', 'Крит', 'Атак/сек']);
    expect(ga.map((h) => h.label)).toEqual(['Маг. атака', 'ПА', 'ПЗ', 'Здоровʼя', 'Крит', 'Спів']);
    expect(by.filter((h) => h.wide).map((h) => h.key)).toEqual(['atk', 'hp']);
    const { min, max } = calc.summary.char.physAtk;
    expect(by[0].note).toBe('сер. ' + fmt((min + max) / 2));
    expect(by.slice(1).every((h) => !h.note)).toBe(true);
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
  it('плитки з числами ядра, атака з середнім, назва конфігурації, типово «Чисті»', () => {
    const doc = docFrom('typical-by');
    const calc = calcFor(hydrate(doc, lookup), CFG_MAIN, false);
    const html = renderIn(doc, CFG_MAIN, <StatsPanel cfgId={CFG_MAIN} />);
    expect(html).toContain('doll-hero-cell pa');
    expect(html).toContain('doll-hero-cell pz');
    expect(html).toContain('doll-hero-cell atk wide');
    expect(html).toContain('doll-hero-cell hp wide');
    // підпис і значення — сусіди, примітка «сер.» — після значення
    expect(html).toMatch(/doll-hero-l">Фіз\. атака<\/span><b class="doll-hero-v">[^<]+<\/b><span class="doll-hero-n">сер\. /);
    const text = visible(html);
    expect(text).toContain(norm('ПА ' + fmt(calc.derived.pa)));
    expect(text).toContain(norm('ПЗ ' + fmt(calc.derived.pz)));
    expect(text).toContain(norm('Здоровʼя ' + fmt(calc.summary.char.hp)));
    expect(text).toContain('Головний');
    // перемикач — наявний .doll-seg з role=radiogroup; «Чисті» обрано
    expect(html).toMatch(/role="radiogroup" aria-label="Як рахувати характеристики"/);
    expect(html).toMatch(/aria-checked="true"[^>]*>Чисті</);
    expect(html).toMatch(/aria-checked="false"[^>]*>У бою</);
    // таблиці без групи «Атрибути»; дві колонки: «Атака + Інше» | «Захист»
    expect(html).not.toContain('aria-label="Атрибути"');
    expect(html).toMatch(/class="doll-stat-col"><section class="doll-stat-group attack"[^]*?class="doll-stat-group other"[^]*?<\/div><div class="doll-stat-col"><section class="doll-stat-group defense"/);
    // пасивки воїна діють завжди — видно в примітці; станів у «Чисті» немає
    expect(text).toContain('+ пасивки');
    expect(text).not.toContain('+ стани');
  });

  it('на вкладці сету — назва сету і заповнена конфігурація (ПЗ на 20 більше)', () => {
    const { doc, setId } = pzSetDoc();
    const model = hydrate(doc, lookup);
    const main = calcFor(model, CFG_MAIN, false);
    const set = calcFor(model, setId, false);
    expect(set.derived.pz).toBe(main.derived.pz + 20);
    const text = visible(renderIn(doc, setId, <StatsPanel cfgId={setId} />));
    expect(text).toContain(norm('ПЗ ' + fmt(set.derived.pz)));
    expect(text).toContain('порожні слоти — як у Головному');
  });

  it('«Чисті» — увімкнений баф на числа не впливає; «У бою» — числа з бафами і позначка «+ стани»', () => {
    const { doc } = buffedBy();
    const model = hydrate(doc, lookup);
    const clean = calcFor(model, CFG_MAIN, false);
    const battle = calcFor(model, CFG_MAIN, true);
    const differ = battle.summary.cells.filter((c, i) => c.val !== clean.summary.cells[i].val);
    expect(differ.length).toBeGreaterThan(0);

    const plain = visible(renderIn(doc, CFG_MAIN, <StatsPanel cfgId={CFG_MAIN} />));
    for (const c of differ) expect(plain, c.label).toContain(norm(c.label + ' ' + clean.summary.cells.find((x) => x.label === c.label)!.val));
    expect(plain).not.toContain('+ стани');
    expect(plain).toContain('Бафи вимкнено з розрахунку — так рахує скор');

    withStatsMode('battle');
    const html = renderIn(doc, CFG_MAIN, <StatsPanel cfgId={CFG_MAIN} />);
    const text = visible(html);
    for (const c of differ) expect(text, c.label).toContain(norm(c.label + ' ' + c.val));
    expect(text).toContain('+ стани');
    expect(html).toMatch(/aria-checked="true"[^>]*>У бою</);
  });
});

describe('«Чисті / У бою»: розрахунок і режим у контексті', () => {
  it('calcFor без бафів — як скор: увімкнений баф на числа не впливає, з бафами — впливає', () => {
    const doc0 = docFrom('typical-by');
    const first = shownBuffs(calcFor(hydrate(doc0, lookup), CFG_MAIN).build).find((b) => !isClassPassive('by', b.id))!;
    const doc = toggleBuff(doc0, first.id);
    const model = hydrate(doc, lookup);
    const clean = calcFor(model, CFG_MAIN, false);
    const battle = calcFor(model, CFG_MAIN, true);
    expect(clean).not.toBe(battle); // окремі записи кешу
    expect(calcFor(model, CFG_MAIN, false)).toBe(clean);
    expect(calcFor(model, CFG_MAIN)).toBe(battle); // за замовчуванням — з бафами, як досі
    expect(clean.buffed).toBe(false);
    expect(battle.buffed).toBe(true);
    // «Чисті» = документ без бафів (пасивки лишаються)
    expect(clean.summary.cells).toEqual(calcFor(hydrate(doc0, lookup), CFG_MAIN, false).summary.cells);
    expect(clean.passives).toBe(true);
  });

  it('режим памʼятається в браузері: немає або зламаний — «Чисті», збережений — «У бою»', () => {
    function Probe() {
      return <i>{useEditor().statsMode}</i>;
    }
    const doc = docFrom('typical-by');
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) });
    expect(renderIn(doc, CFG_MAIN, <Probe />)).toBe('<i>clean</i>');
    store.set('pvpDollStatsMode', 'battle');
    expect(renderIn(doc, CFG_MAIN, <Probe />)).toBe('<i>battle</i>');
    store.set('pvpDollStatsMode', 'щось');
    expect(renderIn(doc, CFG_MAIN, <Probe />)).toBe('<i>clean</i>');
  });
});

describe('смужка «Стани»', () => {
  it('«Чисті»: пояснення, «+ баф» / «+ дебаф», рядків бафів немає; увімкнений баф лише згадано', () => {
    const { doc } = buffedBy();
    const html = renderIn(doc, CFG_MAIN, <StatesStrip cfgId={CFG_MAIN} />);
    const text = visible(html);
    expect(text).toContain('Бафи вимкнено з розрахунку — так рахує скор');
    expect(text).toContain('+ баф');
    expect(text).toContain('+ дебаф');
    expect(text).toContain('увімкнено 1');
    expect(html).not.toContain('doll-buff-ic');
    expect(text).not.toContain('Вимкнути всі');
  });

  it('«У бою»: рядки бафів і дебафів, увімкнений — з позначкою, «Вимкнути всі»; пасивок тут немає', () => {
    withStatsMode('battle');
    const { doc } = buffedBy();
    const html = renderIn(doc, CFG_MAIN, <StatesStrip cfgId={CFG_MAIN} />);
    const text = visible(html);
    expect(text).toContain('у скор не входять');
    expect(text).toContain('увімкнено 1'); // пасивки не рахуються як увімкнені стани
    expect(text).toContain('Вимкнути всі');
    expect(html).toContain('aria-label="Бафи"');
    expect(html).toContain('aria-label="Дебафи"');
    // лише увімкнений баф; 4 техніки бою Воїна — у картці «Пасивки класу», не тут
    expect(count(html, /class="doll-buff on"/g)).toBe(1);
    for (const p of classPassives('by')) expect(html).not.toContain(p.name);
    // Іконка — спрайт через style-обʼєкт, а не рядок розмітки.
    expect(html).toContain('background-image:url');
    expect(html).toContain('aria-label="Додати баф"');
    expect(html).toContain('aria-label="Додати дебаф"');
    expect(text).not.toContain('+ баф');
  });

  it('лише перегляд: без «+» і «Вимкнути всі», галочки вимкнені', () => {
    const { doc } = buffedBy();
    const calc = calcFor(hydrate(doc, lookup), CFG_MAIN, true);
    const view = (mode: 'clean' | 'battle') =>
      renderToStaticMarkup(<StatesStripView build={calc.build} mode={mode} readOnly tip={tip} onToggle={noop} onCfg={noop} onAdd={noop} onAllOff={noop} />);
    const battle = view('battle');
    expect(battle).not.toContain('Додати баф');
    expect(battle).not.toContain('Вимкнути всі');
    expect(battle).toContain('disabled');
    expect(battle).toMatch(/type="checkbox"[^>]*disabled=""/);
    expect(battle).not.toMatch(/type="checkbox"(?![^>]*disabled)[^>]*>/);
    const clean = visible(view('clean'));
    expect(clean).not.toContain('+ баф');
    expect(clean).toContain('так рахує скор');
  });
});

describe('Атрибути', () => {
  it('рядок: назва, −, поле, +, бонус «+N → M» з речей; вільних 0 — «+» вимкнено', () => {
    const doc = docFrom('typical-by');
    const t = computeStats(toDollState(hydrate(doc, lookup), CFG_MAIN)).t;
    const html = renderIn(doc, CFG_MAIN, <AttrsCard />);
    const text = visible(html);
    expect(text).toContain('вільних 0');
    expect(t.uy).toBeGreaterThan(0);
    expect(text).toContain(norm('+' + fmt(t.uy) + ' → ' + fmt(doc.attrs.dex + t.uy)));
    expect(count(html, /class="doll-attr-row"/g)).toBe(4);
    for (const a of ['Сила', 'Спритність', 'Тілобудова', 'Інтелект']) {
      expect(html).toMatch(new RegExp('aria-label="' + a + ': більше" disabled=""'));
    }
    // Інтелект на базових 5 — «менше» вимкнено, Сила — ні
    expect(html).toMatch(/aria-label="Інтелект: менше" disabled=""/);
    expect(html).not.toMatch(/aria-label="Сила: менше" disabled=""/);
    // «скинути» є, титули — згорнутий блок унизу картки
    expect(text).toContain('скинути');
    expect(html).toMatch(/<details class="doll-titles">/);
  });

  it('шкала збірки: заливка — частка Тілобудови, риски й підписи — за порогами шкали', () => {
    const doc = docFrom('typical-by'); // Тілобудова 85: 80 з 520 розданих ≈ 15 %
    const text = visible(renderIn(doc, CFG_MAIN, <AttrsCard />));
    expect(text).toContain('Збірка: ДД');
    expect(text).toContain('у Тілобудові 15 % очок');
    const html = renderToStaticMarkup(<BuildScale doc={doc} hybrid={0.1} con={0.3} build="hybrid" />);
    expect(html).toContain('left:10%');
    expect(html).toContain('left:30%');
    expect(html).toContain('width:15.4%');
    expect(html).toContain('grid-template-columns:minmax(0, 10%) minmax(0, 20%) minmax(0, 1fr)');
    expect(html).toMatch(/class="is-on">Гібрид</);
    // вбудована шкала: 25 % і 50 %
    const builtin = renderIn(doc, CFG_MAIN, <AttrsCard />);
    expect(builtin).toContain('left:25%');
    expect(builtin).toContain('left:50%');
  });

  it('порожня чернетка: вільних 520 (жовте), у Тілобудові 0 % — без NaN; «скинути» нічого скидати', () => {
    const html = renderIn(emptyDoc(), CFG_MAIN, <AttrsCard />);
    const text = visible(html);
    expect(text).toContain('вільних 520');
    expect(html).toContain('doll-card-pill warn');
    expect(text).toContain('у Тілобудові 0 % очок');
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(html).toMatch(/class="doll-card-act" disabled=""[^>]*>скинути/);
    expect(count(html, /: менше" disabled=""/g)).toBe(4);
  });

  it('перевитрата: «вільних −N» червоне і пояснення; «−» лише зменшує, «+» тримає бюджет', () => {
    const doc = setLevel(docFrom('typical-by'), 100); // 25 очок роздано понад бюджет
    const html = renderIn(doc, CFG_MAIN, <AttrsCard />);
    expect(html).toContain('doll-card-pill bad');
    expect(visible(html)).toContain('Роздано більше очок, ніж дає рівень');
    expect(clampAttr(doc, 'str', doc.attrs.str + 1).attrs.str).toBe(doc.attrs.str - 25);
    const free = { ...emptyDoc(), level: 2 }; // 5 вільних очок
    expect(clampAttr(free, 'dex', 100).attrs.dex).toBe(10);
  });

  it('відсоток Тілобудови — униз: 24,9 % — ще ДД, напис не каже «25 %»; 0,29 — 29, а не 28 (плаваюча кома)', () => {
    const near = { ...emptyDoc(), attrs: { str: 306, dex: 5, vit: 105, mag: 5 } }; // 100 з 401 розданих = 24,94 %
    expect(vitShare(near)).toBeLessThan(0.25);
    expect(buildOf(near, rulesFor(null))).toBe('dd');
    expect(visible(renderToStaticMarkup(<BuildScale doc={near} hybrid={0.25} con={0.5} build="dd" />))).toContain('у Тілобудові 24 % очок');
    const exact = { ...emptyDoc(), attrs: { str: 76, dex: 5, vit: 34, mag: 5 } }; // 29 зі 100
    expect(vitShare(exact) * 100).toBeLessThan(29); // 28,999… — саме тому не голий Math.floor
    expect(visible(renderToStaticMarkup(<BuildScale doc={exact} hybrid={0.25} con={0.5} build="hybrid" />))).toContain('у Тілобудові 29 % очок');
  });

  it('лише перегляд: поля й кнопки вимкнені, «скинути» сховано', () => {
    const html = renderIn(emptyDoc(), CFG_MAIN, <AttrsCard />, true);
    expect(html).not.toContain('скинути');
    expect(count(html, /class="doll-step" aria-label="[^"]+" disabled=""/g)).toBe(8);
    expect(html).not.toMatch(/<input(?![^>]*disabled)[^>]*>/);
  });
});

describe('Пасивки класу', () => {
  it('Воїн: 4 пасивки на місці — «вивчено», рівень −/N/+, Світла/Темна, короткий ефект', () => {
    const doc = docFrom('typical-by'); // без шляху — типово 10 рівень без сторони
    const html = renderIn(doc, CFG_MAIN, <PassivesCard />);
    const text = visible(html);
    expect(classPassives('by')).toHaveLength(4);
    expect(count(html, /class="doll-psv"/g)).toBe(4);
    expect(text).toContain('входять у скор');
    expect(count(html, /type="checkbox" checked=""/g)).toBe(4);
    expect(count(html, /вивчено/g)).toBe(4);
    expect(count(html, /<b>10<\/b>/g)).toBe(4);
    expect(count(html, /aria-label="Вищий рівень" disabled=""/g)).toBe(4); // 10 — звичайний максимум
    expect(count(html, /aria-label="Нижчий рівень"(?! disabled)/g)).toBe(4);
    expect(count(html, /aria-pressed="false"[^>]*>Світла</g)).toBe(4);
    for (const w of ['клинком', 'списом', 'молотом', 'кастетом']) expect(text).toContain('атака ' + w + ' +60%');
  });

  it('шлях з 89 рівня — 11 рівень зі стороною; сторону видно; «не вивчено» — приглушено', () => {
    const doc = { ...docFrom('typical-by'), path: 'je' as const };
    let html = renderIn(doc, CFG_MAIN, <PassivesCard />);
    expect(count(html, /<b>11<\/b>/g)).toBe(4);
    expect(count(html, /aria-pressed="true"[^>]*>Темна</g)).toBe(4);
    expect(visible(html)).toContain('атака клинком +75%, крит +1%');
    const first = classPassives('by')[0];
    html = renderIn(toggleBuff(doc, first.id), CFG_MAIN, <PassivesCard />);
    expect(count(html, /class="doll-psv is-off"/g)).toBe(1);
    expect(count(html, /type="checkbox" checked=""/g)).toBe(3);
    // повторний клік по стороні знімає її: рівень — звичайний максимум
    const off = setBuffSide(doc, first.id, '');
    expect(visible(renderIn(off, CFG_MAIN, <PassivesCard />))).toContain('атака клинком +60%');
  });

  it('короткий ефект: майстерність зброї і крит', () => {
    const b = classPassives('js')[0];
    expect(passiveShort(b, 11, 'rs')).toBe('атака луком +90%');
    expect(passiveShort(b, 11, 'je')).toBe('атака луком +75%, крит +1%');
    expect(passiveShort(b, 1, '')).toBe('атака луком +6%');
  });

  it('імпортований рядок: рівень і ефект — як бере ядро; lvl = max без сторони показуємо як звичайний максимум, «+» не залипає', () => {
    const base = docFrom('typical-by');
    const [a, b] = classPassives('by');
    const doc: CharacterDoc = {
      ...base,
      buffs: { cfg: { [a.id]: { on: true, lvl: 11, side: '' }, [b.id]: { on: true, lvl: 5, side: 'rs' } }, extra: [] },
    };
    const html = renderIn(doc, CFG_MAIN, <PassivesCard />);
    const text = visible(html);
    // a: 11 без сторони → показуємо 10 і ефект 10-го (не 11-го без бонусу сторони)
    expect(count(html, /<b>10<\/b>/g)).toBe(3); // a + дві типові
    expect(text).toContain(passiveShort(a, 10, ''));
    expect(text).not.toContain(passiveShort(a, 11, ''));
    // b: сторона на 5 рівні — ядро рахує 5-й (buffVal), а не максимум
    expect(html).toMatch(/<b>5<\/b>/);
    expect(text).toContain(passiveShort(b, 5, 'rs'));
    expect(text).not.toContain(passiveShort(b, 11, 'rs'));
    expect(count(html, /aria-pressed="true"[^>]*>Світла</g)).toBe(1);
    // «+» вимкнено скрізь (10 — звичайний максимум, у b — сторона), «−» — ні
    expect(count(html, /aria-label="Вищий рівень" disabled=""/g)).toBe(4);
    expect(count(html, /aria-label="Нижчий рівень"(?! disabled)/g)).toBe(4);
    // «−» від показаних 10 веде на 9, «+» повертає 10 — рядок нормалізовано, кнопки не залипають
    const down = stepBuffLvl(doc, a, '-1');
    expect(buffRow(down, a.id).lvl).toBe(9);
    expect(buffRow(stepBuffLvl(down, a, '+1'), a.id)).toMatchObject({ lvl: 10, side: '' });
  });

  it('Маг: пасивок зброї немає — один рядок, без пігулки', () => {
    const html = renderIn(docFrom('typical-ga'), CFG_MAIN, <PassivesCard />);
    const text = visible(html);
    expect(text).toContain('У цього класу пасивок зброї немає');
    expect(text).not.toContain('входять у скор');
    expect(html).not.toContain('doll-psv');
  });

  it('лише перегляд: галочки, кроки рівня й сторона вимкнені (іконка — лише опис)', () => {
    const html = renderIn(docFrom('typical-by'), CFG_MAIN, <PassivesCard />, true);
    const buttons = html.match(/<button[^>]*>/g) || [];
    const controls = buttons.filter((b) => !b.includes('doll-psv-ic'));
    expect(controls).toHaveLength(4 * 4); // − + Світла Темна
    expect(controls.every((b) => b.includes('disabled=""'))).toBe(true);
    expect(count(html, /type="checkbox"[^>]*disabled=""/g)).toBe(4);
  });
});

describe('Готовність до турніру', () => {
  it('порожня чернетка: «—», пояснення, «не готовий», без розкладу й тиру, жодного NaN', () => {
    const html = renderIn(emptyDoc('js'), CFG_MAIN, <ReadinessCard />);
    const text = visible(html);
    expect(text).toContain('Готовність до турніру');
    expect(text).toContain('не готовий');
    expect(html).toMatch(/class="doll-ready-ring"[^>]*><b>—<\/b>/);
    expect(text).toContain('Надінь зброю й броню в Головному');
    expect(text).toContain('Лучник · 105 · ДД');
    // що бачить лялька: зброї, броні, трактату й кілець немає (не «Луна і нижче» порожнього слота), джина не заповнено
    expect(text).toContain('Лялька бачить:');
    expect(text).toContain('Зброї немає');
    expect(text).toContain('Броні немає');
    expect(text).toContain('Трактат: немає');
    expect(text).toContain('Кільця: немає');
    expect(text).toContain('Джин: не заповнено');
    expect(text).toContain('ШГ / Вознєс: немає');
    expect(text).not.toContain('Луна');
    expect(html).not.toContain('badge tier');
    expect(html).not.toContain('doll-ready-parts');
    expect(text).not.toContain('Розклад по речах');
    expect(text).toContain('Попередній скор для 3×3');
    expect(text).not.toMatch(/Атака ×|Живучість ×|еталон/);
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
  });

  it('скор v2 на поточній шкалі: число в кільці, тир, чипи складових, «Лялька бачить» з речей, розклад із назвами', () => {
    const doc = readyJs();
    const rules = rulesFor(null);
    const p = dollScorePreview(doc, rules, BUILTIN_RULES_VERSION, PREVIEW_TEAM_SIZE, lookup);
    expect(p.score).toBe(207); // клас 8 + рівень 10 + джин 0 + речі 189.01
    const html = renderIn(doc, CFG_MAIN, <ReadinessCard />);
    const text = visible(html);
    expect(text).toContain('готовий');
    expect(text).not.toContain('не готовий');
    expect(html).toMatch(new RegExp('class="doll-ready-ring good"[^>]*><b>' + fmt(p.score) + '</b>'));
    expect(html).toContain('badge tier tier-' + tierForWith(p.score, rules));
    // складові — ті самі, що в заявці (registrationScore)
    expect(text).toMatch(/клас 8 .*рівень 10 .*речі 189\.01 .*джин 0/);
    expect(html).toMatch(/doll-ready-part warn"[^>]*title="джина не заповнено — за нього 0 балів"/);
    // що визначила лялька — з надітих речей, а не з анкети
    expect(text).toMatch(/Зброя: R9 \+/);
    expect(text).toMatch(/Броня: R9 \+/);
    expect(text).toMatch(/Трактат: Імператор і вище · Джин: не заповнено/);
    expect(text).toMatch(/· ШГ \+\d+, Вознєс \+\d+ ·/); // без повтору назви «ШГ / Вознєс ШГ …»
    expect(text).not.toContain('ШГ / Вознєс ШГ');
    expect(text).toMatch(/Кільця: Луна/);
    // згорнутий розклад по речах: бали за речі в заголовку, Головний, назви речей зі scoreItems
    expect(html).toMatch(/<details class="score-bd">/);
    expect(html).not.toMatch(/<details class="score-bd" open/);
    expect(text).toContain('Розклад по речах · 189.01 б.');
    expect(text).toContain('Головний');
    expect(text).toContain('Небесний лук');
    expect(text).toContain('Шолом героя');
    expect(text).toContain('клас 8 · рівень 10 · джин 0');
    // примітки про нерозпізнані речі — у плашці стану повністю, а не обрізаними рядками розкладу
    expect(text).not.toContain('не розпізнала');
    expect(text).toContain('Попередній скор для 3×3; на турнірі бали класу — за розміром команди, у жеребці ще корекції адміна');
    expect(text).not.toMatch(/Атака ×|Живучість ×|еталон|анкет/);
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
    // стара анкета з іншими грейдами нічого не змінює; блок джина — додає бали і підпис
    expect(renderIn({ ...doc, sheet: OLD_SHEET }, CFG_MAIN, <ReadinessCard />)).toBe(html);
    const withGenie = visible(renderIn({ ...doc, genie: { level: 105, luck: 100, skills: [] } }, CFG_MAIN, <ReadinessCard />));
    expect(withGenie).toContain('Джин: удача 100');
    expect(withGenie).toMatch(/джин 10/);
    expect(withGenie).toContain(fmt(217));
  });

  it('інша поточна версія шкали — інші бали класу й тир; картка рахує за поточною', () => {
    const doc = readyJs();
    const base = rulesFor(null);
    const rules = normalizeRules({
      classPointsBySize: { ...base.classPointsBySize, '3': { ...base.classPointsBySize['3'], archer: 20 } },
      tiers: [{ min: 300, tier: 'S' }, { min: 200, tier: 'A' }, { min: null, tier: 'D' }],
    });
    withRules(rules, () => {
      const p = dollScorePreview(doc, rules, 'test-scale', PREVIEW_TEAM_SIZE, lookup);
      expect(p.score).toBe(219);
      const html = renderIn(doc, CFG_MAIN, <ReadinessCard />);
      expect(html).toMatch(new RegExp('class="doll-ready-ring good"[^>]*><b>' + fmt(219) + '</b>'));
      expect(html).toContain('badge tier tier-A');
      expect(visible(html)).toMatch(/клас 20 /);
    });
  });

  it('без зброї чи броні або з перевитратою очок — «—» з поясненням, без тиру й розкладу', () => {
    const doc = readyJs();
    // зброю знято (ніде немає) — заявку не подати
    const main = { ...doc.main };
    delete main.ta;
    const noWeapon = renderIn({ ...doc, main }, CFG_MAIN, <ReadinessCard />);
    expect(noWeapon).toMatch(/class="doll-ready-ring"[^>]*><b>—<\/b>/);
    expect(noWeapon).not.toContain('badge tier');
    expect(visible(noWeapon)).toContain('Надінь зброю й броню в Головному');
    expect(visible(noWeapon)).toContain('не готовий');
    expect(visible(noWeapon)).not.toContain('Розклад по речах');
    // та сама зброя лише в сеті — скор є (рахується зброя із сету), а в Головному її немає
    const { doc: withSet, setId } = createSet({ ...doc, main }, 'pz');
    const inSet = visible(renderIn(equip(withSet, setId!, 'ta', doc.main.ta!), CFG_MAIN, <ReadinessCard />));
    expect(inSet).toContain('Зброя: R9 +10'); // грейд і точка — з найдорожчої зброї, хоч вона й у сеті
    expect(inSet).toContain(fmt(207));
    // порожній слот броні
    const armor = { ...doc.main };
    delete armor.rv;
    const noArmor = visible(renderIn({ ...doc, main: armor }, CFG_MAIN, <ReadinessCard />));
    expect(noArmor).toContain('Надінь зброю й броню в Головному');
    expect(noArmor).toContain('не готовий');
    // роздано більше очок, ніж дає рівень
    const over = { ...doc, attrs: { ...doc.attrs, str: doc.attrs.str + 1 } };
    const overHtml = renderIn(over, CFG_MAIN, <ReadinessCard />);
    expect(overHtml).toMatch(/class="doll-ready-ring"[^>]*><b>—<\/b>/);
    expect(overHtml).not.toContain('badge tier');
    expect(visible(overHtml)).toContain('роздано більше очок, ніж дає рівень');
    expect(visible(overHtml)).toContain('не готовий');
    expect(visible(overHtml)).not.toContain('Розклад по речах');
    expect(visible(overHtml)).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('лише перегляд — картка та сама, без кнопок', () => {
    const html = renderIn(readyJs(), CFG_MAIN, <ReadinessCard />, true);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<input');
  });
});

describe('Плашка стану', () => {
  it('порожня чернетка: «Бракує» з переліком без анкети і жовте нагадування про джина', () => {
    const html = renderIn(emptyDoc(), CFG_MAIN, <StatusPlate />);
    const text = visible(html);
    expect(html).toContain('class="doll-status warn"');
    expect(text).toContain('Бракує');
    for (const b of [
      'імʼя персонажа',
      'вільні очки атрибутів: 520',
      'зброя',
      'порожні слоти броні: нагрудник, поножі, взуття, браслети',
    ]) {
      expect(text).toContain(b);
    }
    expect(text).not.toContain('анкет');
    expect(text).toContain('Зверни увагу');
    expect(text).toContain('порожні слоти: шолом, накидка, намисто, пояс, кільце (л), кільце (п)');
    expect(text).toContain('джина не заповнено — за нього 0 балів');
  });

  it('заповнений персонаж: зелене «Усе заповнено»; нерозпізнані речі — лише нагадування', () => {
    const doc = readyJs();
    const html = renderIn(doc, CFG_MAIN, <StatusPlate />);
    expect(html).toContain('class="doll-status good"');
    const text = visible(html);
    expect(text).toContain('Усе заповнено');
    expect(text).toContain('шлях вказано');
    expect(text).not.toContain('Бракує');
    // кільця фікстури (ранг 17) лялька не впізнає — зараховано «Луна і нижче», заявку не блокує
    expect(text).toContain('Зверни увагу');
    expect(text).toMatch(/Кільце 1: лялька не розпізнала «.+» — зараховано як «Луна і нижче»/);
    // стара галочка ШГ без речі — нагадування
    const main = { ...doc.main };
    delete main.ft;
    const old = visible(renderIn({ ...doc, main, sheet: { ...OLD_SHEET, shg: true } }, CFG_MAIN, <StatusPlate />));
    expect(old).toContain('у старій анкеті стояла галочка ШГ');
  });

  it('перевірити не вдалося — так і кажемо, а не «Усе заповнено»', () => {
    const text = visible(renderToStaticMarkup(<StatusPlateView issues={{ blockers: [], notes: [] }} checked={false} level={105} />));
    expect(text).toContain('Персонажа не вдалося перевірити');
    expect(text).not.toContain('Усе заповнено');
  });
});

describe('Джин (картка)', () => {
  /** Дешеві вміння 1-го рівня (як у genie.test): 8 штук → джин від 100 рівня й удачі 91. */
  const CHEAP = [10001, 9681, 9751, 9791, 9941, 9601, 9581, 9741];
  const full = (): CharacterDoc => ({ ...docFrom('typical-by'), genie: { level: 100, luck: 91, skills: CHEAP } });

  it('порожня чернетка: «не заповнено», порожні поля, 8 порожніх слотів (5–8 з удачею 51/71/81/91), підсумки «—», без іконки doll-icon', () => {
    const html = renderIn(emptyDoc(), CFG_MAIN, <GenieCard />);
    const text = visible(html);
    expect(html).toContain('class="doll-card doll-genie"');
    expect(text).toContain('Джин');
    expect(text).toContain('не заповнено');
    expect(html).toContain('doll-card-pill warn');
    expect(text).toContain('вміння ›');
    expect(html).toContain('aria-label="Вид джина: не обрано"');
    expect(count(html, /class="doll-genie-in[^"]*"[^>]*value=""/g)).toBe(2);
    expect(count(html, /class="doll-genie-slot is-empty"/g)).toBe(4);
    expect(count(html, /class="doll-genie-slot is-empty is-short"/g)).toBe(4);
    for (const n of ['51', '71', '81', '91']) expect(html).toMatch(new RegExp('is-short"[^>]*>' + n + '<'));
    expect(count(html, /doll-genie-sum-v">—/g)).toBe(3);
    expect(html).not.toContain('class="doll-icon"');
    expect(html).not.toContain('doll-genie-range');
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
  });

  it('вид джина — річ у слоті pk Головного: назва в aria-label, іконка спрайта без класу doll-icon', () => {
    const html = renderIn(docFrom('typical-by'), CFG_MAIN, <GenieCard />);
    expect(html).toMatch(/aria-label="Вид джина: [^"]*Тай Инь"/);
    expect(html).toMatch(/class="doll-genie-kind-img" style="background-image:url\(&quot;[^&]*-hii\.png/);
    expect(html).not.toContain('class="doll-icon"');
  });

  it('повна збірка: 8 іконок зі спрайта, «+8 у скор» і діапазон «91–99», підсумки без порушень', () => {
    const doc = full();
    const html = renderIn(doc, CFG_MAIN, <GenieCard />);
    const text = visible(html);
    expect(text).toContain('+8 у скор');
    expect(html).toContain('doll-card-pill good');
    expect(html).toMatch(/doll-genie-range"[^>]*>91–99</);
    expect(count(html, /class="doll-genie-slot"/g)).toBe(8);
    expect(count(html, /class="doll-genie-slot-img" style="[^"]*genie2[^"]*"/g)).toBe(8);
    expect(html).not.toContain('is-empty');
    expect(html).toMatch(/value="100"/);
    expect(html).toMatch(/value="91"/);
    expect(genieSums(doc.genie!)).toEqual({ minLevel: 100, luck: 91, aff: 6, affHave: affPointsAtLevel(100) });
    expect(text).toContain(norm('Мін. рівень 100 є 100'));
    expect(text).toContain(norm('Треба удачі 91 є 91'));
    // «Спорідненість» у колонці 328 px — коротким підписом без трикрапки, повна назва — у підказці
    expect(text).toContain(norm('Спорідн. 6 з 21'));
    expect(html).toMatch(/class="doll-genie-sum" title="Спорідненість"[^>]*><div class="doll-genie-sum-k">Спорідн\.</);
    expect(html).not.toContain('doll-genie-sum bad');
    expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
  });

  it('рівня чи удачі бракує — підсумки червоні; занижена удача балів не знижує (8 вмінь → від 91)', () => {
    const doc: CharacterDoc = { ...docFrom('typical-by'), genie: { level: 80, luck: 50, skills: CHEAP } };
    const html = renderIn(doc, CFG_MAIN, <GenieCard />);
    const text = visible(html);
    expect(count(html, /class="doll-genie-sum bad"/g)).toBe(2);
    expect(text).toContain(norm('Мін. рівень 100 є 80'));
    expect(text).toContain(norm('Треба удачі 91 є 50'));
    expect(text).toContain('+8 у скор');
    // 4 вміння й удача 60: слот 5 відкрито (51), слоти 6–8 пригашені; порушень немає
    const four: CharacterDoc = { ...doc, genie: { level: 60, luck: 60, skills: CHEAP.slice(0, 4) } };
    const h4 = renderIn(four, CFG_MAIN, <GenieCard />);
    expect(count(h4, /class="doll-genie-slot"/g)).toBe(4);
    expect(count(h4, /class="doll-genie-slot is-empty"/g)).toBe(1);
    expect(count(h4, /class="doll-genie-slot is-empty is-short"/g)).toBe(3);
    expect(h4).not.toContain('doll-genie-sum bad');
    expect(visible(h4)).toContain('+0 у скор');
  });

  it('лише перегляд: поля вимкнені, слоти й вид лишаються кнопками (відкривають вікно у перегляді)', () => {
    const html = renderIn(full(), CFG_MAIN, <GenieCard />, true);
    expect(count(html, /class="doll-genie-in[^"]*"[^>]*disabled=""/g)).toBe(2);
    expect(count(html, /class="doll-genie-slot"/g)).toBe(8);
    expect(html).toContain('вміння ›');
  });

  it('чистий вигляд без контексту: вид і бали з пропсів', () => {
    const html = renderToStaticMarkup(
      <GenieCardView
        genie={{ level: 100, luck: 100, skills: [] }}
        kind={{ name: 'Душа Тай Чин', icon: { backgroundImage: 'url("x.png")' } }}
        points={10}
        rangeLabel="удача 100"
        readOnly={false}
        onOpen={noop}
        onLevel={noop}
        onLuck={noop}
      />,
    );
    expect(html).toContain('aria-label="Вид джина: Душа Тай Чин"');
    expect(visible(html)).toContain('+10 у скор');
    expect(html).toMatch(/doll-genie-range"[^>]*>удача 100</);
    // без вмінь удача 100 нічого не вимагає: підсумки 1 / 10 / 0 з 21
    expect(visible(html)).toContain(norm('Мін. рівень 1 є 100'));
    expect(visible(html)).toContain(norm('Треба удачі 10 є 100'));
    expect(visible(html)).toContain(norm('Спорідн. 0 з 21'));
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
