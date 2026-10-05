// =========================================================
// СКАН СКРІНШОТІВ — растр: картинка як масив RGBA без привʼязки до canvas, щоб
// те саме ядро працювало і в браузері, і в тестах (Node без DOM). Декодування —
// окремо: png.ts (спрайти, фікстури) або canvas у браузері (скріншот гравця).
// =========================================================

/** Картинка RGBA, 4 байти на піксель, рядками згори вниз. */
export interface Raster {
  w: number;
  h: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Яскравість пікселів (середнє RGB), рядками. */
export function luminance(r: Raster): Float32Array {
  const out = new Float32Array(r.w * r.h);
  const d = r.data;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = (d[p] + d[p + 1] + d[p + 2]) / 3;
  return out;
}

/** Перемасштабувати білінійно: k > 1 збільшує, k < 1 зменшує. Потрібно, коли
 * скріншот знято не 1:1 (масштаб Windows, перетиснута картинка) — повертаємо
 * інтерфейс до рідних 32 px на іконку. */
export function resample(r: Raster, k: number): Raster {
  const w = Math.max(1, Math.round(r.w * k));
  const h = Math.max(1, Math.round(r.h * k));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = r.w / w;
  const sy = r.h / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(r.h - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(r.h - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(r.w - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(r.w - 1, x0 + 1);
      const wx = fx - x0;
      const a = (y0 * r.w + x0) * 4;
      const b = (y0 * r.w + x1) * 4;
      const c = (y1 * r.w + x0) * 4;
      const d = (y1 * r.w + x1) * 4;
      const o = (y * w + x) * 4;
      for (let ch = 0; ch < 4; ch++) {
        const top = r.data[a + ch] * (1 - wx) + r.data[b + ch] * wx;
        const bot = r.data[c + ch] * (1 - wx) + r.data[d + ch] * wx;
        out[o + ch] = top * (1 - wy) + bot * wy;
      }
    }
  }
  return { w, h, data: out };
}

/** Вирізати прямокутник (обрізається по межах картинки). */
export function crop(r: Raster, rect: Rect): Raster {
  const x = Math.max(0, Math.min(r.w, Math.floor(rect.x)));
  const y = Math.max(0, Math.min(r.h, Math.floor(rect.y)));
  const w = Math.max(0, Math.min(r.w - x, Math.ceil(rect.w)));
  const h = Math.max(0, Math.min(r.h - y, Math.ceil(rect.h)));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let j = 0; j < h; j++) data.set(r.data.subarray(((y + j) * r.w + x) * 4, ((y + j) * r.w + x + w) * 4), j * w * 4);
  return { w, h, data };
}
