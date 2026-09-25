// =========================================================
// Сторожі ядра:
//  • sha256 файлів src/doll/core/*.ts (без version.ts, \r\n → \n) = список у SYNC.md,
//    і DOLL_ENGINE_VER у version.ts = у SYNC.md. Змінив формули — підніми версію
//    й онови SYNC.md (тест друкує готовий блок).
//  • sha256 усього блоку = запис DOLL_ENGINE_HASHES[DOLL_ENGINE_VER]; історія 1..N без
//    пропусків і повторів. Саме це не дає змінити ядро, не піднявши версію.
//  • ядро без DOM, fetch, import.meta і HTML-рядків.
//  • ADDON_CODES покриває ADDON_OPTIONS і всі коди nw.wu каталогів.
// =========================================================

import { describe, expect, it } from 'vitest';
import { ADDON_CODES, ADDON_OPTIONS } from '../constants';
import { DOLL_ENGINE_HASHES, DOLL_ENGINE_VER } from '../version';
import { CATALOG_CATS, readJson } from './testData';

const SRC = import.meta.glob('../*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SYNC = import.meta.glob('../SYNC.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const normalize = (s: string): string => s.replace(/\r\n/g, '\n');
const fileName = (key: string): string => key.replace(/^.*\//, '');

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Файли ядра, що входять у хеш: усі *.ts верхнього рівня, крім version.ts. */
function coreSources(): Array<[string, string]> {
  return Object.keys(SRC)
    .map((k) => [fileName(k), normalize(SRC[k])] as [string, string])
    .filter(([name]) => name !== 'version.ts')
    .sort(([a], [b]) => (a < b ? -1 : 1));
}

async function hashBlock(): Promise<string> {
  const rows: string[] = [];
  for (const [name, src] of coreSources()) rows.push(`- ${name}: ${await sha256(src)}`);
  return rows.join('\n');
}

function syncMd(): string {
  const key = Object.keys(SYNC)[0];
  if (!key) throw new Error('src/doll/core/SYNC.md не знайдено');
  return normalize(SYNC[key]);
}

describe('сторож ядра ляльки', () => {
  it('sha256 файлів ядра збігаються зі SYNC.md (змінив ядро → підняти DOLL_ENGINE_VER і оновити SYNC.md)', async () => {
    const expected = await hashBlock();
    const recorded = syncMd()
      .split('\n')
      .filter((l) => /^- [a-z]+\.ts: [0-9a-f]{64}$/.test(l))
      .join('\n');
    expect(recorded, 'Очікуваний блок для SYNC.md:\n' + expected).toBe(expected);
  });

  it('ядро збігається з записом історії саме для DOLL_ENGINE_VER (змінив ядро — нова версія, новий запис)', async () => {
    const combined = await sha256(await hashBlock());
    const vers = Object.keys(DOLL_ENGINE_HASHES)
      .map(Number)
      .sort((a, b) => a - b);
    expect(vers, 'версії в DOLL_ENGINE_HASHES мають іти 1..N без пропусків').toEqual(vers.map((_, i) => i + 1));
    expect(Math.max(...vers), 'DOLL_ENGINE_VER — остання версія історії').toBe(DOLL_ENGINE_VER);
    expect(new Set(Object.values(DOLL_ENGINE_HASHES)).size, 'різні версії мають різні хеші ядра').toBe(vers.length);
    const known = vers.find((v) => DOLL_ENGINE_HASHES[v] === combined);
    expect(
      DOLL_ENGINE_HASHES[DOLL_ENGINE_VER],
      known && known !== DOLL_ENGINE_VER
        ? `ядро як у версії ${known} — поверни DOLL_ENGINE_VER = ${known} або зміни ядро`
        : `ядро змінилось: підніми DOLL_ENGINE_VER до ${DOLL_ENGINE_VER + 1} і допиши в DOLL_ENGINE_HASHES ${DOLL_ENGINE_VER + 1}: '${combined}'`,
    ).toBe(combined);
  });

  it('DOLL_ENGINE_VER у version.ts дорівнює версії, записаній у SYNC.md', () => {
    const m = syncMd().match(/^DOLL_ENGINE_VER:\s*(\d+)\s*$/m);
    expect(m, 'у SYNC.md нема рядка «DOLL_ENGINE_VER: N»').not.toBeNull();
    expect(Number(m![1])).toBe(DOLL_ENGINE_VER);
  });

  it('ядро без DOM, fetch, import.meta і HTML-рядків', () => {
    // Шаблони складено з частин, щоб цей файл сам не спрацьовував на grep-сторожі репо.
    const banned: Array<[string, RegExp]> = [
      ['fetch(', /\bfetch\s*\(/],
      ['import.meta', /\bimport\s*\.\s*meta\b/],
      ['document.', /\bdocument\s*\./],
      ['window.', /\bwindow\s*\./],
      ['localStorage', /\blocalStorage\b/],
      ['inner' + 'HTML', new RegExp('\\binner' + 'HTML\\b')],
      ['HTML-тег у рядку', new RegExp("['`]<\\/?(div|span|b|i)\\b")],
    ];
    const hits: string[] = [];
    for (const [name, src] of Object.entries(SRC).map(([k, v]) => [fileName(k), v] as [string, string]))
      for (const [label, re] of banned) if (re.test(src)) hits.push(`${name}: ${label}`);
    expect(hits).toEqual([]);
    expect(Object.keys(SRC).length).toBeGreaterThanOrEqual(10);
  });

  it('ADDON_CODES = ADDON_OPTIONS ∪ коди nw.wu усіх каталогів, без дублів', () => {
    const codes = new Set(ADDON_CODES);
    expect(codes.size).toBe(ADDON_CODES.length);
    const missing = new Set<string>();
    for (const o of ADDON_OPTIONS) if (!codes.has(o.code)) missing.add(o.code);
    for (const cat of CATALOG_CATS) {
      for (const it of readJson<Array<{ nw?: { wu?: Array<{ type?: string }> } }>>(cat)) {
        for (const w of it.nw?.wu || []) if (w && typeof w.type === 'string' && w.type && !codes.has(w.type)) missing.add(w.type);
      }
    }
    expect([...missing], 'перегенерувати: npx vite-node scripts/doll-addon-codes.ts').toEqual([]);
  });
});
