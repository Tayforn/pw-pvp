// =========================================================
// ЛЯЛЬКА — тултіпи й вікна: рендер через renderToStaticMarkup (jsdom у
// проєкті нема), лише React-вузли. Головне, що перевіряємо:
//  • тултіп речі показує рівно рядки buildTipModel (той самий текст, що
//    звірено з Хелпером golden-тестом), а назва з даних ніколи не стає HTML;
//  • вікна рендеряться в справжньому EditorProvider і показують те, що
//    вимагає контракт: банер копії на вкладці сету, секцію «З інвентаря»,
//    стани каталогу;
//  • чисті помічники редактора (гнізда, «Замінити/Повернути базу», кроки рівня бафа).
// =========================================================

import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SLOTS, buffHasSides, buffMaxLevel } from '../../core/constants';
import { readJson } from '../../core/__tests__/testData';
import { getBuffById, getBuffs } from '../../core/refdata';
import { computeStats, flattenItemStats } from '../../core/stats';
import type { DollState, Item, TipCtx } from '../../core/types';
import { catItems, ensureCats } from '../../data/catalog';
import type { CharacterDoc } from '../../model/doc';
import { CFG_MAIN, hydrate } from '../../model/hydrate';
import { createSet, duplicateInstance, equip, setBuffSide, updateInstance } from '../../model/ops';
import { buildBuffTipModel, buildTipModel, type TipModel } from '../../model/tipModel';
import { calcState, docFrom, loadRef, lookup } from '../../model/__tests__/testDoc';
import { EditorProvider } from '../EditorContext';
import { BuffCfgModal, effectiveBuffLvl, stepBuffLvl } from '../modals/BuffCfgModal';
import { BuffPickModal, buffPickRows, PICK_CLASSES } from '../modals/BuffPickModal';
import { EditorModal, replaceBasePatch, restoreBasePatch, STAT_OPTIONS } from '../modals/EditorModal';
import { OpponentModal, parseOppNum } from '../modals/OpponentModal';
import { isNoopPatch, keyStats, PickerModal, withSocket } from '../modals/PickerModal';
import { BuffTip } from '../tip/BuffTip';
import { ItemName } from '../tip/ItemName';
import { ItemTip } from '../tip/ItemTip';
import { TipHost } from '../tip/TipHost';

const noop = () => {};
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);

/** Видимий текст розмітки по елементах: теги → межі, сутності розкодовано. */
function texts(html: string): string[] {
  const decode = (s: string) =>
    s.replace(/&lt;/g, LT).replace(/&gt;/g, GT).replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, '&');
  return html
    .split(new RegExp(LT + '[^' + GT + ']*' + GT))
    .map((t) => decode(t).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
const visible = (html: string): string => texts(html).join(' ');

function slotTipCtx(build: DollState, key: string): TipCtx {
  return {
    gems: build.gems[key], refine: build.refine[key] || 0, isBook: key === 'qn', isWeapon: key === 'ta',
    engrave: build.engrave[key], addons: build.addons[key], wdf: build.wdf[key], crystal: build.crystal[key],
  };
}

function renderIn(doc: CharacterDoc, children: ReactNode, activeCfg = CFG_MAIN, readOnly = false): string {
  const model = hydrate(doc, lookup);
  return renderToStaticMarkup(
    <EditorProvider doc={doc} model={model} onChange={noop} readOnly={readOnly} activeCfg={activeCfg} onActiveCfg={noop}>
      {children}
    </EditorProvider>,
  );
}

/** Воїн із ПЗ-сетом, у якому та сама зброя, що й у Головному (спільне посилання). */
function sharedWeaponDoc(): { doc: CharacterDoc; setId: string; iid: string } {
  const base = docFrom('typical-by');
  const created = createSet(base, 'pz');
  const setId = created.setId!;
  const iid = created.doc.main.ta!;
  return { doc: equip(created.doc, setId, 'ta', iid), setId, iid };
}

beforeAll(async () => {
  loadRef();
  // Каталог у застосунку вантажиться fetch-ем за URL Vite; тут той самий файл — з диска.
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop()!.replace(/[?#].*$/, '').replace(/\.json$/, '');
    return { ok: true, status: 200, json: async () => readJson(name) };
  });
  await ensureCats(['ta', 'ob', 'wdf', 'crystal']);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('ItemTip — рядки моделі текстовими вузлами', () => {
  for (const name of ['typical-by', 'edge-engrave', 'edge-wdf-crystal', 'edge-set-3-of-5', 'edge-set-req-unmet']) {
    it(name, () => {
      const build = calcState(name);
      computeStats(build);
      let checked = 0;
      for (const def of SLOTS) {
        const it = build.equipped[def.slot];
        if (!it) continue;
        const model = buildTipModel(it, def.cat, slotTipCtx(build, def.slot), build);
        const html = renderToStaticMarkup(<ItemTip model={model} />);
        const want = [model.name, ...(model.refine ? [' +' + model.refine] : []), ...model.lines.map((l) => l.text)]
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        expect(texts(html), name + '/' + def.slot).toEqual(want);
        // Кожен непорожній рядок — окремий елемент свого виду; розділювач — порожній елемент.
        const kinds = model.lines.filter((l) => l.kind !== 'sep').length;
        expect(html.match(/class="doll-tip-(?!name|item|refn|sep)[a-z]+/g)?.length ?? 0).toBe(kinds);
        expect((html.match(/doll-tip-sep/g) || []).length).toBe(model.lines.filter((l) => l.kind === 'sep').length);
        checked++;
      }
      expect(checked).toBeGreaterThan(0);
    });
  }

  it('невиконана вимога — клас bad, активна деталь сету — on', () => {
    const model: TipModel = {
      name: 'Тест', grade: 3, stars: 0, refine: 5,
      lines: [
        { kind: 'req', text: 'Сила 999', ok: false },
        { kind: 'req', text: 'Рівень 1', ok: true },
        { kind: 'setp', text: 'Шолом', on: true },
        { kind: 'setb', text: '2: HP +100', on: false },
        { kind: 'sep', text: '' },
      ],
    };
    const html = renderToStaticMarkup(<ItemTip model={model} />);
    expect(html).toContain('class="doll-tip-req bad"');
    expect(html).toContain('class="doll-tip-req"');
    expect(html).toContain('class="doll-tip-setp on"');
    expect(html).toContain('class="doll-tip-setb"');
    expect(html).toContain('gx-3');
    expect(html).toContain('doll-tip-refn');
  });

  it('назва з даних не стає HTML (екранується як текст)', () => {
    const evil = LT + 'img src=x onerror=alert(1)' + GT;
    const base = (readJson<Item[]>('ta'))[0];
    const item: Item = { ...base, name: evil };
    const tipHtml = renderToStaticMarkup(<ItemTip model={buildTipModel(item, 'ta', {}, null)} />);
    const nameHtml = renderToStaticMarkup(<ItemName item={item} cat="ta" />);
    for (const html of [tipHtml, nameHtml]) {
      expect(html).not.toContain(LT + 'img');
      expect(html).toContain('&lt;img');
      expect(visible(html)).toContain(evil);
    }
  });

  it('BuffTip — назва й рядки бафа', () => {
    const b = getBuffs()!['1'][0];
    const model = buildBuffTipModel(calcState('typical-by'), b);
    const html = renderToStaticMarkup(<BuffTip model={model} />);
    expect(texts(html)).toEqual([model.name, ...model.lines].map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean));
  });

  it('TipHost без тултіпа нічого не малює', () => {
    expect(renderToStaticMarkup(<TipHost />)).toBe('');
  });
});

describe('пікер', () => {
  it('гнізда: камінь у потрібне гніздо, довжина = гнізда категорії', () => {
    expect(withSocket(undefined, 1, 77, 'ta')).toEqual([0, 77]);
    expect(withSocket([5], 3, 9, 'ft')).toEqual([5, 0, 0, 9]);
    expect(withSocket([5, 6], 0, 0, 'ta')).toEqual([0, 6]);
    expect(withSocket([5], 7, 9, 'ft')).toEqual([5, 0, 0, 0]);
  });

  it('правка без змін не рахується правкою (не плодить копію спільної речі)', () => {
    const src = { i: 'a', cat: 'ta' as const, id: 1, r: 3, g: [5, 0], x: [{ t: 'sx', v: 20 }] };
    expect(isNoopPatch(src, { r: 3 })).toBe(true);
    expect(isNoopPatch(src, { g: [5, 0] })).toBe(true);
    expect(isNoopPatch(src, { g: [5] })).toBe(true); // хвостові порожні гнізда — те саме
    expect(isNoopPatch(src, { x: [{ t: 'sx', v: 20 }] })).toBe(true);
    expect(isNoopPatch(src, { r: 4 })).toBe(false);
    expect(isNoopPatch(src, { g: [5, 7] })).toBe(false);
    expect(isNoopPatch(src, { x: [{ t: 'sx', v: 21 }] })).toBe(false);
    // з вкладки сету така «правка» не робить копію: документ той самий
    const { doc, setId, iid } = sharedWeaponDoc();
    const inst = doc.items.find((i) => i.i === iid)!;
    expect(isNoopPatch(inst, { r: inst.r || 0 })).toBe(true);
    expect(updateInstance(doc, setId, iid, { r: (inst.r || 0) + 1 }).iid).not.toBe(iid);
  });

  it('ключові стати: для каменя — лише доп у цю річ', () => {
    const gem = catItems('ob')!.find((g) => Array.isArray(g.obDops) && (g.obDops as unknown[]).length > 1)!;
    const weapon = keyStats(gem, 'ob', true);
    const armor = keyStats(gem, 'ob', false);
    expect(weapon).not.toBe('');
    expect(armor).not.toBe('');
    expect(weapon.includes(' · ')).toBe(false);
    const sword = readJson<Item[]>('ta').find((t) => Array.isArray(t.ld))!;
    expect(keyStats(sword, 'ta')).toMatch(/^Фіз\. /);
  });

  it('слот: «З інвентаря», лічильник і кнопка зняти', () => {
    const base = docFrom('typical-by');
    const doc = duplicateInstance(base, base.main.ta!).doc; // копія зброї лежить в інвентарі
    const html = renderIn(doc, <PickerModal target={{ cfgId: CFG_MAIN, slot: 'ta' }} />);
    const text = visible(html);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(text).toContain('З інвентаря · 1');
    expect(text).toMatch(/Знайдено: \d/);
    expect(text).toContain('Зняти в інвентар');
    expect(html).toContain('doll-pick-row');
    // «лише те, що вдягається» увімкнено за замовчуванням
    expect(html).toMatch(/type="checkbox" checked=""/);
  });

  it('каталог не завантажено — стан завантаження, а не порожній список', () => {
    const doc = docFrom('typical-by');
    const html = renderIn(doc, <PickerModal target={{ cfgId: CFG_MAIN, slot: 'rv' }} />);
    expect(visible(html)).toContain('Завантажую каталог');
  });

  it('камінь: заголовок гнізда і список каменів', () => {
    const doc = docFrom('typical-by');
    const html = renderIn(doc, <PickerModal target={{ kind: 'gem', cfgId: CFG_MAIN, iid: doc.main.ta!, socket: 1 }} />);
    const text = visible(html);
    expect(text).toContain('Камінь — гніздо 2');
    expect(text).toMatch(/Знайдено: \d/);
    expect(text).not.toContain('З інвентаря');
  });
});

describe('редактор речі', () => {
  it('вкладка сету зі спільною річчю — банер копії', () => {
    const { doc, setId, iid } = sharedWeaponDoc();
    const set = visible(renderIn(doc, <EditorModal cfgId={setId} iid={iid} />, setId));
    expect(set).toContain('Це та сама річ, що в Головному');
    expect(set).toContain('створять окрему копію');
    const main = visible(renderIn(doc, <EditorModal cfgId={CFG_MAIN} iid={iid} />));
    expect(main).not.toContain('Це та сама річ');
    expect(main).toContain('надіта й у сетах');
  });

  it('гнізда, заточка, вкладки й дії', () => {
    const doc = docFrom('typical-by');
    const html = renderIn(doc, <EditorModal cfgId={CFG_MAIN} iid={doc.main.ta!} />);
    const text = visible(html);
    expect(text).toContain('Заточка');
    expect(text).toContain('Камені');
    expect(text).toContain('Характеристики');
    expect(text).toContain('Гравіювання');
    expect(text).toContain('Шліфовка');
    expect(text).toContain('Кристал');
    expect(text).toContain('Зняти в інвентар');
    expect((html.match(/doll-ed-socket-row/g) || []).length).toBe(2);
  });

  it('лише перегляд — без кнопок змін', () => {
    const doc = docFrom('typical-by');
    const text = visible(renderIn(doc, <EditorModal cfgId={CFG_MAIN} iid={doc.main.ta!} />, CFG_MAIN, true));
    expect(text).not.toContain('Зняти в інвентар');
    expect(text).not.toContain('Видалити');
    expect(text).toContain('Закрити');
  });

  it('річ, якої вже нема, — коротке повідомлення', () => {
    const doc = docFrom('typical-by');
    expect(visible(renderIn(doc, <EditorModal cfgId={CFG_MAIN} iid="zzzz" />))).toContain('Цієї речі вже немає');
  });

  it('«Замінити базу» і назад без втрат', () => {
    const doc = docFrom('typical-by');
    const inst = doc.items.find((i) => i.i === doc.main.ta)!;
    const item = lookup('ta', inst.id)!;
    const withX = { ...inst, x: [{ t: 'sx', v: 20 }] };
    const rep = replaceBasePatch(item, withX);
    expect(rep.xr).toBe(true);
    expect(rep.x).toEqual([...flattenItemStats(item).map((r) => ({ t: r.type, v: r.val })), { t: 'sx', v: 20 }]);
    const back = restoreBasePatch(item, { ...inst, xr: true, x: rep.x });
    expect(back).toEqual({ patch: { xr: false, x: [{ t: 'sx', v: 20 }] }, lossy: false });
    // базу змінили вручну — повернення скидає ручні рядки
    const edited = rep.x!.map((r, i) => (i === 0 ? { ...r, v: r.v + 1 } : r));
    expect(restoreBasePatch(item, { ...inst, xr: true, x: edited })).toEqual({ patch: { xr: false, x: [] }, lossy: true });
  });

  it('список характеристик — коди без дублів, спершу коди Хелпера', () => {
    const codes = STAT_OPTIONS.map((o) => o.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes[0]).toBe('ld_min');
    expect(codes).toContain('ae_eg');
    expect(codes).not.toContain('mana');
  });
});

describe('стани і суперник', () => {
  it('крок рівня бафа як у Хелпері (зі стороною −1 знімає сторону)', () => {
    const b = Object.values(getBuffs()!).flat().find((x) => {
      const d = getBuffById(x.id);
      return !!d && buffHasSides(d) && buffMaxLevel(d) >= 4;
    })!;
    let doc = docFrom('typical-by');
    doc = stepBuffLvl(doc, b, '1');
    expect(doc.buffs!.cfg[String(b.id)].lvl).toBe(1);
    doc = stepBuffLvl(doc, b, '+1');
    expect(doc.buffs!.cfg[String(b.id)].lvl).toBe(2);
    doc = setBuffSide(doc, b.id, 'rs');
    const row = doc.buffs!.cfg[String(b.id)];
    const max = effectiveBuffLvl(b, row);
    expect(stepBuffLvl(doc, b, '+1')).toBe(doc);
    const down = stepBuffLvl(doc, b, '-1').buffs!.cfg[String(b.id)];
    expect(down.side).toBe('');
    expect(down.lvl).toBe(max - 1);
  });

  it('вікно бафа й пошук станів рендеряться', () => {
    const doc = docFrom('typical-by');
    const b = getBuffs()!['1'][0];
    const cfg = visible(renderIn(doc, <BuffCfgModal id={b.id} />));
    expect(cfg).toContain('у скор не входить');
    const pick = renderIn(doc, <BuffPickModal />);
    expect(visible(pick)).toContain('Бафи');
    expect(visible(pick)).toContain('Дебафи');
    expect((pick.match(/doll-bpick-row/g) || []).length).toBeGreaterThan(0);
    // лише 10 класів сервера
    expect(PICK_CLASSES).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const onlyCommon = buffPickRows(getBuffs(), new Set(), '');
    expect(onlyCommon.every((r) => r.sm === 0)).toBe(true);
  });

  it('суперник: числа з розрядами розбираються назад', () => {
    expect(parseOppNum((23977103).toLocaleString('uk'))).toBe(23977103);
    expect(parseOppNum('1,5')).toBe(1.5);
    expect(parseOppNum('абв')).toBe(0);
    const text = visible(renderIn(docFrom('typical-by'), <OpponentModal />));
    expect(text).toContain('Скинути до');
    expect(text).toContain('Земля');
  });
});
