// =========================================================
// Звірка зі скріншотами: /check — вибір персонажа, /check/<id> — сама звірка
// ('new' — чернетка в браузері, інакше збережений персонаж). Гравець кидає
// скріншоти вікна спорядження і вікна «Персонаж» (Ctrl+V, перетягування або
// файл, у будь-якому порядку) — сторінка показує, який комплект надіто, які
// речі в ньому не ті і чи дає лялька ті самі числа, що гра.
//
// Ляльку зі скріншотів не збирає: заточок, каменів і ролів на них не видно.
// Єдина зміна, яку вона робить, — надіває в комплект річ, що вже є в інвентарі
// ляльки, і лише після «Зберегти». Розпізнавання йде в браузері, скріншоти
// нікуди не надсилаються.
//
// Окремий ледачий чанк, як і лялька: каталог і спрайти важать мегабайти.
// =========================================================

import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useLeaveGuard } from '../app/leaveGuard';
import PageMeta from '../app/PageMeta';
import { useMe } from '../app/useMe';
import type { Route } from '../app/useRoute';
import { CharacterApiError, getCharacter, listCharacters, updateCharacter, type CharacterSummary } from '../doll/api/characters';
import { browserStorage, draftKey, loadDraft, saveDraft } from '../doll/api/draft';
import { isStaleDataError, useCatalog } from '../doll/data/catalog';
import { useRefData } from '../doll/data/refLoader';
import { isClsKey, validateDoc, type CharacterDoc, type SlotKey } from '../doll/model/doc';
import { SCAN_CATS, blobToRaster, loadScanSource, slotThumbs } from '../doll/scan/browser';
import type { EquipScan } from '../doll/scan/equip';
import type { Raster } from '../doll/scan/raster';
import { applyFix } from '../doll/scan/reconcile';
import { readShots } from '../doll/scan/session';
import type { StatsScan } from '../doll/scan/stats';
import CheckReport from '../doll/scan/ui/CheckReport';
import { clsLabel } from '../doll/ui/CharBar';
import '../doll/ui/doll.css';
import '../doll/scan/ui/check.css';

type Nav = ((route: Route) => void) | undefined;

const DRAFT_ID = 'new';
/** Каталоги для звіту: речі всіх слотів плюс камені, руни й кристали надітих речей. */
const REPORT_CATS = [...SCAN_CATS, 'ob', 'wdf', 'crystal'];
/** Скільки чисел читає сканер у вікні «Персонаж». */
const STAT_FIELDS = 27;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** Дати браузеру перемалювати сторінку перед довгим синхронним шматком роботи.
 * Таймер, а не requestAnimationFrame: у фоновій вкладці кадри не малюються, і розпізнавання зависло б. */
const paint = (): Promise<void> => new Promise((done) => setTimeout(done, 30));

// ── Вибір персонажа ───────────────────────────────────────────────

function draftSummary(): { name: string; items: number } | null {
  const d = loadDraft(draftKey('anon', DRAFT_ID), browserStorage()).doc;
  return d && d.items.length > 0 ? { name: d.name, items: d.items.length } : null;
}

function Picker({ onNavigate }: { onNavigate: Nav }) {
  const { me, loading: meLoading, login } = useMe();
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft] = useState(draftSummary);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setList((await listCharacters()).characters);
    } catch (e) {
      setErr(errText(e));
    }
  }, []);
  useEffect(() => {
    if (me) void load();
  }, [me, load]);

  const go = (id: string) => onNavigate?.({ name: 'check', id });
  if (meLoading) return <p className="hint">Перевірка входу…</p>;

  const draftCard = draft && (
    <button type="button" className="card doll-char-card is-draft" onClick={() => go(DRAFT_ID)}>
      <span className="doll-char-name">{draft.name || 'Персонаж без імені'}</span>
      <span className="doll-char-meta">чернетка в цьому браузері · речей {draft.items}</span>
    </button>
  );
  const nothing = !draft && (!me || (list !== null && list.length === 0));
  return (
    <>
      {!me && (
        <div className="card doll-page-notice">
          <span>Без входу звірити можна лише чернетку з цього браузера. Збережені персонажі — після входу через Discord.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={login}>
            Увійти через Discord
          </button>
        </div>
      )}
      {err && (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>Не вдалося завантажити персонажів: {err}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
            Повторити
          </button>
        </div>
      )}
      {me && !list && !err && <p className="hint">Завантажую персонажів…</p>}
      {nothing ? (
        <div className="card doll-page-notice">
          <span>Звіряти поки нема з чим: спершу збери персонажа в ляльці.</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate?.({ name: 'characters' })}>
            До ляльки
          </button>
        </div>
      ) : (
        <div className="doll-char-grid">
          {(list ?? []).map((c) => (
            <button key={c.id} type="button" className="card doll-char-card" onClick={() => go(c.id)}>
              <span className="doll-char-name">{c.name}</span>
              <span className="doll-char-meta">
                {isClsKey(c.cls) ? clsLabel(c.cls) : c.cls} · рівень {c.level}
              </span>
              <span className="doll-char-meta">
                речей {c.items} · сетів {c.sets}
              </span>
            </button>
          ))}
          {draftCard}
        </div>
      )}
    </>
  );
}

// ── Звірка одного персонажа ───────────────────────────────────────

type LoadState = { kind: 'loading' } | { kind: 'error'; code: string; text: string } | { kind: 'ready' };

interface ShotInfo<T> {
  scan: T;
  /** Адреса знімка для попереднього перегляду (object URL). */
  url: string;
}

function Checker({ id, onNavigate }: { id: string; onNavigate: Nav }) {
  const isDraft = id === DRAFT_ID;
  const { me, loading: meLoading, login } = useMe();
  // Чернетку читаємо одразу (вона в браузері); збереженого персонажа — із сервера після входу.
  const [draftAtOpen] = useState(() => (isDraft ? loadDraft(draftKey('anon', DRAFT_ID), browserStorage()).doc : null));
  const [state, setState] = useState<LoadState>(() =>
    !isDraft ? { kind: 'loading' } : draftAtOpen ? { kind: 'ready' } : { kind: 'error', code: 'no_draft', text: 'У цьому браузері немає чернетки персонажа.' },
  );
  const [saved, setSaved] = useState<CharacterDoc | null>(draftAtOpen);
  const [doc, setDoc] = useState<CharacterDoc | null>(draftAtOpen);
  const [revision, setRevision] = useState(0);
  const [stats, setStats] = useState<ShotInfo<StatsScan> | null>(null);
  const [equip, setEquip] = useState<(ShotInfo<EquipScan> & { thumbs: Partial<Record<SlotKey, string>> }) | null>(null);
  const [cfgId, setCfgId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  // Обробник вставки живе довше за один рендер — читає найсвіжіший стан через ref.
  const live = useRef({ doc, stats, busy });
  live.current = { doc, stats, busy };

  const ref = useRefData();
  const cat = useCatalog(REPORT_CATS);
  const dataReady = ref.ready && cat.ready;
  const dataError = ref.error || cat.error;

  const dirty = !!doc && !!saved && doc !== saved;
  const releaseGuard = useLeaveGuard(dirty ? 'Заміни речей не збережено в ляльку. Піти зі сторінки?' : null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const rec = await getCharacter(id);
      const v = validateDoc(rec.doc);
      const got = v.ok ? v.doc : v.recoverable;
      if (!got) {
        setState({ kind: 'error', code: 'broken', text: 'Документ персонажа пошкоджено — його не вдалося відкрити.' });
        return;
      }
      setSaved(got);
      setDoc(got);
      setRevision(rec.revision);
      setState({ kind: 'ready' });
    } catch (e) {
      setState({ kind: 'error', code: e instanceof CharacterApiError ? e.code : 'internal', text: errText(e) });
    }
  }, [id]);

  useEffect(() => {
    if (isDraft || meLoading) return;
    if (!me) {
      setState({ kind: 'error', code: 'unauthorized', text: 'Збережених персонажів видно лише після входу через Discord.' });
      return;
    }
    void load();
  }, [isDraft, me, meLoading, load]);

  useEffect(() => {
    const made = urls.current;
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  /** Розпізнати нові знімки й розкласти результат по двох «місцях»: спорядження і характеристики. */
  const addShots = useCallback(async (blobs: Blob[]) => {
    const cur = live.current;
    if (!blobs.length || !cur.doc || cur.busy) return;
    const fails: string[] = [];
    try {
      setBusy('Відкриваю скріншот…');
      await paint();
      const shots: Array<{ raster: Raster; url: string }> = [];
      for (const blob of blobs) {
        try {
          const raster = await blobToRaster(blob);
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          shots.push({ raster, url });
        } catch (e) {
          fails.push(errText(e));
        }
      }
      if (shots.length) {
        setBusy('Завантажую іконки речей…');
        const src = await loadScanSource();
        setBusy('Розпізнаю…');
        await paint();
        const d = cur.doc;
        const reads = readShots(
          shots.map((s) => s.raster),
          src,
          { gender: d.gender, cls: d.cls, level: d.level, scale: cur.stats?.scan.scale },
        );
        reads.forEach((read, i) => {
          if (read.stats) setStats({ scan: read.stats, url: shots[i].url });
          if (read.equip) setEquip({ scan: read.equip, url: shots[i].url, thumbs: slotThumbs(shots[i].raster, read.equip) });
          if (!read.stats && !read.equip) fails.push('На знімку не знайшов ні вікна спорядження, ні вікна «Персонаж». ' + read.reasons.join(' '));
        });
        // Нові скріншоти — комплект визначаємо заново.
        if (reads.some((r) => r.equip || r.stats)) setCfgId(null);
      }
    } catch (e) {
      fails.push('Не вдалося розпізнати: ' + errText(e));
    } finally {
      setProblems(fails);
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'));
      if (!files.length) return;
      e.preventDefault();
      void addShots(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addShots]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void addShots(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/')));
  };

  const save = async () => {
    if (!doc) return;
    setSaving(true);
    setNotice(null);
    try {
      if (isDraft) {
        if (!saveDraft(draftKey('anon', DRAFT_ID), doc)) throw new Error('сховище браузера недоступне або заповнене');
      } else {
        const rec = await updateCharacter(id, doc, revision);
        setRevision(rec.revision);
      }
      setSaved(doc);
      setNotice('Зміни збережено в ляльку.');
    } catch (e) {
      const conflict = e instanceof CharacterApiError && e.code === 'conflict';
      setNotice(
        conflict
          ? 'Цього персонажа тим часом змінено в іншій вкладці чи на іншому пристрої. Онови сторінку й повтори заміни.'
          : 'Не вдалося зберегти: ' + errText(e),
      );
    } finally {
      setSaving(false);
    }
  };

  const toPicker = () => onNavigate?.({ name: 'check' });
  const toDoll = () => onNavigate?.({ name: 'character', id });

  if (state.kind === 'loading') return <p className="hint">Завантажую персонажа…</p>;
  if (state.kind === 'error' || !doc) {
    const code = state.kind === 'error' ? state.code : 'broken';
    return (
      <div className="card doll-page-notice is-warn" role="alert">
        <span>{code === 'not_found' ? 'Персонажа не знайдено — можливо, його видалено.' : state.kind === 'error' ? state.text : ''}</span>
        <span className="doll-page-notice-acts">
          {code === 'unauthorized' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={login}>
              Увійти через Discord
            </button>
          )}
          {code !== 'unauthorized' && code !== 'not_found' && code !== 'broken' && code !== 'no_draft' && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
              Повторити
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={toPicker}>
            До вибору персонажа
          </button>
        </span>
      </div>
    );
  }

  const recognized = equip ? Object.values(equip.scan.slots).filter((s) => s.state === 'item').length : 0;
  const read = stats ? Object.keys(stats.scan.values).length : 0;

  return (
    <div className="chk">
      <div className="card chk-bar">
        <button type="button" className="doll-bar-back" aria-label="Інший персонаж" onClick={toPicker}>
          <span aria-hidden="true">←</span>
          <span className="doll-bar-back-t" aria-hidden="true">
            Інший персонаж
          </span>
        </button>
        <span className="chk-bar-name">{doc.name || 'Персонаж без імені'}</span>
        <span className="chk-bar-meta">
          {clsLabel(doc.cls)} · рівень {doc.level}
          {isDraft ? ' · чернетка в цьому браузері' : ''}
        </span>
        <span className="chk-bar-end">
          {dirty && (
            <>
              <span className="doll-save-pill warn" role="status">
                заміни не збережено
              </span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setDoc(saved)}>
                Скасувати
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={() => void save()}>
                {saving ? 'Зберігаю…' : 'Зберегти в ляльку'}
              </button>
            </>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              // Заміни вже збережено або їх немає — застереження не потрібне; інакше спитає роутер.
              if (!dirty) releaseGuard();
              toDoll();
            }}
          >
            Відкрити ляльку
          </button>
        </span>
      </div>

      {notice && (
        <div className="card doll-page-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Закрити" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <section className="card chk-card">
        <div className="chk-head">
          <h3>Скріншоти</h3>
          <span className="hint">Розпізнаються в браузері й нікуди не надсилаються.</span>
        </div>
        <div
          className={'chk-drop' + (over ? ' is-over' : '')}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
        >
          {busy ? (
            <span className="chk-busy" role="status">
              {busy}
            </span>
          ) : (
            <>
              <span>
                Встав скріншот — <kbd>Ctrl</kbd> + <kbd>V</kbd>, перетягни сюди або вибери файл. Можна обидва одразу, у будь-якому порядку.
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()}>
                Вибрати файли
              </button>
            </>
          )}
          <input
            ref={fileRef}
            className="chk-file"
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-label="Файли скріншотів"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void addShots(files);
            }}
          />
        </div>
        {problems.map((p, i) => (
          <p key={i} className="form-err" role="alert">
            {p}
          </p>
        ))}
        <div className="chk-shots">
          <div className={'chk-shot' + (equip ? '' : ' is-empty')}>
            <span className="chk-shot-h">
              Вікно спорядження
              {equip && (
                <button type="button" className="chk-x" aria-label="Прибрати скріншот спорядження" onClick={() => setEquip(null)}>
                  ✕
                </button>
              )}
            </span>
            {equip ? (
              <>
                <span className="chk-shot-s">
                  впізнано речей: {recognized} · масштаб інтерфейсу {equip.scan.scale.toFixed(2)}
                </span>
                <img src={equip.url} alt="Скріншот спорядження" />
              </>
            ) : (
              <span className="chk-shot-s">ще немає — показує, які речі надіто</span>
            )}
          </div>
          <div className={'chk-shot' + (stats ? '' : ' is-empty')}>
            <span className="chk-shot-h">
              Вікно «Персонаж»
              {stats && (
                <button type="button" className="chk-x" aria-label="Прибрати скріншот характеристик" onClick={() => setStats(null)}>
                  ✕
                </button>
              )}
            </span>
            {stats ? (
              <>
                <span className="chk-shot-s">
                  прочитано чисел: {read} з {STAT_FIELDS}
                </span>
                <img src={stats.url} alt="Скріншот вікна «Персонаж»" />
              </>
            ) : (
              <span className="chk-shot-s">ще немає — показує, чи збігаються характеристики</span>
            )}
          </div>
        </div>
        <ul className="chk-tips">
          <li>Знімай без бафів і їжі: лялька рахує чисті характеристики.</li>
          <li>Вікна мають бути видні цілком, не перекриті іншими. Найкраще — вирізати саме вікно (Win + Shift + S).</li>
          <li>Скріншот не стискай і не збільшуй: цифри читаються лише в рідному розмірі.</li>
        </ul>
      </section>

      {dataError ? (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>{isStaleDataError(dataError) ? 'Сайт оновився — сторінку треба завантажити заново.' : 'Не вдалося завантажити каталог речей: ' + dataError}</span>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              if (isStaleDataError(dataError)) location.reload();
              else {
                ref.retry();
                cat.retry();
              }
            }}
          >
            {isStaleDataError(dataError) ? 'Перезавантажити' : 'Повторити'}
          </button>
        </div>
      ) : !dataReady ? (
        <p className="hint">Завантажую каталог речей…</p>
      ) : (
        <CheckReport
          doc={doc}
          equip={equip?.scan ?? null}
          stats={stats?.scan ?? null}
          cfgId={cfgId}
          onCfg={setCfgId}
          onFix={(cfg, slot, iid) => setDoc((d) => (d ? applyFix(d, cfg, slot, iid) : d))}
          thumbs={equip?.thumbs}
        />
      )}
    </div>
  );
}

export default function CheckPage({ id, onNavigate }: { id: string | null; onNavigate?: (route: Route) => void }) {
  return (
    <div className="doll-page">
      <PageMeta
        title="Звірка зі скріншотами — PW PvP"
        description="Перевір, чи лялька відповідає персонажу в грі: за скріншотами вікна спорядження і вікна «Персонаж»."
      />
      <header className="section-head">
        <span className="eyebrow">Персонаж</span>
        <h2>Звірка зі скріншотами</h2>
        <p>
          Два скріншоти з гри — вікно спорядження і вікно «Персонаж» — покажуть, чи лялька відповідає персонажу: який комплект надіто, які речі не ті
          і чи збігаються характеристики.
        </p>
      </header>
      {id === null ? <Picker onNavigate={onNavigate} /> : <Checker key={id} id={id} onNavigate={onNavigate} />}
    </div>
  );
}
