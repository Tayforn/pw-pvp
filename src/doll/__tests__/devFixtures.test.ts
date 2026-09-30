// =========================================================
// ЛЯЛЬКА — dev-фікстури сторінки /dev/doll (src/doll/dev): копія typical-*
// не розійшлась з golden-фікстурами тестів, а мінімальний «гідратор» dev-
// сторінки дає той самий документ, що й хелпер тестів docFrom — тобто на
// /dev/doll видно рівно тих персонажів, на яких стоять тести.
// =========================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readJson } from '../core/__tests__/testData';
import { fixtureCats, fixtureDoc, loadDevFixtures, type DevFixture } from '../dev/fixtures';
import devTypical from '../dev/typical.json';
import { docFrom, fixtures } from '../model/__tests__/testDoc';

beforeAll(() => {
  // Каталог застосунку вантажиться fetch-ем — у тесті віддаємо JSON з диска.
  vi.stubGlobal('fetch', async (url: string) => {
    const name = String(url).split('/').pop()!.replace(/[?#].*$/, '').replace(/\.json$/, '');
    return { ok: true, status: 200, json: async () => readJson(name) };
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('dev-фікстури ляльки', () => {
  it('typical.json — точна копія typical-* з golden-фікстур (по одній на клас)', () => {
    const golden = fixtures('manual').filter((f) => f.name.startsWith('typical-'));
    expect(golden).toHaveLength(10);
    expect(devTypical).toEqual(golden);
  });

  it('документ dev-сторінки = документ тестів (docFrom), лише з імʼям фікстури', async () => {
    const list = await loadDevFixtures();
    expect(fixtureCats(list)).toEqual(expect.arrayContaining(['ob', 'wdf', 'crystal', 'ta', 'oq']));
    for (const fx of list as DevFixture[]) expect(fixtureDoc(fx), fx.name).toEqual({ ...docFrom(fx.name), name: fx.name });
  });
});
