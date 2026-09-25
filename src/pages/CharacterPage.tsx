// =========================================================
// Сторінка персонажа: лялька (редактор із src/doll) на локальній чернетці.
// Збереження в профіль — наступний етап: кнопка вже на місці, але неактивна,
// а чернетка живе в цьому браузері (localStorage). Сторінка — окремий
// ледачий чанк: каталог і спрайти ляльки важать мегабайти, і решта сайту
// не має їх тягнути.
//
// Вкладка сету тримається в ?set=<id>: F5 і посилання відкривають той самий
// сет, а маршрут лишається один.
// =========================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageMeta from '../app/PageMeta';
import type { Route } from '../app/useRoute';
import { draftKey, parseHelperBuild, useDraft, type SaveState } from '../doll/api/draft';
import { emptyDoc, validateDoc, type CharacterDoc } from '../doll/model/doc';
import { CFG_MAIN } from '../doll/model/hydrate';
import DollEditor from '../doll/ui/DollEditor';

const SET_PARAM = 'set';

function readSetParam(): string {
  try {
    const v = new URLSearchParams(location.search).get(SET_PARAM);
    return v && /^[a-z0-9]{6,12}$/.test(v) ? v : CFG_MAIN;
  } catch {
    return CFG_MAIN;
  }
}

function writeSetParam(id: string): void {
  try {
    const url = new URL(location.href);
    if (id === CFG_MAIN) url.searchParams.delete(SET_PARAM);
    else url.searchParams.set(SET_PARAM, id);
    if (url.href !== location.href) history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  } catch {
    /* без History API вкладка просто не переживе F5 */
  }
}

const SAVE_TEXT: Record<SaveState, string> = {
  idle: 'Чернетка зберігатиметься в цьому браузері',
  saved: 'Чернетку збережено в цьому браузері',
  pending: 'Зберігаю чернетку…',
  failed: 'Не вдалося зберегти чернетку: сховище браузера недоступне або заповнене',
  held: 'Не зберігаю: чернетку змінено в іншій вкладці',
  off: 'Сховище браузера недоступне — чернетка не збережеться',
};

/** Що не пройде перевірку при збереженні в профіль (ліміти, бюджет атрибутів) — перші два пункти. */
function saveBlockers(doc: CharacterDoc): string | null {
  const v = validateDoc(doc);
  return v.ok ? null : v.errors.slice(0, 2).join('; ');
}

function ImportPanel({ hasWork, onImport, onClose }: { hasWork: boolean; onImport(doc: CharacterDoc): void; onClose(): void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const submit = () => {
    try {
      const doc = parseHelperBuild(text);
      if (hasWork && !window.confirm('Замінити поточну чернетку білдом із Хелпера? Поточні речі й сети буде втрачено.')) return;
      onImport(doc);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <section className="card doll-import" aria-label="Імпорт із Хелпера">
      <h3>Імпорт із PW Хелпера</h3>
      <ol className="doll-import-steps">
        <li>Відкрий у Хелпері сторінку «Лялька» з потрібним білдом.</li>
        <li>
          Натисни F12 → вкладка «Console» і виконай <code>copy(localStorage.pwDollBuild)</code> — білд скопіюється в буфер.
        </li>
        <li>Встав його сюди й натисни «Перенести».</li>
      </ol>
      <p className="hint">Речі з рюкзака Хелпера потраплять в інвентар. Класи, яких немає на сервері гільдії, не переносяться.</p>
      <div className="field">
        <label htmlFor="dollImportText">Білд із Хелпера</label>
        <textarea
          id="dollImportText"
          rows={5}
          spellCheck={false}
          placeholder='{"cls":"by","gender":"m","level":105, …}'
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setErr(null);
          }}
        />
      </div>
      {err && (
        <p className="form-err" role="alert">
          {err}
        </p>
      )}
      <div className="doll-import-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={submit}>
          Перенести
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Скасувати
        </button>
      </div>
    </section>
  );
}

function DraftCharacter() {
  const { doc, setDoc, reset, saveState, loadError, loadWarning, conflict, takeTheirs, keepMine } = useDraft(draftKey('anon', 'new'));
  const [activeCfg, setActiveCfgState] = useState(readSetParam);
  const [importOpen, setImportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    loadError
      ? 'Стару чернетку не вдалося відкрити (' + loadError + '). Її копію відкладено, почато нового персонажа.'
      : loadWarning
        ? 'Чернетку відкрито, але її треба виправити, інакше збереження в профіль її не прийме: ' + loadWarning + '.'
        : null,
  );
  const blockers = useMemo(() => saveBlockers(doc), [doc]);

  const setActiveCfg = useCallback((id: string) => {
    setActiveCfgState(id);
    writeSetParam(id);
  }, []);
  useEffect(() => {
    const onPop = () => setActiveCfgState(readSetParam());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const hasWork = doc.items.length > 0 || doc.sets.length > 0 || !!doc.name;

  const resetDraft = () => {
    if (!window.confirm('Скинути чернетку? Усі речі, сети й налаштування персонажа буде видалено з цього браузера.')) return;
    reset(emptyDoc(doc.cls));
    setActiveCfg(CFG_MAIN);
    setNotice(null);
  };

  const importDoc = (next: CharacterDoc) => {
    const merged = { ...next, name: next.name || doc.name };
    reset(merged);
    setActiveCfg(CFG_MAIN);
    setImportOpen(false);
    const fix = saveBlockers(merged);
    setNotice(
      'Білд із Хелпера перенесено (речей: ' + next.items.length + ').' + (fix ? ' Перед збереженням виправ: ' + fix + '.' : ''),
    );
  };

  const openTheirs = () => {
    const got = takeTheirs();
    if (got.error) setNotice('Чернетку з іншої вкладки не вдалося відкрити (' + got.error + '). Її копію відкладено.');
    else setNotice(got.warning ? 'Відкрито чернетку з іншої вкладки. Перед збереженням виправ: ' + got.warning + '.' : null);
  };

  return (
    <>
      <div className="card doll-page-bar">
        <div className="doll-page-save">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled
            title="Збереження в профіль зʼявиться наступним етапом; чернетка зберігається в цьому браузері"
          >
            Зберегти в профіль
          </button>
          <span className="hint">
            <span className="doll-page-hint-long">Збереження в профіль зʼявиться наступним етапом; чернетка зберігається в цьому браузері.</span>
            <span className="doll-page-hint-short">Збереження в профіль — наступним етапом.</span>
          </span>
          {blockers && (
            <span className="doll-page-blockers" role="note">
              Перед збереженням виправ: {blockers}.
            </span>
          )}
        </div>
        <div className="doll-page-tools">
          <span className={'doll-save-state is-' + saveState} role="status">
            {SAVE_TEXT[saveState]}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={importOpen} aria-label="Імпорт із Хелпера" onClick={() => setImportOpen((v) => !v)}>
            <span className="doll-page-hint-long">Імпорт із Хелпера</span>
            <span className="doll-page-hint-short">Імпорт</span>
          </button>
          <button type="button" className="btn btn-bad btn-sm" aria-label="Скинути чернетку" onClick={resetDraft}>
            <span className="doll-page-hint-long">Скинути чернетку</span>
            <span className="doll-page-hint-short">Скинути</span>
          </button>
        </div>
      </div>

      {conflict && (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>Чернетку змінено в іншій вкладці. Поки ти не вибереш, ця вкладка її не перезаписує.</span>
          <span className="doll-page-notice-acts">
            <button type="button" className="btn btn-primary btn-sm" onClick={openTheirs}>
              Відкрити новішу
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={keepMine}>
              Лишити цю
            </button>
          </span>
        </div>
      )}

      {notice && (
        <div className="card doll-page-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Закрити" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}
      {importOpen && <ImportPanel hasWork={hasWork} onImport={importDoc} onClose={() => setImportOpen(false)} />}

      <DollEditor value={doc} onChange={setDoc} activeCfg={activeCfg} onActiveCfg={setActiveCfg} />
    </>
  );
}

export default function CharacterPage({ id, onNavigate }: { id: string; onNavigate?: (route: Route) => void }) {
  const isDraft = id === 'new';
  return (
    <div className="doll-page">
      <PageMeta
        title="Персонаж — PW PvP"
        description="Лялька персонажа: спорядження, сети для свапу й характеристики — ті самі формули, що в PW Хелпері."
      />
      <header className="section-head">
        <span className="eyebrow">Персонаж</span>
        <h2>Лялька персонажа</h2>
        <p>Одягни Головний комплект і додай сети для свапу (ПЗ, ПА, спів/аспд). Формули — ті самі, що в PW Хелпері.</p>
      </header>
      {isDraft ? (
        <DraftCharacter />
      ) : (
        <div className="card doll-page-notice" role="status">
          <span>Збережених персонажів ще немає — збереження в профіль зʼявиться наступним етапом. Поки що лялька працює як чернетка в цьому браузері.</span>
          {onNavigate && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate({ name: 'character', id: 'new' })}>
              Відкрити чернетку
            </button>
          )}
        </div>
      )}
    </div>
  );
}
