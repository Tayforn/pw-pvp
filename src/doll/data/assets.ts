// =========================================================
// ЛЯЛЬКА — активи: спрайти іконок (fe/КАТ[/СТАТЬ]/КАТ-hii.png, 6 колонок
// по 32 px, індекс `an`), спрайт бафів yo.png, фон клітинок item-cells.png і
// силует фігури. Усе проходить через Vite (import.meta.glob ?url), тож URL-и
// хешовані й підпадають під immutable-кеш. Стилі — лише обʼєкти CSSProperties:
// рядки CSS/HTML у src/doll заборонені.
// =========================================================

import { createElement, type CSSProperties, type ReactElement, type SVGProps } from 'react';
import type { Item } from '../core/types';
import { isCat } from './catalog';

// 26 PNG: 24 спрайти категорій (5 гендерних × 2 + 14 звичайних) + yo.png + item-cells.png.
const PNG_URL = import.meta.glob('./sprites/**/*.png', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** Спрайт бафів і вмінь (yo.png). */
const YO_URL: string = PNG_URL['./sprites/yo.png'] ?? '';
/** Фон порожніх клітинок — плейсхолдери слотів, позиції як у mypers. */
export const ITEM_CELLS_URL: string = PNG_URL['./sprites/item-cells.png'] ?? '';

/** URL спрайта категорії. Гендерний спрайт (ft/rv/tg/rx/mj — вигляд різний для
 * ч/ж, індекс `an` той самий) визначаємо за наявністю файла m/ або f/, а не
 * окремим списком: сама тека спрайтів — джерело істини. Категорія поза білим
 * списком → '' (ніякого шляху, складеного з даних гравця). */
export function spriteUrl(cat: string, gender: 'm' | 'f'): string {
  if (!isCat(cat)) return '';
  return (
    PNG_URL['./sprites/fe/' + cat + '/' + gender + '/' + cat + '-hii.png'] ??
    PNG_URL['./sprites/fe/' + cat + '/' + cat + '-hii.png'] ??
    ''
  );
}

const CELL = 32; // крок спрайта, px
const COLS = 6; // колонок у спрайті

/** Позиція іконки з індексом `an` у спрайті 6×N — той самий рядок, що й у calc. */
function spritePos(an: number): string {
  const col = an % COLS;
  const row = Math.floor(an / COLS);
  return '-' + col * CELL + 'px -' + row * CELL + 'px';
}

/** Стиль іконки речі — порт calc data.ts iconStyle, але як обʼєкт для style={}.
 * Невідома категорія → порожній стиль (клітинка лишається без картинки). */
export function iconStyle(item: Item, cat: string, gender: 'm' | 'f'): CSSProperties {
  const url = spriteUrl(cat, gender);
  if (!url) return {};
  const an = Number(item.an) | 0;
  return { backgroundImage: 'url("' + url + '")', backgroundPosition: spritePos(an) };
}

/** Стиль іконки бафа зі спрайта yo.png (порт calc buffIconStyle). */
export function buffIconStyle(an: number): CSSProperties {
  return { backgroundImage: 'url("' + YO_URL + '")', backgroundPosition: spritePos(Number(an) | 0) };
}

// Контур силуету — той, що реально малює лялька Хелпера (styles.css, .doll-fig::before);
// файл figure.svg у calc — старіший, грубіший варіант, який ніде не підключений.
const FIGURE_PATH =
  'M50 39 C44 39 41 42 40 47 C35 48 29 50 25 55 C21 60 20 66 19 74 L15 105 C14 110 16 114 20 114 ' +
  'C24 114 26 110 27 105 L31 78 C32 88 32 97 32 105 L29 152 C28 170 32 185 37 185 L40 247 ' +
  'C40 250 47 250 47 247 L49 189 L51 189 L53 247 C53 250 60 250 60 247 L63 185 C68 185 72 170 71 152 ' +
  'L68 105 C68 97 68 88 69 78 L73 105 C74 110 76 114 80 114 C84 114 86 110 85 105 L81 74 ' +
  'C80 66 79 60 75 55 C71 50 65 48 60 47 C59 42 56 39 50 39 Z';

/** Силует персонажа за слотами — React-вузол (без рядкового SVG) із currentColor:
 * колір задає CSS через `color`, прозорість заливки/контуру — як у Хелпері.
 * viewBox 100×250; розмір — через className/style ззовні. */
export function FIGURE(props: SVGProps<SVGSVGElement>): ReactElement {
  return createElement(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 100 250', 'aria-hidden': true, focusable: false, ...props },
    createElement(
      'g',
      {
        fill: 'currentColor',
        fillOpacity: 0.13,
        stroke: 'currentColor',
        strokeOpacity: 0.3,
        strokeWidth: 1.4,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
      },
      createElement('ellipse', { cx: 50, cy: 23, rx: 13, ry: 15 }),
      createElement('path', { d: FIGURE_PATH }),
    ),
  );
}
