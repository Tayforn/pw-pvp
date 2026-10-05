// =========================================================
// СКАН СКРІНШОТІВ — мінімальний декодер PNG (8 біт на канал, без черезрядковості):
// спрайти іконок і фікстури тестів. Розпаковує через DecompressionStream, який є
// і в браузері, і в Node 18+, тож canvas не потрібен і пікселі однакові всюди.
// Скріншот гравця (може бути JPEG) у браузері декодує canvas — це не сюди.
// =========================================================

import type { Raster } from './raster';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
/** Каналів на піксель за типом кольору PNG. */
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

async function inflate(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Зняти фільтри рядків PNG на місці; повертає пікселі без байтів фільтра. */
function unfilter(raw: Uint8Array, w: number, h: number, bpp: number): Uint8Array {
  const stride = w * bpp;
  const out = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const type = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? out[dst + i - bpp] : 0;
      const up = y > 0 ? out[dst + i - stride] : 0;
      const upLeft = y > 0 && i >= bpp ? out[dst + i - stride - bpp] : 0;
      let pred = 0;
      if (type === 1) pred = left;
      else if (type === 2) pred = up;
      else if (type === 3) pred = (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      out[dst + i] = (raw[src + i] + pred) & 255;
    }
  }
  return out;
}

/** PNG → растр RGBA. Непідтримуваний формат (16 біт, Adam7) — помилка. */
export async function decodePng(bytes: Uint8Array): Promise<Raster> {
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('це не PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let w = 0;
  let h = 0;
  let colorType = -1;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  for (let pos = 8; pos + 8 <= bytes.length; ) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const body = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = view.getUint32(pos + 8);
      h = view.getUint32(pos + 12);
      colorType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || !(colorType in CHANNELS)) throw new Error('PNG: підтримується лише 8 біт без черезрядковості');
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alpha = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!w || !h || !idat.length) throw new Error('PNG: немає даних');
  const packed = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of idat) {
    packed.set(c, off);
    off += c.length;
  }
  const bpp = CHANNELS[colorType];
  const px = unfilter(await inflate(packed.buffer), w, h, bpp);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, s = 0, d = 0; i < w * h; i++, s += bpp, d += 4) {
    if (colorType === 3) {
      const k = px[s];
      data[d] = palette ? palette[k * 3] : 0;
      data[d + 1] = palette ? palette[k * 3 + 1] : 0;
      data[d + 2] = palette ? palette[k * 3 + 2] : 0;
      data[d + 3] = alpha && k < alpha.length ? alpha[k] : 255;
    } else if (colorType === 0 || colorType === 4) {
      data[d] = data[d + 1] = data[d + 2] = px[s];
      data[d + 3] = colorType === 4 ? px[s + 1] : 255;
    } else {
      data[d] = px[s];
      data[d + 1] = px[s + 1];
      data[d + 2] = px[s + 2];
      data[d + 3] = colorType === 6 ? px[s + 3] : 255;
    }
  }
  return { w, h, data };
}
