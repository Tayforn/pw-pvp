// =========================================================
// Персонажі: /characters — список «Мої персонажі» (для учасників клану,
// вхід через Discord); /characters/new — новий персонаж на локальній
// чернетці (працює й без входу; «Зберегти в профіль» просить увійти);
// /characters/<id> — збережений персонаж із сервера (бекенд ладдера,
// /api/pvp/characters). Сторінка — окремий ледачий чанк: каталог і спрайти
// ляльки важать мегабайти, і решта сайту не має їх тягнути.
//
// Вкладка сету тримається в ?set=<id>: F5 і посилання відкривають той самий
// сет, а маршрут лишається один.
//
// Незбережені зміни (правки збереженого персонажа; правки чернетки, коли її
// запис у браузер зупинено чи зламано) не губляться мовчки: сторінка ставить
// leaveGuard (app/leaveGuard.ts) — роутер питає підтвердження перед переходом
// по меню сайту й «Назад / Вперед», браузер — перед закриттям вкладки.
// =========================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLeaveGuard } from '../app/leaveGuard';
import PageMeta from '../app/PageMeta';
import { useMe } from '../app/useMe';
import { noteHistoryChange, type Route } from '../app/useRoute';
import {
  CharacterApiError, archiveCharacter, createCharacter, getCharacter, listCharacters, updateCharacter,
  type CharacterRecord, type CharacterSummary,
} from '../doll/api/characters';
import { browserStorage, clearDraft, draftKey, loadDraft, parseHelperBuild, useDraft, type SaveState } from '../doll/api/draft';
import { emptyDoc, isClsKey, validateDoc, type CharacterDoc } from '../doll/model/doc';
import { CFG_MAIN } from '../doll/model/hydrate';
import { mergeImported } from '../doll/model/importCalc';
import { BarTrashButton, SavePill, clsLabel } from '../doll/ui/CharBar';
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
    if (url.href !== location.href) {
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      // Роутер повертає на цю адресу після «Скасувати» в застереженні — хай знає нову.
      noteHistoryChange();
    }
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
/** Стани, коли чернетка НЕ пишеться в браузер: пігулка червона, повний текст — ще й у рядку під смужкою. */
const SAVE_BAD: ReadonlySet<SaveState> = new Set(['failed', 'held', 'off']);

/** Що не пройде перевірку при збереженні в профіль (імʼя, ліміти, бюджет атрибутів) — перші два пункти. */
function saveBlockers(doc: CharacterDoc): string | null {
  if (!doc.name.trim()) return 'дай персонажу імʼя (поле «Імʼя» вгорі)';
  const v = validateDoc(doc);
  return v.ok ? null : v.errors.slice(0, 2).join('; ');
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Вкладка сету в ?set= — спільне для чернетки й збереженого персонажа. */
function useActiveCfg(): [string, (id: string) => void] {
  const [activeCfg, setState] = useState(readSetParam);
  const set = useCallback((id: string) => {
    setState(id);
    writeSetParam(id);
  }, []);
  useEffect(() => {
    const onPop = () => setState(readSetParam());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return [activeCfg, set];
}

function Notice({ text, onClose }: { text: string; onClose(): void }) {
  return (
    <div className="card doll-page-notice" role="status">
      <span>{text}</span>
      <button type="button" className="btn btn-ghost btn-sm" aria-label="Закрити" onClick={onClose}>
        ✕
      </button>
    </div>
  );
}

/** «← Мої персонажі» на початку смужки персонажа; на вужчій смужці лишається стрілка (назва — в aria-label). */
function BackToList({ onClick }: { onClick(): void }) {
  return (
    <button type="button" className="doll-bar-back" aria-label="Мої персонажі" title="До списку «Мої персонажі»" onClick={onClick}>
      <span aria-hidden="true">←</span>
      <span className="doll-bar-back-t" aria-hidden="true">
        Мої персонажі
      </span>
    </button>
  );
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

type Nav = ((route: Route) => void) | undefined;

// ── Новий персонаж: локальна чернетка ─────────────────────────────

function DraftCharacter({ onNavigate }: { onNavigate: Nav }) {
  const { me, loading: meLoading, login } = useMe();
  const key = draftKey('anon', 'new');
  const { doc, setDoc, reset, saveState, loadError, loadWarning, conflict, takeTheirs, keepMine } = useDraft(key);
  const [activeCfg, setActiveCfg] = useActiveCfg();
  const [importOpen, setImportOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    loadError
      ? 'Стару чернетку не вдалося відкрити (' + loadError + '). Її копію відкладено, почато нового персонажа.'
      : loadWarning
        ? 'Чернетку відкрито, але її треба виправити, інакше збереження в профіль її не прийме: ' + loadWarning + '.'
        : null,
  );
  const blockers = useMemo(() => saveBlockers(doc), [doc]);
  const hasWork = doc.items.length > 0 || doc.sets.length > 0 || !!doc.name;
  // Чернетка в браузері не записана: конфлікт вкладок (запис зупинено), запис не вдався або
  // сховища немає — будь-який відхід (меню сайту, «Назад», закриття вкладки) втратить зміни
  // цієї вкладки, тож сторінка не відпускає без підтвердження (як збережений персонаж із правками).
  const unsaved = hasWork && (conflict || saveState === 'held' || saveState === 'failed' || saveState === 'off');
  const releaseGuard = useLeaveGuard(unsaved ? 'Зміни в цій вкладці не збережено в браузері. Піти зі сторінки?' : null);
  const toList = () => onNavigate?.({ name: 'characters' });

  const resetDraft = () => {
    if (!window.confirm('Скинути чернетку? Усі речі, сети й налаштування персонажа буде видалено з цього браузера.')) return;
    reset(emptyDoc(doc.cls));
    setActiveCfg(CFG_MAIN);
    setNotice(null);
  };

  const importDoc = (next: CharacterDoc) => {
    const merged = mergeImported(doc, next);
    reset(merged);
    setActiveCfg(CFG_MAIN);
    setImportOpen(false);
    const fix = saveBlockers(merged);
    setNotice('Білд із Хелпера перенесено (речей: ' + next.items.length + ').' + (fix ? ' Перед збереженням: ' + fix + '.' : ''));
  };

  const openTheirs = () => {
    const got = takeTheirs();
    if (got.error) setNotice('Чернетку з іншої вкладки не вдалося відкрити (' + got.error + '). Її копію відкладено.');
    else setNotice(got.warning ? 'Відкрито чернетку з іншої вкладки. Перед збереженням виправ: ' + got.warning + '.' : null);
  };

  const saveToProfile = async () => {
    if (blockers) {
      setNotice('Перед збереженням: ' + blockers + '.');
      return;
    }
    setSaving(true);
    try {
      const rec = await createCharacter({ ...doc, name: doc.name.trim() });
      // Персонаж тепер на сервері — чернетка «нового» більше не потрібна, застереження теж.
      clearDraft(key);
      releaseGuard();
      onNavigate?.({ name: 'character', id: rec.id });
    } catch (e) {
      if (e instanceof CharacterApiError && e.code === 'unauthorized') {
        setNotice('Сесія завершилась — увійди через Discord ще раз. Чернетка лишається в цьому браузері.');
      } else {
        setNotice('Не вдалося зберегти: ' + errText(e));
      }
      setSaving(false);
    }
  };

  // Смужка персонажа: ліворуч «← Мої персонажі», праворуч пігулка стану чернетки, імпорт,
  // кошик «Скинути чернетку» і збереження — коротко, щоб усе стало в один рядок.
  const saveBad = SAVE_BAD.has(saveState);
  const barEnd = (
    <>
      <SavePill text={saveBad ? 'не збережено' : 'чернетка'} tone={saveBad ? 'bad' : 'mute'} title={SAVE_TEXT[saveState]} />
      <button type="button" className="btn btn-ghost btn-sm" aria-expanded={importOpen} aria-label="Імпорт із Хелпера" onClick={() => setImportOpen((v) => !v)}>
        <span className="doll-page-hint-long">Імпорт із Хелпера</span>
        <span className="doll-page-hint-short">Імпорт</span>
      </button>
      <BarTrashButton label="Скинути чернетку" onClick={resetDraft} />
      {me ? (
        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void saveToProfile()}>
          {saving ? 'Зберігаю…' : 'Зберегти в профіль'}
        </button>
      ) : (
        <button type="button" className="btn btn-primary btn-sm" disabled={meLoading} title="Увійти через Discord, щоб зберегти персонажа в профіль" onClick={login}>
          Увійти й зберегти
        </button>
      )}
    </>
  );
  const barNote = (
    <>
      <span>
        {me
          ? 'Персонаж збережеться в профілі — його буде видно з будь-якого пристрою.'
          : 'Без входу лялька працює як чернетка в цьому браузері — після входу її можна зберегти.'}
      </span>
      {me && blockers && (
        <span className="doll-page-blockers" role="note">
          Перед збереженням: {blockers}.
        </span>
      )}
      {/* «held» пояснює плашка конфлікту нижче; решту поганих станів пігулка лише позначає. */}
      {saveBad && saveState !== 'held' && (
        <span className="doll-page-blockers" role="note">
          {SAVE_TEXT[saveState]}.
        </span>
      )}
    </>
  );
  const top = (
    <>
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
      {notice && <Notice text={notice} onClose={() => setNotice(null)} />}
      {importOpen && <ImportPanel hasWork={hasWork} onImport={importDoc} onClose={() => setImportOpen(false)} />}
    </>
  );

  return (
    <DollEditor
      value={doc}
      onChange={setDoc}
      activeCfg={activeCfg}
      onActiveCfg={setActiveCfg}
      barStart={<BackToList onClick={toList} />}
      barEnd={barEnd}
      barNote={barNote}
      top={top}
    />
  );
}

// ── Збережений персонаж ───────────────────────────────────────────

type Loaded = { doc: CharacterDoc; warning: string | null };

function docFromRecord(rec: CharacterRecord): Loaded | null {
  const v = validateDoc(rec.doc);
  if (v.ok) return { doc: v.doc, warning: null };
  if (v.recoverable) return { doc: v.recoverable, warning: v.errors.slice(0, 2).join('; ') };
  return null;
}

type LoadState = { kind: 'loading' } | { kind: 'error'; code: string; text: string } | { kind: 'ready' };

function SavedCharacter({ id, onNavigate }: { id: string; onNavigate: Nav }) {
  const { me, loading: meLoading, login } = useMe();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [doc, setDocState] = useState<CharacterDoc>(() => emptyDoc());
  const [revision, setRevision] = useState(0);
  const [savedDoc, setSavedDoc] = useState<CharacterDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [activeCfg, setActiveCfg] = useActiveCfg();
  // Редактор повертає новий обʼєкт на кожну зміну, тож «змінено» = не той самий обʼєкт, що збережено.
  const dirty = savedDoc !== null && doc !== savedDoc;
  // Незбережені зміни: підтвердження перед переходом по сайту, «Назад» і закриттям вкладки.
  const releaseGuard = useLeaveGuard(dirty ? 'Є незбережені зміни. Піти зі сторінки без збереження?' : null);

  const applyRecord = useCallback((rec: CharacterRecord): boolean => {
    const got = docFromRecord(rec);
    if (!got) return false;
    setDocState(got.doc);
    setSavedDoc(got.doc);
    setRevision(rec.revision);
    if (got.warning) setNotice('Персонажа відкрито, але перед наступним збереженням треба виправити: ' + got.warning + '.');
    return true;
  }, []);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const rec = await getCharacter(id);
      if (applyRecord(rec)) setState({ kind: 'ready' });
      else setState({ kind: 'error', code: 'broken', text: 'Документ персонажа пошкоджено — його не вдалося відкрити.' });
    } catch (e) {
      const code = e instanceof CharacterApiError ? e.code : 'internal';
      setState({ kind: 'error', code, text: errText(e) });
    }
  }, [id, applyRecord]);

  useEffect(() => {
    if (meLoading) return;
    if (!me) {
      setState({ kind: 'error', code: 'unauthorized', text: 'Збережених персонажів видно лише після входу через Discord.' });
      return;
    }
    void load();
  }, [me, meLoading, load]);

  const blockers = useMemo(() => saveBlockers(doc), [doc]);

  const save = async (baseRevision: number) => {
    if (blockers) {
      setNotice('Перед збереженням: ' + blockers + '.');
      return;
    }
    setBusy(true);
    const sent = doc;
    try {
      const rec = await updateCharacter(id, { ...sent, name: sent.name.trim() }, baseRevision);
      setRevision(rec.revision);
      setSavedDoc(sent);
      setConflict(false);
      setNotice(null);
    } catch (e) {
      if (e instanceof CharacterApiError && e.code === 'conflict' && /змінено/.test(e.message)) setConflict(true);
      else setNotice('Не вдалося зберегти: ' + errText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Конфлікт: перезаписати серверну версію своєю — беремо її поточну ревізію. */
  const overwrite = async () => {
    try {
      const cur = await getCharacter(id);
      await save(cur.revision);
    } catch (e) {
      setNotice('Не вдалося зберегти: ' + errText(e));
    }
  };

  const discard = async () => {
    if (dirty && !window.confirm('Відкинути незбережені зміни і завантажити збережену версію?')) return;
    setConflict(false);
    setNotice(null);
    await load();
  };

  const remove = async () => {
    if (!window.confirm(`Видалити персонажа «${doc.name || 'без імені'}»? Його більше не буде в списку.`)) return;
    setBusy(true);
    try {
      await archiveCharacter(id);
      // Персонажа вже немає — правки до нього втрачати нема чого, застереження не питаємо.
      releaseGuard();
      onNavigate?.({ name: 'characters' });
    } catch (e) {
      setBusy(false);
      setNotice('Не вдалося видалити: ' + errText(e));
    }
  };

  // Застереження про незбережені зміни покаже роутер (leaveGuard) — тут лише перехід.
  const toList = () => onNavigate?.({ name: 'characters' });

  if (state.kind === 'loading') return <p className="hint">Завантажую персонажа…</p>;
  if (state.kind === 'error') {
    return (
      <div className="card doll-page-notice is-warn" role="alert">
        <span>{state.code === 'not_found' ? 'Персонажа не знайдено — можливо, його видалено.' : state.text}</span>
        <span className="doll-page-notice-acts">
          {state.code === 'unauthorized' ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={login}>
              Увійти через Discord
            </button>
          ) : state.code !== 'not_found' && state.code !== 'broken' ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
              Повторити
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate?.({ name: 'characters' })}>
            До списку персонажів
          </button>
        </span>
      </div>
    );
  }

  // Смужка персонажа: ліворуч «← Мої персонажі», праворуч пігулка стану, «Скасувати», кошик «Видалити персонажа», «Зберегти».
  const barEnd = (
    <>
      <SavePill
        text={dirty ? 'не збережено' : 'збережено'}
        tone={dirty ? 'warn' : 'good'}
        title={dirty ? 'Є незбережені зміни' : 'Усе збережено в профілі'}
      />
      <button type="button" className="btn btn-ghost btn-sm" disabled={busy || !dirty} title="Скасувати зміни й завантажити збережену версію" onClick={() => void discard()}>
        Скасувати
      </button>
      <BarTrashButton label="Видалити персонажа" disabled={busy} onClick={() => void remove()} />
      <button type="button" className="btn btn-primary btn-sm" disabled={busy || !dirty} onClick={() => void save(revision)}>
        {busy ? 'Зберігаю…' : 'Зберегти'}
      </button>
    </>
  );
  const barNote =
    dirty && blockers ? (
      <span className="doll-page-blockers" role="note">
        Перед збереженням: {blockers}.
      </span>
    ) : null;
  const top = (
    <>
      {conflict && (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>Цього персонажа вже змінено в іншій вкладці чи на іншому пристрої. Що лишити?</span>
          <span className="doll-page-notice-acts">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void discard()}>
              Завантажити збережену версію
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void overwrite()}>
              Перезаписати моєю
            </button>
          </span>
        </div>
      )}
      {notice && <Notice text={notice} onClose={() => setNotice(null)} />}
    </>
  );

  return (
    <DollEditor
      value={doc}
      onChange={setDocState}
      activeCfg={activeCfg}
      onActiveCfg={setActiveCfg}
      barStart={<BackToList onClick={toList} />}
      barEnd={barEnd}
      barNote={barNote}
      top={top}
    />
  );
}

// ── Мої персонажі ─────────────────────────────────────────────────

function draftSummary(): { name: string; items: number } | null {
  const got = loadDraft(draftKey('anon', 'new'), browserStorage());
  if (!got.doc) return null;
  const d = got.doc;
  if (!d.name && d.items.length === 0 && d.sets.length === 0) return null;
  return { name: d.name, items: d.items.length };
}

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
};

function CharactersList({ onNavigate }: { onNavigate: Nav }) {
  const { me, loading: meLoading, login } = useMe();
  const [data, setData] = useState<{ characters: CharacterSummary[]; max: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft] = useState(draftSummary);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData(await listCharacters());
    } catch (e) {
      setErr(errText(e));
    }
  }, []);
  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  const go = (id: string) => onNavigate?.({ name: 'character', id });
  const draftCard = draft && (
    <button type="button" className="card doll-char-card is-draft" onClick={() => go('new')}>
      <span className="doll-char-name">{draft.name || 'Персонаж без імені'}</span>
      <span className="doll-char-meta">чернетка в цьому браузері · речей {draft.items}</span>
      <span className="doll-char-hint">{me ? 'Відкрити й зберегти в профіль' : 'Продовжити'}</span>
    </button>
  );

  if (meLoading) return <p className="hint">Перевірка входу…</p>;
  if (!me) {
    return (
      <>
        <div className="card doll-page-notice">
          <span>Зберігати персонажів у профілі можуть учасники клану — увійди через Discord. Без входу лялька працює як чернетка в цьому браузері — нею можна подати заявку на фул-рандом; збережи чернетку, поки турнір не закінчиться.</span>
          <span className="doll-page-notice-acts">
            <button type="button" className="btn btn-primary btn-sm" onClick={login}>
              Увійти через Discord
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => go('new')}>
              {draft ? 'Відкрити чернетку' : 'Спробувати без входу'}
            </button>
          </span>
        </div>
        {draftCard && <div className="doll-char-grid">{draftCard}</div>}
      </>
    );
  }

  const full = !!data && data.characters.length >= data.max;
  return (
    <>
      <div className="card doll-page-bar">
        <div className="doll-page-save">
          <button type="button" className="btn btn-primary btn-sm" disabled={full} onClick={() => go('new')}>
            + Новий персонаж
          </button>
          <span className="hint">
            {data ? `Персонажів ${data.characters.length} з ${data.max}.` : ''}
            {full ? ' Щоб додати нового, видали непотрібного.' : ''}
          </span>
        </div>
      </div>
      {err && (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>Не вдалося завантажити персонажів: {err}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
            Повторити
          </button>
        </div>
      )}
      {!data && !err && <p className="hint">Завантажую персонажів…</p>}
      {data && (
        <div className="doll-char-grid">
          {data.characters.map((c) => (
            <button key={c.id} type="button" className="card doll-char-card" onClick={() => go(c.id)}>
              <span className="doll-char-name">{c.name}</span>
              <span className="doll-char-meta">
                {isClsKey(c.cls) ? clsLabel(c.cls) : c.cls} · рівень {c.level}
              </span>
              <span className="doll-char-meta">
                речей {c.items} · сетів {c.sets} · змінено {fmtDate(c.updatedAt)}
              </span>
            </button>
          ))}
          {draftCard}
          {data.characters.length === 0 && !draft && (
            <p className="hint">Персонажів ще немає. Створи першого — або перенеси білд із PW Хелпера кнопкою «Імпорт» у редакторі.</p>
          )}
        </div>
      )}
    </>
  );
}

export default function CharacterPage({ id, onNavigate }: { id: string | null; onNavigate?: (route: Route) => void }) {
  return (
    <div className="doll-page">
      <PageMeta
        title="Персонаж — PW PvP"
        description="Лялька персонажа: спорядження, сети для свапу й характеристики — ті самі формули, що в PW Хелпері."
      />
      {id === null ? (
        <>
          <header className="section-head">
            <span className="eyebrow">Персонаж</span>
            <h2>Мої персонажі</h2>
            <p>Одягни Головний комплект і додай сети для свапу (ПЗ, ПА, спів). Формули — ті самі, що в PW Хелпері.</p>
          </header>
          <CharactersList onNavigate={onNavigate} />
        </>
      ) : id === 'new' ? (
        <DraftCharacter onNavigate={onNavigate} />
      ) : (
        <SavedCharacter key={id} id={id} onNavigate={onNavigate} />
      )}
    </div>
  );
}
