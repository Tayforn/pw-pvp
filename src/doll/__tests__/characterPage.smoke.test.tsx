// =========================================================
// ЛЯЛЬКА — димовий тест сторінки цілком: CharacterPage → чернетка →
// DollEditor → контекст → фігура, інвентар, панелі, тултіп-хост. Рендер через
// renderToStaticMarkup (jsdom у проєкті нема), тож ефекти не виконуються —
// каталог і довідники вантажимо заздалегідь тим самим кодом застосунку
// (ensureRefData/ensureCats), лише fetch віддає JSON з диска.
//
// Ловить те, що не бачать тести окремих частин: зламаний стик між агентами
// (провайдер ↔ панелі ↔ модалки), виняток під час першого рендеру на
// реальному документі, чернетку, що не доходить до редактора.
// =========================================================

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readJson } from '../core/__tests__/testData';
import { ensureCats } from '../data/catalog';
import { ensureRefData } from '../data/refLoader';
import { draftKey, brokenKey } from '../api/draft';
import { DOC_LIMITS, emptyDoc, type CharacterDoc } from '../model/doc';
import { CFG_MAIN, docCats } from '../model/hydrate';
import { createSet, equip, fillEmptyFromMain } from '../model/ops';
import { docFrom } from '../model/__tests__/testDoc';
import CharacterPage from '../../pages/CharacterPage';

const KEY = draftKey('anon', 'new');
const CLASSES = ['by', 'ga', 'ya', 'rl', 'ij', 'js', 'fx', 'sj', 'ej', 'rg'] as const;
const CASTERS = new Set(['ga', 'rl', 'ij', 'sj', 'rg']);

/** Сховище в памʼяті замість localStorage браузера. */
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}
let store = memoryStorage();

function setLocation(search = ''): void {
  vi.stubGlobal('location', { pathname: '/characters/new', search, hash: '', href: 'http://localhost/characters/new' + search });
}

/** Рендер сторінки з документом у чернетці (null — чернетки нема). */
async function renderPage(doc: CharacterDoc | null, search = ''): Promise<string> {
  store.clear();
  if (doc) store.setItem(KEY, JSON.stringify(doc));
  setLocation(search);
  // Застосунок робить це в ефектах DollEditor (useRefData/useCatalog); тут — наперед.
  await ensureRefData();
  await ensureCats(docCats(doc ?? emptyDoc()));
  return renderToStaticMarkup(<CharacterPage id="new" />);
}

const count = (html: string, re: RegExp): number => (html.match(re) || []).length;
const LT = String.fromCharCode(60);
const GT = String.fromCharCode(62);
/** Видимий текст розмітки: теги прибрано, пробіли стиснуто. */
const visible = (html: string): string =>
  html.replace(new RegExp(LT + '[^' + GT + ']*' + GT, 'g'), ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
/** Значення hero-комірки за підписом (ПА, ПЗ, Здоровʼя…). */
function heroValue(html: string, label: string): string | null {
  const m = new RegExp('doll-hero-l"' + GT + label + LT + '/span' + GT + LT + 'b class="doll-hero-v"' + GT + '([^' + LT + ']*)').exec(html);
  return m ? m[1] : null;
}

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop()!.replace(/[?#].*$/, '').replace(/\.json$/, '');
    return { ok: true, status: 200, json: async () => readJson(name) };
  });
});
beforeEach(() => {
  store = memoryStorage();
  vi.stubGlobal('localStorage', store);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

/** Спільне для будь-якого відрендереного редактора. */
function expectEditor(html: string): void {
  expect(html).not.toContain('Завантажую каталог речей');
  expect(html).not.toContain('Не вдалося завантажити');
  // фігура: силует SVG і сітка слотів
  expect(html).toContain('class="doll-fig-svg"');
  expect(count(html, /data-slot="/g)).toBe(17);
  // інвентар, hero-рядок статів, бафи, урон
  expect(html).toContain('class="card doll-inv"');
  expect(html).toContain('class="doll-hero"');
  for (const label of ['Здоровʼя', 'ПА', 'ПЗ', 'Крит']) expect(heroValue(html, label), label).toMatch(/^[0-9]/);
  expect(html).toContain('у скор не входить');
  // сторінка без входу (у тестах /api/me недоступний): замість збереження — вхід, чернетка в браузері
  const text = visible(html);
  expect(text).toContain('Увійти через Discord, щоб зберегти');
  expect(text).toContain('чернетка в цьому браузері');
  expect(text).not.toMatch(/NaN|undefined|Infinity|\[object/);
}

describe('CharacterPage — перший рендер без винятків', () => {
  it('порожня чернетка: фігура без речей, інвентар порожній, стати є', async () => {
    const html = await renderPage(null);
    expectEditor(html);
    expect(visible(html)).toContain('речей 0/' + DOC_LIMITS.items);
    // жодної іконки речі (спрайт) — порожні слоти лишаються порожніми
    expect(html).not.toMatch(/-hii\.png/);
    expect(store.getItem(KEY)).toBeNull();
  });

  for (const cls of CLASSES) {
    it('golden-фікстура typical-' + cls + ': усі надіті речі з іконками спрайтів', async () => {
      const doc = docFrom('typical-' + cls);
      const html = await renderPage(doc);
      expectEditor(html);
      const worn = Object.keys(doc.main).length;
      expect(worn).toBeGreaterThan(10);
      expect(visible(html)).toContain('речей ' + doc.items.length + '/' + DOC_LIMITS.items);
      // іконки — CSS-обʼєкти зі спрайтом каталогу, по одній на надіту річ
      // (інвентар Головного порожній: усі речі фікстури надіті)
      expect(count(html, /class="doll-icon" style="background-image:url\(&quot;[^&]*-hii\.png&quot;\)/g)).toBe(worn);
      expect(count(html, /class="doll-slot is-filled/g)).toBe(worn);
      // hero-рядок: у кастерів маг. атака і спів, в інших — фіз. атака й атаки/сек
      expect(html).toContain(CASTERS.has(cls) ? 'Маг. атака' : 'Фіз. атака');
    });
  }

  it('вкладка сету з ?set=: порожній сет, підказка про Головний, дельти', async () => {
    const base = docFrom('typical-by');
    const { doc: withSet, setId } = createSet(base, 'pz');
    expect(setId).toBeTruthy();
    const doc = equip(withSet, setId!, 'ta', base.main.ta!);
    const html = await renderPage(doc, '?set=' + setId);
    expectEditor(html);
    expect(html).toContain('Порожні слоти для балів рахуються як у Головному');
    // сет не заповнено: кнопка дотиску активна і каже, скільки слотів заповнить
    expect(html).toMatch(/>Надіти решту з головного \([0-9]+\)/);
    expect(html).toContain('doll-delta');
    expect(html).toMatch(/aria-selected="true" class="doll-tab-main"[^>]*>.{0,80}ПЗ/);
    // зброя сету — та сама річ, що в Головному (одне посилання, не копія)
    expect(count(html, /data-slot="ta"/g)).toBe(1);
    expect(doc.items).toHaveLength(base.items.length);
  });

  it('невідомий ?set= — показує Головний без винятку', async () => {
    const html = await renderPage(docFrom('typical-ga'), '?set=zzzzzz');
    expectEditor(html);
    expect(html).not.toContain('Порожні слоти для балів рахуються як у Головному');
  });

  it('сет, заповнений з Головного, і максимум сетів', async () => {
    let doc = docFrom('typical-js');
    const ids: string[] = [];
    for (const kind of ['pz', 'pa', 'aspd', 'pz', 'pa'] as const) {
      const r = createSet(doc, kind);
      doc = r.doc;
      ids.push(r.setId!);
    }
    doc = fillEmptyFromMain(doc, ids[0]);
    expect(doc.sets).toHaveLength(DOC_LIMITS.sets);
    const html = await renderPage(doc, '?set=' + ids[0]);
    expectEditor(html);
    // усе, що можна, уже дотиснуто — кнопка неактивна і без лічильника
    expect(html).toMatch(/disabled=""[^>]*>Надіти решту з головного</);
  });

  it('зламана чернетка: повідомлення, сирий текст відкладено, редактор порожній', async () => {
    store.clear();
    store.setItem(KEY, '{"v":2,"cls":"zz"');
    setLocation('');
    await ensureRefData();
    await ensureCats(docCats(emptyDoc()));
    const html = renderToStaticMarkup(<CharacterPage id="new" />);
    expectEditor(html);
    expect(html).toContain('Стару чернетку не вдалося відкрити');
    expect(store.getItem(brokenKey(KEY))).toBe('{"v":2,"cls":"zz"');
  });

  it('збережений персонаж — до відповіді сервера лише «завантажую», без редактора', async () => {
    setLocation('');
    const html = renderToStaticMarkup(<CharacterPage id="abc123" />);
    expect(html).toContain('Завантажую персонажа');
    expect(html).not.toContain('doll-fig-svg');
  });

  it('список «Мої персонажі» до перевірки входу — без винятків', async () => {
    setLocation('');
    const html = renderToStaticMarkup(<CharacterPage id={null} />);
    expect(html).toContain('Мої персонажі');
    expect(html).toContain('Перевірка входу');
  });

  it('документ валідний і поміщається в ліміт розміру', () => {
    const doc = docFrom('typical-by');
    expect(JSON.stringify(doc).length).toBeLessThan(DOC_LIMITS.bytes);
    expect(doc.main).toBeTruthy();
    expect(CFG_MAIN).toBe('main');
  });
});
