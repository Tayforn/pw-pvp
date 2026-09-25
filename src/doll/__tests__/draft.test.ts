// Чернетка персонажа: читання через validateDoc, відкладений запис, імпорт із Хелпера.
// Сховище — фейкове (у vitest немає localStorage), таймери — фейкові.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BROKEN_KEEP, DRAFT_DELAY_MS, brokenKey, clearDraft, createDraftSaver, draftKey, initialSaveState, loadDraft, parseHelperBuild, saveDraft,
  type DraftStorage, type SaveState,
} from '../api/draft';
import { DOC_LIMITS, emptyDoc, validateDoc, type CharacterDoc } from '../model/doc';

function memStorage(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  const s = {
    data,
    getItem: vi.fn((k: string) => (data.has(k) ? data.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => {
      data.set(k, v);
    }),
    removeItem: vi.fn((k: string) => {
      data.delete(k);
    }),
  };
  return s;
}

const throwing: DraftStorage = {
  getItem: () => {
    throw new Error('заборонено');
  },
  setItem: () => {
    throw new Error('заповнено');
  },
  removeItem: () => {
    throw new Error('заборонено');
  },
};

const KEY = draftKey();

function docWith(name: string): CharacterDoc {
  return { ...emptyDoc('ga'), name };
}

describe('ключ чернетки', () => {
  it('гість, новий персонаж', () => {
    expect(KEY).toBe('pvpCharDraft:anon:new');
    expect(draftKey('p42', 'abc')).toBe('pvpCharDraft:p42:abc');
    expect(brokenKey(KEY)).toBe('pvpCharDraft:anon:new:broken');
  });
});

describe('loadDraft', () => {
  it('немає сховища або запису — порожньо без помилки', () => {
    expect(loadDraft(KEY, null)).toEqual({ doc: null, error: null });
    expect(loadDraft(KEY, memStorage())).toEqual({ doc: null, error: null });
    expect(loadDraft(KEY, memStorage({ [KEY]: '' }))).toEqual({ doc: null, error: null });
  });

  it('сховище кидає — порожньо без помилки', () => {
    expect(loadDraft(KEY, throwing)).toEqual({ doc: null, error: null });
  });

  it('коректна чернетка читається як є', () => {
    const doc = docWith('Тайфорн');
    const st = memStorage({ [KEY]: JSON.stringify(doc) });
    const r = loadDraft(KEY, st);
    expect(r.error).toBeNull();
    expect(r.doc).toEqual(doc);
  });

  it('зламаний JSON — помилка, сирий текст відкладено в :broken', () => {
    const st = memStorage({ [KEY]: '{"v":2,"name":' });
    const r = loadDraft(KEY, st);
    expect(r.doc).toBeNull();
    expect(r.error).toBeTruthy();
    expect(st.data.get(brokenKey(KEY))).toBe('{"v":2,"name":');
  });

  it('документ, що не проходить перевірку (чужий клас), не потрапляє в редактор', () => {
    const bad = { ...emptyDoc(), cls: 'uf' };
    const st = memStorage({ [KEY]: JSON.stringify(bad) });
    const r = loadDraft(KEY, st);
    expect(r.doc).toBeNull();
    expect(r.error).toBeTruthy();
    expect(st.data.has(brokenKey(KEY))).toBe(true);
  });

  it('чернетка понад ліміти чи бюджет атрибутів відкривається з попередженням, а не губиться', () => {
    const rows = Array.from({ length: 10 }, () => ({ t: 'hp', v: 1 }));
    const over: CharacterDoc = {
      ...emptyDoc('by'),
      level: 1,
      attrs: { str: 300, dex: 5, vit: 5, mag: 5 },
      items: Array.from({ length: 41 }, (_, k) => ({ i: 'i' + k.toString(36), cat: 'ta' as const, id: 1900, x: rows })),
    };
    const st = memStorage({ [KEY]: JSON.stringify(over) });
    const r = loadDraft(KEY, st);
    expect(r.doc).toEqual(over);
    expect(r.error).toBeNull();
    expect(r.warning).toMatch(new RegExp('рядків ролів більше за ліміт ' + DOC_LIMITS.rollRows));
    expect(r.warning).toMatch(/атрибутів роздано/);
    expect(st.data.has(brokenKey(KEY))).toBe(false);
    expect(validateDoc(over).ok).toBe(false); // зберегти в профіль таке не вийде
  });

  it('зламані копії не затирають одна одну: три останні, той самий текст удруге не дублюється', () => {
    const st = memStorage();
    const put = (raw: string) => {
      st.data.set(KEY, raw);
      loadDraft(KEY, st);
    };
    put('{"a":');
    put('{"a":'); // перезавантажили сторінку, нічого не змінивши
    expect(st.data.get(brokenKey(KEY))).toBe('{"a":');
    expect(st.data.has(brokenKey(KEY) + ':2')).toBe(false);
    put('{"b":');
    put('{"c":');
    put('{"d":');
    expect(BROKEN_KEEP).toBe(3);
    expect(st.data.get(brokenKey(KEY))).toBe('{"d":');
    expect(st.data.get(brokenKey(KEY) + ':2')).toBe('{"c":');
    expect(st.data.get(brokenKey(KEY) + ':3')).toBe('{"b":');
    expect(st.data.has(brokenKey(KEY) + ':4')).toBe(false);
  });
});

describe('saveDraft / clearDraft', () => {
  it('пише компактний JSON і читається назад', () => {
    const st = memStorage();
    const doc = docWith('A');
    expect(saveDraft(KEY, doc, st)).toBe(true);
    expect(JSON.parse(st.data.get(KEY)!)).toEqual(doc);
    expect(loadDraft(KEY, st).doc).toEqual(doc);
    clearDraft(KEY, st);
    expect(st.data.has(KEY)).toBe(false);
  });

  it('сховище недоступне або переповнене — false, без винятку', () => {
    expect(saveDraft(KEY, docWith('A'), null)).toBe(false);
    expect(saveDraft(KEY, docWith('A'), throwing)).toBe(false);
    expect(() => clearDraft(KEY, throwing)).not.toThrow();
  });
});

describe('відкладений запис', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('серія змін за 500 мс — один запис останньої версії', () => {
    const st = memStorage();
    const states: SaveState[] = [];
    const saver = createDraftSaver(KEY, { storage: st, onState: (s) => states.push(s) });
    saver.schedule(docWith('a'));
    vi.advanceTimersByTime(200);
    saver.schedule(docWith('ab'));
    vi.advanceTimersByTime(200);
    saver.schedule(docWith('abc'));
    expect(st.setItem).not.toHaveBeenCalled();
    expect(saver.isPending()).toBe(true);
    vi.advanceTimersByTime(DRAFT_DELAY_MS - 1);
    expect(st.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(st.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(st.data.get(KEY)!).name).toBe('abc');
    expect(states[states.length - 1]).toBe('saved');
    expect(states.filter((s) => s === 'pending').length).toBe(3);
    expect(saver.isPending()).toBe(false);
  });

  it('flush пише одразу (закриття сторінки), повторний flush нічого не робить', () => {
    const st = memStorage();
    const saver = createDraftSaver(KEY, { storage: st });
    saver.schedule(docWith('x'));
    saver.flush();
    expect(st.setItem).toHaveBeenCalledTimes(1);
    saver.flush();
    vi.advanceTimersByTime(DRAFT_DELAY_MS * 2);
    expect(st.setItem).toHaveBeenCalledTimes(1);
  });

  it('cancel скасовує відкладений запис (скидання чернетки)', () => {
    const st = memStorage();
    const saver = createDraftSaver(KEY, { storage: st });
    saver.schedule(docWith('old'));
    saver.cancel();
    vi.advanceTimersByTime(DRAFT_DELAY_MS * 2);
    expect(st.setItem).not.toHaveBeenCalled();
  });

  it('pause: інша вкладка змінила чернетку — нічого не пишемо (і на закритті теж), resume пише останню версію', () => {
    const st = memStorage();
    const states: SaveState[] = [];
    const saver = createDraftSaver(KEY, { storage: st, onState: (s) => states.push(s) });
    saver.schedule(docWith('a'));
    saver.pause();
    expect(saver.isPaused()).toBe(true);
    vi.advanceTimersByTime(DRAFT_DELAY_MS * 2);
    saver.schedule(docWith('ab'));
    saver.flush(); // pagehide
    vi.advanceTimersByTime(DRAFT_DELAY_MS * 2);
    expect(st.setItem).not.toHaveBeenCalled();
    expect(states[states.length - 1]).toBe('held');
    saver.resume();
    expect(st.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(st.data.get(KEY)!).name).toBe('ab');
    expect(states[states.length - 1]).toBe('saved');
  });

  it('помилка запису — стан failed', () => {
    const states: SaveState[] = [];
    const saver = createDraftSaver(KEY, { storage: throwing, onState: (s) => states.push(s) });
    saver.schedule(docWith('x'));
    vi.advanceTimersByTime(DRAFT_DELAY_MS);
    expect(states).toEqual(['pending', 'failed']);
  });
});

describe('стан індикатора до першого запису', () => {
  it('сховища нема — off; чернетку прочитано — saved; ще нічого не писали — idle', () => {
    expect(initialSaveState(null, false)).toBe('off');
    expect(initialSaveState(memStorage(), true)).toBe('saved');
    expect(initialSaveState(memStorage(), false)).toBe('idle');
  });
});

describe('імпорт із Хелпера', () => {
  const calcState = { cls: 'ga', gender: 'f', level: 101, str: 5, dex: 5, vit: 5, mag: 400, equipped: {}, titles: { hp: 120 } };

  it('поточний білд (pwDollBuild) → документ', () => {
    const doc = parseHelperBuild(JSON.stringify(calcState));
    expect(doc.cls).toBe('ga');
    expect(doc.gender).toBe('f');
    expect(doc.level).toBe(101);
    expect(doc.attrs.mag).toBe(400);
    expect(doc.titles).toEqual({ hp: 120 });
    expect(doc.items).toEqual([]);
    expect(doc.sets).toEqual([]);
  });

  it('запис зі «Збережених білдів» ({name, ts, state}) теж приймається', () => {
    const doc = parseHelperBuild('  ' + JSON.stringify({ name: 'ПЗ', ts: 1, state: calcState }) + '\n');
    expect(doc.cls).toBe('ga');
  });

  it('незрозумілий текст — зрозуміла помилка', () => {
    expect(() => parseHelperBuild('')).toThrow(/Встав/);
    expect(() => parseHelperBuild('pwDollBuild')).toThrow(/JSON/);
    expect(() => parseHelperBuild('[1,2]')).toThrow(/не схоже/);
    expect(() => parseHelperBuild('{"cls":"ga"}')).toThrow(/спорядження/);
  });

  it('клас, якого немає на сервері гільдії, — помилка', () => {
    expect(() => parseHelperBuild(JSON.stringify({ ...calcState, cls: 'uf' }))).toThrow(/Не вдалося перенести/);
  });
});
