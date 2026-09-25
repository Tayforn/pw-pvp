// =========================================================
// ЛЯЛЬКА — каталог речей: 19 категорій JSON, які лежать у репо і проходять
// через конвеєр Vite (import.meta.glob ?url → /assets/index-КАТ-ХЕШ.json,
// тобто під immutable-кеш Caddy). Вантажимо лениво, по категоріях, і тримаємо
// маленький стор для React (useCatalog) — за зразком src/data/catalogStore.ts.
//
// Чому ?url, а не import JSON як модуль: 2,3 МБ каталогу потрапили б у чанк
// сторінки; ?url лишає їх окремими файлами, які браузер тягне лише коли треба.
// =========================================================

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { Item } from '../core/types';
import { errorMessage } from '../../app/errorMessage';

/** Білий список категорій: 17 слотів ляльки (кільця cr/cd → oq) + камені ob,
 * руни шліфовки wdf, кристали crystal. Що не звідси — каталог ігнорує
 * (ensureCats пропускає, getItem віддає undefined): категорія приходить із
 * документа персонажа, тобто від гравця, і не має ставати шляхом до файла. */
export const CATS = [
  'ft', 'vx', 'rv', 'st', 'tg', 'rx', 'wy', 'mj', 'oq', 'ta', 'it', 'qn', 'pp', 'pk', 'gv', 'ic',
  'ob', 'wdf', 'crystal',
] as const;
export type CatName = (typeof CATS)[number];
const CAT_SET: ReadonlySet<string> = new Set<string>(CATS);
export function isCat(cat: string): cat is CatName {
  return CAT_SET.has(cat);
}

export type CatState = 'idle' | 'loading' | 'ready' | 'error';

// URL-и всіх 26 JSON (каталоги + довідники): Vite підставляє хешовані шляхи,
// а eager гарантує, що кожен файл потрапить у білд.
const JSON_URL = import.meta.glob('./json/*.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** URL файла даних за іменем без розширення ('ft', 'sets', 'buff-defaults'); undefined = такого файла нема. */
export function jsonUrl(name: string): string | undefined {
  return JSON_URL['./json/' + name + '.json'];
}

/**
 * Текст помилки, коли хешованого файла даних уже нема на сервері. Імена файлів
 * міняються з кожним деплоєм, а старі реліз не тримає (Caddy чесно віддає 404),
 * тож відкрита до деплою вкладка просить файли, яких більше не буде: «Повторити»
 * тут не допоможе, допоможе лише перезавантаження сторінки.
 */
export const STALE_DATA_ERROR = 'сайт оновився — дані ляльки треба завантажити заново';
export function isStaleDataError(msg: string | null | undefined): boolean {
  return msg === STALE_DATA_ERROR;
}

/** Завантажити файл даних. Спільне для каталогу й довідників (refLoader). */
export async function fetchJsonFile<T = unknown>(name: string): Promise<T> {
  const url = jsonUrl(name);
  if (!url) throw new Error('немає файла даних «' + name + '»');
  const res = await fetch(url);
  if (res.status === 404) throw new Error(STALE_DATA_ERROR);
  if (!res.ok) throw new Error('не вдалося завантажити «' + name + '»: HTTP ' + res.status);
  return (await res.json()) as T;
}

interface CatEntry {
  state: CatState;
  error: string | null;
  items: Item[] | null;
  byId: Map<number, Item>;
  promise: Promise<void> | null;
}
const entries = new Map<string, CatEntry>();
function entry(cat: string): CatEntry {
  let e = entries.get(cat);
  if (!e) {
    e = { state: 'idle', error: null, items: null, byId: new Map(), promise: null };
    entries.set(cat, e);
  }
  return e;
}

const listeners = new Set<() => void>();
let revision = 0;
const notify = () => {
  revision++;
  listeners.forEach((l) => l());
};
const getRevision = () => revision;

/** Підписка на будь-яку зміну стану категорій (для useSyncExternalStore). */
export function subscribeCatalog(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function catState(cat: string): CatState {
  return entries.get(cat)?.state ?? 'idle';
}
/** Текст помилки останнього завантаження категорії (null, якщо її не було). */
export function catError(cat: string): string | null {
  return entries.get(cat)?.error ?? null;
}

/** Річ за категорією та id; undefined = категорія ще не готова або такого id нема. */
export function getItem(cat: string, id: number): Item | undefined {
  return entries.get(cat)?.byId.get(id);
}
/** Усі речі категорії; null, поки не завантажено. */
export function catItems(cat: string): Item[] | null {
  return entries.get(cat)?.items ?? null;
}

function loadCat(cat: CatName): Promise<void> {
  const e = entry(cat);
  if (e.state === 'ready') return Promise.resolve();
  if (e.promise) return e.promise;
  e.state = 'loading';
  e.error = null;
  notify();
  e.promise = (async () => {
    try {
      const data = await fetchJsonFile<unknown>(cat);
      if (!Array.isArray(data)) throw new Error('каталог «' + cat + '»: очікував масив речей');
      const items = data as Item[];
      const byId = new Map<number, Item>();
      for (const it of items) byId.set(Number(it.id), it);
      e.items = items;
      e.byId = byId;
      e.state = 'ready';
    } catch (err) {
      e.state = 'error';
      e.error = errorMessage(err, 'не вдалося завантажити каталог «' + cat + '»');
      throw err;
    } finally {
      e.promise = null;
      notify();
    }
  })();
  return e.promise;
}

/** Лише категорії з білого списку, без повторів, у порядку першої появи. */
function wanted(cats: readonly string[]): CatName[] {
  const out: CatName[] = [];
  for (const c of cats) if (isCat(c) && !out.includes(c)) out.push(c);
  return out;
}

/** Довантажити категорії (ідемпотентно; готові пропускаються, паралельні
 * виклики ділять один запит). Відхиляється, якщо хоч одна не завантажилась —
 * решта все одно догружаються, а стан помилки лишається в сторі до retry. */
export async function ensureCats(cats: string[]): Promise<void> {
  const results = await Promise.allSettled(wanted(cats).map(loadCat));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}

/** Повторити після помилки: «error» → «idle» і завантажити знову. */
export function retryCats(cats: string[]): Promise<void> {
  for (const c of wanted(cats)) {
    const e = entry(c);
    if (e.state === 'error') {
      e.state = 'idle';
      e.error = null;
    }
  }
  return ensureCats(cats);
}

/** React-хук: запускає завантаження потрібних категорій і перемальовує
 * компонент, коли стан змінився. ready = усі (з білого списку) готові;
 * error = перша помилка серед них. Порожній список — одразу ready. */
export function useCatalog(cats: string[]): { ready: boolean; error: string | null; retry(): void } {
  // Ключ, а не масив, у залежностях: новий масив на кожен рендер не має перезапускати ефект.
  const key = wanted(cats).sort().join(',');
  useSyncExternalStore(subscribeCatalog, getRevision, getRevision);
  useEffect(() => {
    void ensureCats(key ? key.split(',') : []).catch(() => {
      /* стан error уже в сторі — його покаже UI */
    });
  }, [key]);
  const retry = useCallback(() => {
    void retryCats(key ? key.split(',') : []).catch(() => {
      /* те саме */
    });
  }, [key]);
  const list = key ? key.split(',') : [];
  let error: string | null = null;
  for (const c of list) {
    const err = catError(c);
    if (err) {
      error = err;
      break;
    }
  }
  return { ready: list.every((c) => catState(c) === 'ready'), error, retry };
}
