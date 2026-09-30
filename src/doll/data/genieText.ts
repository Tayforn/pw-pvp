// =========================================================
// ЛЯЛЬКА — тексти вмінь джина (описи для вікна джина). Один JSON на 91
// вміння, ~110 КБ; вантажиться ліниво через ?url + fetch, лише коли відкрили
// вікно джина. Картка джина й попап гравця обходяться таблицею
// (src/data/genie.ts: назви, іконки, правила) і цей файл не тягнуть.
//
// Файл лежить у genie/, а не в json/: тека json — це каталог 1:1 з Хелпера
// під хешем DOLL_DATA_VER. Генерує його scripts/genie-data.ts; HTML Хелпера
// там уже розібрано на сегменти, тож рендер — звичайні React-вузли.
// =========================================================

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { errorMessage } from '../../app/errorMessage';
import { fetchJsonUrl } from './catalog';
import url from './genie/genie-text.json?url';

/** Тон сегмента: підпис, число, рядок «вплив сили/спритності», темна сторона, обмеження. */
export type GenieTone = 'label' | 'num' | 'genie' | 'dark' | 'warn';
/** Сегмент опису: текст, підстановка (st[f] за рівнем вміння) або розрив рядка. */
export type GenieSeg = { t: string; c?: GenieTone } | { f: string; c?: GenieTone } | { br: 1 };
export interface GenieSkillText {
  /** Кількість рівнів вміння. */
  lv: number;
  d: GenieSeg[];
  /** Значення підстановок по рівнях: ключ f → lv рядків. */
  st: Record<string, string[]>;
}

export type GenieTextState = 'idle' | 'loading' | 'ready' | 'error';
let state: GenieTextState = 'idle';
let error: string | null = null;
let promise: Promise<void> | null = null;
let texts: Record<string, GenieSkillText> = {};

const listeners = new Set<() => void>();
let revision = 0;
const notify = () => {
  revision++;
  listeners.forEach((l) => l());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
const getRevision = () => revision;

export function genieTextState(): GenieTextState {
  return state;
}

/** Опис вміння за ref; undefined — тексти ще не завантажено або такого вміння нема. */
export function genieSkillText(ref: number): GenieSkillText | undefined {
  const k = String(ref);
  return Object.prototype.hasOwnProperty.call(texts, k) ? texts[k] : undefined;
}

/** Значення підстановки для рівня вміння (0 — перший); поза межами — останній рівень. */
export function genieStat(text: GenieSkillText, f: string, level: number): string {
  const arr = text.st[f];
  if (!arr || !arr.length) return '?';
  return arr[Math.max(0, Math.min(Math.floor(level) || 0, arr.length - 1))];
}

/** Завантажити тексти (ідемпотентно; паралельні виклики ділять один запит).
 * Після помилки наступний виклик пробує знову. */
export function ensureGenieText(): Promise<void> {
  if (state === 'ready') return Promise.resolve();
  if (promise) return promise;
  state = 'loading';
  error = null;
  notify();
  promise = (async () => {
    try {
      const data = await fetchJsonUrl<unknown>(url, 'genie-text');
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('тексти джина: очікував обʼєкт ref → опис');
      texts = data as Record<string, GenieSkillText>;
      state = 'ready';
    } catch (e) {
      state = 'error';
      error = errorMessage(e, 'не вдалося завантажити тексти вмінь джина');
      throw e;
    } finally {
      promise = null;
      notify();
    }
  })();
  return promise;
}

/** React-хук: запускає завантаження текстів і перемальовує компонент, коли стан
 * змінився; retry — той самий ensureGenieText після помилки. Текст «сайт
 * оновився» розпізнає isStaleDataError (catalog.ts), як і для каталогу. */
export function useGenieText(): { ready: boolean; error: string | null; retry(): void } {
  useSyncExternalStore(subscribe, getRevision, getRevision);
  useEffect(() => {
    void ensureGenieText().catch(() => {
      /* стан error уже в сторі — його покаже UI */
    });
  }, []);
  const retry = useCallback(() => {
    void ensureGenieText().catch(() => {
      /* те саме */
    });
  }, []);
  return { ready: state === 'ready', error, retry };
}
