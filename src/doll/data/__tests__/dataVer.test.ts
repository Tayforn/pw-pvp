import { describe, expect, it } from 'vitest';
import { DOLL_DATA_VER } from '../version';
import { CATS, isCat, jsonUrl } from '../catalog';
import { ITEM_CELLS_URL, buffIconStyle, iconStyle, spriteUrl } from '../assets';

// Сирий текст усіх json — тим самим glob-механізмом, яким каталог бере URL-и:
// якщо файл випав із glob, він випаде і з хешу, і тест це покаже.
const RAW = import.meta.glob('../json/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const REF_FILES = ['sets', 'buffs', 'debuffs', 'buff-defaults', 'skills', 'fustate', 'labels'];
const fileNames = () => Object.keys(RAW).map((k) => k.replace(/^.*\//, '').replace(/\.json$/, ''));

/** Та сама формула, що в scripts/doll-data-ver.ts (там node:crypto, тут Web
 * Crypto — @types/node у проєкті нема), навмисно продубльована: тест має
 * лишатися незалежним сторожем, а не довіряти скрипту. */
async function dataVer(): Promise<string> {
  const enc = new TextEncoder();
  // Ключі мають спільний префікс і суфікс, тож їх порядок = порядок імен файлів.
  const parts = Object.keys(RAW).sort().map((k) => enc.encode(RAW[k].replace(/\r\n/g, '\n')));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    all.set(p, off);
    off += p.length;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

/** Мінімальна річ для стилю іконки — важливий лише індекс `an`. */
const item = (an: number | string) => ({ id: 1, an, mi: 1, name: 'x' }) as unknown as Parameters<typeof iconStyle>[0];

describe('версія даних ляльки', () => {
  it('DOLL_DATA_VER збігається з хешем json/*.json (оновити: npx vite-node scripts/doll-data-ver.ts)', async () => {
    expect(DOLL_DATA_VER).toBe(await dataVer());
  });
  it('у теці json рівно 26 файлів: 19 каталогів + 7 довідників', () => {
    const names = fileNames();
    expect(names).toHaveLength(26);
    expect(names.filter((n) => !isCat(n) && !REF_FILES.includes(n))).toEqual([]);
  });
});

describe('каталог і спрайти', () => {
  it('кожна категорія з білого списку має JSON і спрайт для обох статей', () => {
    for (const cat of CATS) {
      expect(jsonUrl(cat), cat).toBeTruthy();
      expect(spriteUrl(cat, 'm'), cat).toContain(cat + '-hii');
      expect(spriteUrl(cat, 'f'), cat).toContain(cat + '-hii');
    }
  });
  it('довідники на місці', () => {
    for (const n of REF_FILES) expect(jsonUrl(n), n).toBeTruthy();
  });
  it('гендерні категорії дають різні спрайти для ч/ж, решта — той самий', () => {
    for (const cat of ['ft', 'rv', 'tg', 'rx', 'mj']) expect(spriteUrl(cat, 'm'), cat).not.toBe(spriteUrl(cat, 'f'));
    for (const cat of ['ta', 'oq', 'ob', 'ic']) expect(spriteUrl(cat, 'm'), cat).toBe(spriteUrl(cat, 'f'));
  });
  it('категорія поза білим списком → порожній URL і порожній стиль', () => {
    expect(jsonUrl('../etc')).toBeUndefined();
    expect(spriteUrl('../etc', 'm')).toBe('');
    expect(spriteUrl('sets', 'm')).toBe('');
    expect(iconStyle(item(7), 'nope', 'm')).toEqual({});
  });
  it('iconStyle: позиція з an — 6 колонок по 32 px, гендерний спрайт за статтю', () => {
    const s = iconStyle(item(7), 'ft', 'f');
    expect(s.backgroundPosition).toBe('-32px -32px');
    expect(s.backgroundImage).toContain('ft-hii');
    expect(s.backgroundImage).toContain('/f/');
    expect(iconStyle(item(0), 'ta', 'm').backgroundPosition).toBe('-0px -0px');
    expect(iconStyle(item('x'), 'ta', 'm').backgroundPosition).toBe('-0px -0px');
  });
  it('buffIconStyle зі спрайта yo.png; фон клітинок — item-cells.png', () => {
    expect(buffIconStyle(13).backgroundPosition).toBe('-32px -64px');
    expect(buffIconStyle(13).backgroundImage).toContain('yo');
    expect(ITEM_CELLS_URL).toContain('item-cells');
  });
});
