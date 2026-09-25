// =========================================================
// ЛЯЛЬКА — стан тултіпа. Один тултіп на сторінку (як сінглтон Хелпера
// utils/tooltip.ts), але без innerHTML: тут лише «що показати і біля чого»,
// а малює TipHost React-вузлами. Стор модульний, а не контекст: тултіп
// кличуть слоти, інвентар, пікер і редактор — усім потрібна та сама пара
// show/hide без Provider-ів навколо кожного піддерева.
//
// Два режими: наведення (show/hide з mouseenter/mouseleave, фокусу) і
// закріплення (toggle з кліку/тапу — так тултіп працює на тачі, де hover
// нема, і може нести кнопки дій). Поки тултіп закріплений, наведення на
// інші елементи його не перебиває — інакше на телефоні він зникав би від
// першого ж дотику.
// =========================================================

import type { TipModel } from '../../model/tipModel';

/** Кнопка в закріпленому тултіпі (тач: «Надіти / Редагувати / Копія / Видалити»). */
export interface TipAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Дія недоступна тут (джинн у сеті); hint — чому, показується під кнопками (на тачі title не видно). */
  disabled?: boolean;
  hint?: string;
}

export type TipContent = (
  | { kind: 'item'; model: TipModel }
  | { kind: 'buff'; model: { name: string; lines: string[] } }
  | { kind: 'text'; text: string }
) & { actions?: TipAction[] };

export interface TipState {
  anchor: HTMLElement | null;
  content: TipContent | null;
  pinned: boolean;
}

const EMPTY: TipState = { anchor: null, content: null, pinned: false };
let state: TipState = EMPTY;
const listeners = new Set<() => void>();

function set(next: TipState): void {
  state = next;
  listeners.forEach((l) => l());
}

export function subscribeTip(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
export function getTipState(): TipState {
  return state;
}

/** Показати з наведення. Закріплений тултіп не перебивається. */
export function tipShow(anchor: HTMLElement, content: TipContent): void {
  if (state.pinned) return;
  set({ anchor, content, pinned: false });
}
/** Сховати тултіп наведення; закріплений лишається (його закриває toggle/hideAll/Esc). */
export function tipHide(): void {
  if (state.pinned || !state.content) return;
  set(EMPTY);
}
/** Сховати будь-який тултіп, і закріплений теж (відкриття модалки, дія з тултіпа). */
export function tipHideAll(): void {
  if (!state.content) return;
  set(EMPTY);
}
/** Закріпити з кліку/тапу; повторний клік по тому самому якорю — закрити. */
export function tipToggle(anchor: HTMLElement, content: TipContent): void {
  if (state.pinned && state.anchor === anchor) {
    set(EMPTY);
    return;
  }
  set({ anchor, content, pinned: true });
}

export interface TipApi {
  show(anchor: HTMLElement, content: TipContent): void;
  hide(): void;
  toggle(anchor: HTMLElement, content: TipContent): void;
  hideAll(): void;
}

// Один незмінний обʼєкт: його можна класти в залежності ефектів без перезапусків.
const API: TipApi = { show: tipShow, hide: tipHide, toggle: tipToggle, hideAll: tipHideAll };

export function useTip(): TipApi {
  return API;
}

/** Тач-екран без hover: тултіп лише закріпленням, дії — кнопками в ньому. */
export function isCoarsePointer(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}
