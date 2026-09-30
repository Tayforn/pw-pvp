// =========================================================
// DEV-сторінка /dev/doll (лише в dev-збірці, у прод не потрапляє): редактор
// ляльки з персонажами з golden-фікстур typical-* (по одному на клас) і
// порожнім персонажем — щоб дивитись і правити верстку сторінки персонажа
// (колонки B3, картки, вузькі екрани, світла тема) без входу й без вдягання
// ляльки руками. Правки живуть лише в стані сторінки: нічого не зберігається,
// «Скинути» повертає фікстуру. Перемикач «лише перегляд» — для readOnly.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import PageMeta from '../app/PageMeta';
import { fixtureDoc, loadDevFixtures, type DevFixture } from '../doll/dev/fixtures';
import { emptyDoc, type CharacterDoc } from '../doll/model/doc';
import { CFG_MAIN } from '../doll/model/hydrate';
import DollEditor from '../doll/ui/DollEditor';

const EMPTY = 'empty';
const FIRST = 'typical-js';
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Документ для вибору: порожній персонаж або фікстура; зламана фікстура — помилка. */
function docFor(name: string, fixtures: DevFixture[]): CharacterDoc {
  if (name === EMPTY) return emptyDoc();
  const fx = fixtures.find((f) => f.name === name);
  if (!fx) throw new Error('немає фікстури ' + name);
  return fixtureDoc(fx);
}

export default function DevDollPage() {
  const [fixtures, setFixtures] = useState<DevFixture[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pick, setPick] = useState(FIRST);
  const [doc, setDoc] = useState<CharacterDoc>(() => emptyDoc());
  const [activeCfg, setActiveCfg] = useState(CFG_MAIN);
  const [readOnly, setReadOnly] = useState(false);

  // Каталог і довідники — разом із фікстурами; потім одразу відкриваємо першу.
  useEffect(() => {
    loadDevFixtures()
      .then((list) => {
        setFixtures(list);
        setDoc(docFor(FIRST, list));
      })
      .catch((e: unknown) => setErr(errText(e)));
  }, []);

  const open = useCallback(
    (name: string) => {
      setPick(name);
      setActiveCfg(CFG_MAIN);
      try {
        setDoc(docFor(name, fixtures ?? []));
        setErr(null);
      } catch (e) {
        setErr(errText(e));
      }
    },
    [fixtures],
  );

  const barStart = (
    <div className="field doll-bar-f">
      <label htmlFor="devDollFixture">Фікстура</label>
      <select id="devDollFixture" value={pick} onChange={(e) => open(e.target.value)} disabled={!fixtures}>
        <option value={EMPTY}>Порожній персонаж</option>
        {(fixtures ?? []).map((f) => (
          <option key={f.name} value={f.name}>
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
  const barEnd = (
    <>
      <label className="checkbox-row doll-bar-l">
        <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
        лише перегляд
      </label>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => open(pick)}>
        Скинути
      </button>
    </>
  );

  return (
    <div className="doll-page">
      <PageMeta title="DEV: лялька — PW PvP" description="Сторінка для верстки редактора ляльки (лише dev-збірка)." />
      {err && (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>Фікстури не відкрились: {err}</span>
        </div>
      )}
      <DollEditor
        value={doc}
        onChange={setDoc}
        readOnly={readOnly}
        activeCfg={activeCfg}
        onActiveCfg={setActiveCfg}
        barStart={barStart}
        barEnd={barEnd}
        barNote="DEV: персонажі з golden-фікстур typical-*; правки не зберігаються."
      />
    </div>
  );
}
