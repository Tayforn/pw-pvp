import { describe, expect, it } from 'vitest';
import {
  DOC_LIMITS, MAX_ROLL_VALUE, SET_KIND_LABELS, SLOT_CAT, attrPointsLeft, clampRollValue, cleanText, docSizeBytes, emptyDoc, rollRowCount,
  setKindShort, validateDoc,
} from '../doc';
import { docFrom, inst, mkDoc, mkSet } from './testDoc';

const errorsOf = (raw: unknown): string[] => {
  const v = validateDoc(raw);
  return v.ok ? [] : v.errors;
};

describe('validateDoc: форма', () => {
  it('порожній документ і документ із фікстури — валідні', () => {
    expect(validateDoc(emptyDoc()).ok).toBe(true);
    expect(validateDoc(emptyDoc('rg')).ok).toBe(true);
    const doc = docFrom('typical-by');
    const v = validateDoc(JSON.parse(JSON.stringify(doc)));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.doc).toEqual(doc);
  });

  it('зламаний JSON, не-обʼєкт, чужа версія', () => {
    expect(errorsOf('{"v":2,')).toEqual(['зламаний JSON']);
    expect(errorsOf(null)[0]).toMatch(/обʼєктом/);
    expect(errorsOf([])[0]).toMatch(/обʼєктом/);
    expect(errorsOf(JSON.stringify(emptyDoc()))).toEqual([]); // рядок з валідним JSON теж приймається
    expect(errorsOf({ ...emptyDoc(), v: 1 }).join()).toMatch(/версія/);
  });

  it('персонаж: клас із 10, стать, рівень 1..105, атрибути, шлях, імʼя ≤ 32', () => {
    expect(errorsOf({ ...emptyDoc(), cls: 'uf' }).join()).toMatch(/клас/);
    expect(errorsOf({ ...emptyDoc(), gender: 'x' }).join()).toMatch(/стать/);
    expect(errorsOf({ ...emptyDoc(), level: 106 }).join()).toMatch(/рівень/);
    expect(errorsOf({ ...emptyDoc(), level: 0 }).join()).toMatch(/рівень/);
    expect(errorsOf({ ...emptyDoc(), attrs: { str: -1, dex: 5, vit: 5, mag: 5 } }).join()).toMatch(/attrs\.str/);
    expect(errorsOf({ ...emptyDoc(), path: 'x' }).join()).toMatch(/path/);
    expect(errorsOf({ ...emptyDoc(), path: null })).toEqual([]);
    expect(errorsOf({ ...emptyDoc(), name: 'x'.repeat(33) }).join()).toMatch(/імʼя/);
    expect(errorsOf({ ...emptyDoc(), name: 'x'.repeat(32) })).toEqual([]);
    expect(errorsOf({ ...emptyDoc(), extra: 1 }).join()).toMatch(/зайве поле/);
    expect(errorsOf({ ...emptyDoc(), titles: { zzz: 1 } }).join()).toMatch(/titles/);
    expect(errorsOf({ ...emptyDoc(), titles: { hp: 100, ld: 50 } })).toEqual([]);
  });

  it('речі: iid, категорія, заточка, гнізда, роли, шліфовка лише у зброї', () => {
    const one = (i: Record<string, unknown>) => errorsOf(mkDoc({ items: [{ ...inst('a', 'ta', 1900), ...i } as never] })).join(' | ');
    expect(one({ i: 'ABC' })).toMatch(/iid/);
    expect(one({ i: 'abcdefg' })).toMatch(/iid/);
    expect(one({ cat: 'ob' })).toMatch(/категорія/);
    expect(one({ r: 13 })).toMatch(/заточка/);
    expect(one({ g: [1, 2, 3] })).toMatch(/гнізд/); // у зброї 2
    expect(one({ x: [{ t: 'nope', v: 1 }] })).toMatch(/невідомий код/);
    expect(one({ x: [{ t: 'sx', v: 'a' }] })).toMatch(/числом/);
    expect(one({ xr: true })).toMatch(/xr без/);
    expect(one({ xr: true, x: [{ t: 'sx', v: 9 }] })).toBe('');
    expect(errorsOf(mkDoc({ items: [inst('a', 'ft', 83, { w: 1 })] })).join()).toMatch(/шліфовка лише у зброї/);
    expect(errorsOf(mkDoc({ items: [inst('a', 'ta', 1900, { w: 1, c: 2, g: [54, 0] })] }))).toEqual([]);
  });

  it('цілісність: дубль iid, посилання на неіснуючу річ, cat ≠ слоту, річ двічі, pk/ic у сеті', () => {
    expect(errorsOf(mkDoc({ items: [inst('a', 'ta', 1900), inst('a', 'ft', 83)] })).join()).toMatch(/повторюється/);
    expect(errorsOf(mkDoc({ main: { ta: 'zz' } })).join()).toMatch(/нема в пулі/);
    expect(errorsOf(mkDoc({ items: [inst('a', 'ft', 83)], main: { ta: 'a' } })).join()).toMatch(/не лізе у слот/);
    expect(errorsOf(mkDoc({ items: [inst('a', 'oq', 284)], main: { cr: 'a', cd: 'a' } })).join()).toMatch(/надіта двічі/);
    expect(errorsOf(mkDoc({ items: [inst('a', 'oq', 284)], main: { cr: 'a' }, sets: [mkSet('set001', { cd: 'a' })] }))).toEqual([]);
    expect(errorsOf(mkDoc({ items: [inst('a', 'pk', 1)], sets: [mkSet('set001', { pk: 'a' } as never)] })).join()).toMatch(/лише в Головному/);
    expect(errorsOf(mkDoc({ items: [inst('a', 'ic', 15)], sets: [mkSet('set001', { ic: 'a' } as never)] })).join()).toMatch(/лише в Головному/);
    expect(errorsOf(mkDoc({ main: { xx: 'a' } as never })).join()).toMatch(/невідомий слот/);
  });

  it('сети: id, назва 1..24, вид, дубль id; два сети одного виду дозволені', () => {
    expect(errorsOf(mkDoc({ sets: [mkSet('s1')] })).join()).toMatch(/id сету/);
    expect(errorsOf(mkDoc({ sets: [mkSet('set001', {}, 'pz', '')] })).join()).toMatch(/назва сету/);
    expect(errorsOf(mkDoc({ sets: [mkSet('set001', {}, 'pz', 'x'.repeat(25))] })).join()).toMatch(/назва сету/);
    expect(errorsOf(mkDoc({ sets: [mkSet('set001', {}, 'zz' as never)] })).join()).toMatch(/вид сету/);
    expect(errorsOf(mkDoc({ sets: [mkSet('set001'), mkSet('set001')] })).join()).toMatch(/id сету повторюється/);
    expect(errorsOf(mkDoc({ sets: [mkSet('set001'), mkSet('set002', {}, 'pz', 'ПЗ 2')] }))).toEqual([]);
  });

  it('ліміти: 5 сетів, 100 речей, 400 рядків ролів, 32 КБ', () => {
    const sets = Array.from({ length: 6 }, (_, k) => mkSet('set00' + k, {}, 'pa', 'ПА ' + k));
    expect(errorsOf(mkDoc({ sets })).join()).toMatch(/сетів більше/);
    expect(errorsOf(mkDoc({ sets: sets.slice(0, 5) }))).toEqual([]);
    const items = Array.from({ length: 101 }, (_, k) => inst('i' + k.toString(36), 'oq', 284));
    expect(errorsOf(mkDoc({ items })).join()).toMatch(/речей більше/);
    expect(errorsOf(mkDoc({ items: items.slice(0, 100) }))).toEqual([]);
    const rows = Array.from({ length: 201 }, () => ({ t: 'sx', v: 1 }));
    const heavy = mkDoc({ items: [inst('a', 'ta', 1900, { x: rows }), inst('b', 'ta', 1900, { e: rows.slice(0, 200) })] });
    expect(rollRowCount(heavy)).toBe(401);
    expect(errorsOf(heavy).join()).toMatch(/рядків ролів/);
    // 32 КБ: речі й роли в межах лімітів, але роздутий buffs.cfg — форма в межах, а байти — ні.
    const cfg: Record<string, { on: boolean; lvl: number; side: string }> = {};
    for (let k = 1; k <= 800; k++) cfg[String(k)] = { on: true, lvl: 10, side: 'rs' };
    const fat = mkDoc({
      items: Array.from({ length: 100 }, (_, k) =>
        inst('f' + k.toString(36), 'ta', 1900, { r: 12, g: [54, 55], x: rows.slice(0, 2), e: rows.slice(0, 2), w: 2, c: 25, p: 28526 }),
      ),
      name: 'x'.repeat(32),
      buffs: { cfg, extra: [] },
    });
    expect(docSizeBytes(fat)).toBeGreaterThan(DOC_LIMITS.bytes);
    expect(errorsOf(fat).join()).toMatch(/завеликий/);
    expect(errorsOf({ ...fat, buffs: undefined })).toEqual([]);
  });

  it('бафи: форма cfg/extra', () => {
    expect(errorsOf({ ...emptyDoc(), buffs: { cfg: { '12': { on: true, lvl: 10, side: '' } }, extra: [12] } })).toEqual([]);
    expect(errorsOf({ ...emptyDoc(), buffs: { cfg: { x: { on: true, lvl: 10, side: '' } }, extra: [] } }).join()).toMatch(/не id бафа/);
    expect(errorsOf({ ...emptyDoc(), buffs: { cfg: { '1': { on: 1, lvl: 10, side: '' } }, extra: [] } }).join()).toMatch(/on/);
    expect(errorsOf({ ...emptyDoc(), buffs: { cfg: { '1': { on: true, lvl: 0, side: 'zz' } }, extra: [] } }).join()).toMatch(/lvl.*side|side/);
    expect(errorsOf({ ...emptyDoc(), buffs: { cfg: {}, extra: ['a'] } }).join()).toMatch(/extra/);
  });
});

describe('validateDoc: жорсткі й мʼякі порушення', () => {
  const soft = (raw: unknown) => {
    const v = validateDoc(raw);
    return v.ok ? null : { errors: v.errors.join(' | '), recoverable: !!v.recoverable };
  };

  it('атрибути: не нижче 5 і не понад бюджет рівня — мʼяко (документ цілий, відкривається)', () => {
    expect(attrPointsLeft(105, { str: 5, dex: 5, vit: 5, mag: 5 })).toBe(520);
    expect(soft({ ...emptyDoc(), attrs: { str: 525, dex: 5, vit: 5, mag: 5 } })).toBeNull(); // рівно 520
    expect(soft({ ...emptyDoc(), attrs: { str: 526, dex: 5, vit: 5, mag: 5 } })).toEqual({ errors: expect.stringMatching(/на 1 очок більше, ніж дає 105-й/), recoverable: true });
    expect(soft({ ...emptyDoc(), level: 1, attrs: { str: 9999, dex: 5, vit: 5, mag: 5 } })?.recoverable).toBe(true);
    expect(soft({ ...emptyDoc(), attrs: { str: 5, dex: 0, vit: 5, mag: 5 } })).toEqual({ errors: expect.stringMatching(/attrs\.dex.*нижче 5/), recoverable: true });
    // Зламаний тип — жорстко.
    expect(soft({ ...emptyDoc(), attrs: { str: 'x', dex: 5, vit: 5, mag: 5 } })?.recoverable).toBe(false);
  });

  it('ліміти (речі, рядки, сети, байти) — мʼякі; форма й цілісність — жорсткі', () => {
    const items = Array.from({ length: 101 }, (_, k) => ({ i: 'i' + k.toString(36), cat: 'oq', id: 284 }));
    expect(soft(mkDoc({ items: items as never }))?.recoverable).toBe(true);
    const sets = Array.from({ length: 6 }, (_, k) => mkSet('set00' + k, {}, 'pa', 'ПА ' + k));
    expect(soft(mkDoc({ sets }))?.recoverable).toBe(true);
    // Ліміт + зламане посилання — документ не відкривається, помилки обох сортів видно.
    const both = soft(mkDoc({ items: items as never, main: { ta: 'zz' } }));
    expect(both?.recoverable).toBe(false);
    expect(both?.errors).toMatch(/нема в пулі/);
    expect(both?.errors).toMatch(/речей більше/);
  });

  it('значення ролів: у межах ±1 000 000 і не більше 2 знаків після коми', () => {
    const one = (v: number) => soft(mkDoc({ items: [inst('a', 'ta', 1900, { x: [{ t: 'sx', v }] })] }));
    expect(one(0.05)).toBeNull();
    expect(one(-MAX_ROLL_VALUE)).toBeNull();
    expect(one(1e308)?.recoverable).toBe(true);
    expect(one(0.125)?.recoverable).toBe(true);
    expect(clampRollValue(1e308)).toBe(MAX_ROLL_VALUE);
    expect(clampRollValue(0.125)).toBe(0.13);
    expect(clampRollValue(Number.NaN)).toBe(0);
    expect(Object.is(clampRollValue(-0.001), 0)).toBe(true);
  });

  it('назви: керівні символи й одинокі сурогати — мʼяко; cleanText їх прибирає', () => {
    expect(soft({ ...emptyDoc(), name: 'a\u0000b' })?.recoverable).toBe(true);
    expect(soft({ ...emptyDoc(), name: 'a\ud800' })?.recoverable).toBe(true);
    expect(soft({ ...emptyDoc(), name: 'Тайфорн \u{1F525}' })).toBeNull();
    expect(soft(mkDoc({ sets: [mkSet('set001', {}, 'pz', 'П\tЗ')] }))?.recoverable).toBe(true);
    expect(cleanText('a\u0000b\tc\ud800', 32)).toBe('abc');
    expect(cleanText('ab\u{1F600}', 3)).toBe('ab');
    expect(cleanText('ab\u{1F600}', 4)).toBe('ab\u{1F600}');
  });
});

describe('docSizeBytes і константи', () => {
  it('рахує UTF-8 + по байту на кожну кому/двокрапку поза рядками (як jsonb::text)', () => {
    expect(docSizeBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length + 1);
    expect(docSizeBytes({ a: 'x:y,z', b: [1, 2] })).toBe(new TextEncoder().encode('{"a":"x:y,z","b":[1,2]}').length + 4);
    expect(docSizeBytes({ n: 'ім' })).toBe(new TextEncoder().encode('{"n":"ім"}').length + 1);
    // Типова лялька важить кілобайти, а не десятки.
    expect(docSizeBytes(docFrom('typical-by'))).toBeLessThan(3000);
  });

  it('слот → категорія і підписи видів', () => {
    expect(SLOT_CAT.cr).toBe('oq');
    expect(SLOT_CAT.cd).toBe('oq');
    expect(Object.keys(SLOT_CAT)).toHaveLength(17);
    expect(SET_KIND_LABELS).toEqual({ pz: 'ПЗ', pa: 'ПА', aspd: 'Спів' });
    expect(setKindShort('aspd', 'ga')).toBe('Спів');
    expect(setKindShort('aspd', 'by')).toBe('Спів'); // аспд-сету немає
    expect(setKindShort('pz', 'ga')).toBe('ПЗ');
  });
});
