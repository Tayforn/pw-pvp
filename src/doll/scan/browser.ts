// =========================================================
// СКАН СКРІНШОТІВ — стик із браузером: картинка гравця → растр (через canvas,
// бо це може бути й JPEG), каталог і спрайти іконок для сканера, вирізки
// клітинок зі скріншота для показу. Решта сканера про DOM не знає.
// =========================================================

import { spriteUrl } from '../data/assets';
import { catItems, ensureCats } from '../data/catalog';
import { SLOT_CAT, SLOT_KEYS, type SlotKey } from '../model/doc';
import { ICON, slotRect, type EquipScan, type ScanSource } from './equip';
import { decodePng } from './png';
import type { Raster } from './raster';

/** Більші знімки не беремо: це не скріншот вікна гри, а щось випадкове. */
const MAX_SIDE = 8192;

/** Категорії каталогу всіх слотів ляльки — сканеру потрібні всі. */
export const SCAN_CATS: string[] = [...new Set(SLOT_KEYS.map((s) => SLOT_CAT[s]))];

function canvasOf(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('браузер не дав намалювати картинку');
  return { canvas, ctx };
}

/** Файл чи вставлена картинка → растр. Помилка — якщо це не картинка або вона завелика. */
export async function blobToRaster(blob: Blob): Promise<Raster> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    throw new Error('це не картинка або браузер не вміє її відкрити');
  }
  try {
    if (bitmap.width > MAX_SIDE || bitmap.height > MAX_SIDE) throw new Error('картинка завелика (' + bitmap.width + '×' + bitmap.height + ')');
    const { ctx } = canvasOf(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { w: img.width, h: img.height, data: img.data };
  } finally {
    bitmap.close();
  }
}

const sprites = new Map<string, Promise<Raster>>();
function sprite(url: string): Promise<Raster> {
  let p = sprites.get(url);
  if (!p) {
    p = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('не вдалося завантажити іконки: HTTP ' + res.status);
        return res.arrayBuffer();
      })
      .then((buf) => decodePng(new Uint8Array(buf)));
    // Невдалу спробу не запамʼятовуємо — наступний скріншот спробує знову.
    p.catch(() => sprites.delete(url));
    sprites.set(url, p);
  }
  return p;
}

/** Каталог і спрайти всіх слотів, завантажені й розкодовані, — джерело для scanEquip. */
export async function loadScanSource(): Promise<ScanSource> {
  await ensureCats(SCAN_CATS);
  const ready = new Map<string, Raster>();
  await Promise.all(
    SCAN_CATS.flatMap((cat) =>
      (['m', 'f'] as const).map(async (g) => {
        const url = spriteUrl(cat, g);
        if (url) ready.set(cat + ':' + g, await sprite(url));
      }),
    ),
  );
  return {
    items: (cat) => catItems(cat),
    sprite: (cat, gender) => ready.get(cat + ':' + gender) ?? null,
  };
}

/** Вирізки клітинок слотів зі скріншота (data-URL 32×32) — показати гравцеві, що побачив сканер. */
export function slotThumbs(shot: Raster, scan: EquipScan): Partial<Record<SlotKey, string>> {
  const full = canvasOf(shot.w, shot.h);
  full.ctx.putImageData(new ImageData(new Uint8ClampedArray(shot.data), shot.w, shot.h), 0, 0);
  const cell = canvasOf(ICON, ICON);
  const out: Partial<Record<SlotKey, string>> = {};
  for (const slot of SLOT_KEYS) {
    const r = slotRect(scan, slot);
    if (r.x < 0 || r.y < 0 || r.x + r.w > shot.w || r.y + r.h > shot.h) continue; // клітинку обрізано
    cell.ctx.clearRect(0, 0, ICON, ICON);
    cell.ctx.drawImage(full.canvas, r.x, r.y, r.w, r.h, 0, 0, ICON, ICON);
    out[slot] = cell.canvas.toDataURL('image/png');
  }
  return out;
}
