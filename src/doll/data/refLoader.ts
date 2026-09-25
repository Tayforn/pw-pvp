// =========================================================
// ЛЯЛЬКА — довідники для ядра: комплекти (sets), бафи/дебафи, набір бафів за
// замовчуванням, уміння, тексти станів (fustate) і словники підписів (labels).
// Сім JSON вантажаться разом один раз і віддаються ядру через setRefData —
// далі stats/buffs/damage читають їх синхронно геттерами, як у calc.
// =========================================================

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { setRefData, type RefData } from '../core/refdata';
import { errorMessage } from '../../app/errorMessage';
import { fetchJsonFile } from './catalog';

export type RefDataState = 'idle' | 'loading' | 'ready' | 'error';
let state: RefDataState = 'idle';
let error: string | null = null;
let promise: Promise<void> | null = null;

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

export function refDataState(): RefDataState {
  return state;
}

/** Завантажити довідники й передати ядру (ідемпотентно; паралельні виклики
 * ділять один запит). Після помилки наступний виклик пробує знову. */
export function ensureRefData(): Promise<void> {
  if (state === 'ready') return Promise.resolve();
  if (promise) return promise;
  state = 'loading';
  error = null;
  notify();
  promise = (async () => {
    try {
      const [sets, buffs, debuffs, buffDefaults, skills, fuState, labels] = await Promise.all([
        fetchJsonFile<RefData['sets']>('sets'),
        fetchJsonFile<RefData['buffs']>('buffs'),
        fetchJsonFile<RefData['debuffs']>('debuffs'),
        fetchJsonFile<RefData['buffDefaults']>('buff-defaults'),
        fetchJsonFile<RefData['skills']>('skills'),
        fetchJsonFile<RefData['fuState']>('fustate'),
        fetchJsonFile<RefData['labels']>('labels'),
      ]);
      setRefData({ sets, buffs, debuffs, buffDefaults, skills, fuState, labels });
      state = 'ready';
    } catch (e) {
      state = 'error';
      error = errorMessage(e, 'не вдалося завантажити довідники ляльки');
      throw e;
    } finally {
      promise = null;
      notify();
    }
  })();
  return promise;
}

/** React-хук: запускає завантаження довідників і перемальовує компонент, коли
 * стан змінився; retry — той самий ensureRefData після помилки. */
export function useRefData(): { ready: boolean; error: string | null; retry(): void } {
  useSyncExternalStore(subscribe, getRevision, getRevision);
  useEffect(() => {
    void ensureRefData().catch(() => {
      /* стан error уже в сторі — його покаже UI */
    });
  }, []);
  const retry = useCallback(() => {
    void ensureRefData().catch(() => {
      /* те саме */
    });
  }, []);
  return { ready: state === 'ready', error, retry };
}
