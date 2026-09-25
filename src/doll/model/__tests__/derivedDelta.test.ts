import { beforeAll, describe, expect, it } from 'vitest';
import { setDelta } from '../derivedDelta';
import { hydrate } from '../hydrate';
import { createSet, equip, updateInstance } from '../ops';
import { docFrom, loadRef, lookup } from './testDoc';

beforeAll(() => loadRef());

describe('setDelta', () => {
  it('сет із ПЗ-зброєю (копія з ролом sx +20) дає dPz > 0, решта — 0', () => {
    let doc = docFrom('typical-by');
    const { doc: d1, setId } = createSet(doc, 'pz');
    doc = d1;
    doc = equip(doc, setId!, 'ta', doc.main.ta!);
    // Правка з вкладки сету: зброя надіта ще й у Головному → копія стає в сет.
    const r = updateInstance(doc, setId!, doc.main.ta!, { x: [{ t: 'sx', v: 20 }] });
    doc = r.doc;
    expect(r.iid).not.toBe(doc.main.ta);
    const d = setDelta(hydrate(doc, lookup), setId!);
    expect(d.delta.pz).toBe(20);
    expect(d.set.pz).toBe(d.main.pz + 20);
    expect(d.delta.pa).toBe(0);
    expect(d.delta.hp).toBe(0);
    expect(d.delta.aps).toBe(0);
    expect(d.delta.physAtkMax).toBe(0);
  });

  it('порожній сет = Головний (порожні слоти рахуються як у Головному)', () => {
    const doc = docFrom('typical-ga');
    const { doc: d1, setId } = createSet(doc, 'pa');
    const d = setDelta(hydrate(d1, lookup), setId!);
    expect(d.set).toEqual(d.main);
    expect(Object.values(d.delta).every((v) => v === 0)).toBe(true);
  });
});
