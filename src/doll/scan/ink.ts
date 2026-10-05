// =========================================================
// СКАН СКРІНШОТІВ — «чорнило» цифр у вікні «Персонаж». Значення в грі білі або
// зелені (атрибут із бонусом), підписи — жовті. Беремо лише біле й зелене, тож
// підпис поруч із числом розпізнаванню не заважає. Спільне для stats.ts і
// генератора шаблонів цифр (scripts/doll-scan-glyphs.ts) — щоб шаблон і скріншот
// нормувались однаково.
// =========================================================

import type { Raster, Rect } from './raster';

/** Найменший розмах чорнила в прямокутнику, за якого там узагалі є текст. */
const MIN_SPAN = 90;

/** Чорнило пікселя 0..255: білість (min каналів мінус насиченість) або зеленість. */
function inkAt(d: Raster['data'], p: number): number {
  const r = d[p];
  const g = d[p + 1];
  const b = d[p + 2];
  const lo = Math.min(r, g, b);
  const hi = Math.max(r, g, b);
  return Math.max(0, lo - (hi - lo), g - Math.max(r, b));
}

/** Чорнило всього растра в абсолютній шкалі 0..1 (1 — чисто білий або зелений піксель). */
export function inkMap(r: Raster): Float32Array {
  const out = new Float32Array(r.w * r.h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = inkAt(r.data, p) / 255;
  return out;
}

/**
 * Чорнило прямокутника, нормоване до 0..1 (0 — тло, 1 — найяскравіший штрих).
 * null — прямокутник виходить за кадр або тексту в ньому немає.
 */
export function inkBox(r: Raster, rect: Rect): Float32Array | null {
  const { x, y, w, h } = rect;
  if (x < 0 || y < 0 || x + w > r.w || y + h > r.h || w <= 0 || h <= 0) return null;
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = inkAt(r.data, ((y + j) * r.w + x + i) * 4);
  const sorted = Float32Array.from(out).sort();
  const lo = sorted[sorted.length >> 1];
  const hi = sorted[sorted.length - 1];
  if (hi - lo < MIN_SPAN) return null;
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, Math.max(0, (out[i] - lo) / (hi - lo)));
  return out;
}
