// =========================================================
// Іконка вміння джина зі спрайта genie2.png (840×420, копія з PW Хелпера;
// оновлює scripts/genie-data.ts). Розміри — інлайном, а не класом: іконку
// малює й попап гравця в головному бандлі, де CSS ляльки не завантажено.
// =========================================================

import type { CSSProperties } from 'react';
import url from './genie2.png?url';
import { genieSkill } from './genie';

const SIZE = 32; // іконка у спрайті, px
const STEP = 40; // крок сітки (іконка + 8 px відступу)

/** Стиль іконки вміння: сторінка 1 починається з (40, 55), сторінка 2 — з (581, 72).
 * Невідомий ref → порожня клітинка того самого розміру. */
export function genieIconStyle(ref: number): CSSProperties {
  const s = genieSkill(ref);
  if (!s) return { width: SIZE, height: SIZE };
  const x = (s.page === 2 ? 581 : 40) + STEP * s.x;
  const y = (s.page === 2 ? 72 : 55) + STEP * s.y;
  return {
    width: SIZE,
    height: SIZE,
    backgroundImage: 'url("' + url + '")',
    backgroundPosition: '-' + x + 'px -' + y + 'px',
    backgroundRepeat: 'no-repeat',
  };
}
