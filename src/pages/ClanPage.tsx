// =========================================================
// «Мої соклани»: /clan — збережені персонажі інших учасників клану (бекенд
// ладдера, /api/pvp/clan/characters, лише з сесією Discord); /clan/<id> —
// чужий персонаж у тому самому редакторі ляльки, але БЕЗ збереження: речі,
// камені, сети й бафи можна міняти, щоб подивитись, які будуть стати, —
// зміни живуть лише у цій вкладці (власник їх не побачить), «Скинути» повертає
// ляльку такою, як її зберіг власник. «Скопіювати собі» створює нового
// персонажа у своєму профілі з того, що зараз на екрані (разом із примірками),
// і відкриває його на /characters/<id>.
//
// Сторінка — окремий ледачий чанк, як /characters (каталог і спрайти ляльки
// важать мегабайти); лише учаснику клану — гейт у Layout (app/access.ts).
// Документ чужого персонажа — дані іншого клієнта: validateDoc, зламаний —
// пояснення замість редактора, з мʼякими зауваженнями — редактор і попередження.
// =========================================================

import { useCallback, useEffect, useMemo, useState } from 'react';
import PageMeta from '../app/PageMeta';
import { useMe } from '../app/useMe';
import type { Route } from '../app/useRoute';
import {
  CharacterApiError, createCharacter, getClanCharacter, listClanCharacters,
  type CharacterOwner, type ClanCharacterRecord, type ClanCharacterSummary,
} from '../doll/api/characters';
import { DOC_LIMITS, emptyDoc, isClsKey, validateDoc, type CharacterDoc } from '../doll/model/doc';
import { CFG_MAIN } from '../doll/model/hydrate';
import { SavePill, clsLabel } from '../doll/ui/CharBar';
import DollEditor from '../doll/ui/DollEditor';

type Nav = ((route: Route) => void) | undefined;

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const fmtDate = (iso: string): string => {
  try {
    return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
};

/** Імʼя копії, коли таке в профілі вже є: «Нік (копія)», не довше за ліміт. */
export function copyName(name: string): string {
  const suffix = ' (копія)';
  return name.slice(0, DOC_LIMITS.nameLen - suffix.length).trimEnd() + suffix;
}

/** Персонажі одного власника підряд — для заголовків груп у списку. Порядок — як віддав сервер (за ніком). */
export function groupByOwner(list: ClanCharacterSummary[]): { owner: CharacterOwner; characters: ClanCharacterSummary[] }[] {
  const groups: { owner: CharacterOwner; characters: ClanCharacterSummary[] }[] = [];
  const byId = new Map<string, (typeof groups)[number]>();
  for (const c of list) {
    let g = byId.get(c.owner.id);
    if (!g) {
      g = { owner: c.owner, characters: [] };
      byId.set(c.owner.id, g);
      groups.push(g);
    }
    g.characters.push(c);
  }
  return groups;
}

function OwnerHead({ owner, count }: { owner: CharacterOwner; count: number }) {
  return (
    <h3 className="doll-clan-owner">
      {owner.avatarUrl ? (
        <img className="doll-clan-avatar" src={owner.avatarUrl} alt="" width={28} height={28} loading="lazy" />
      ) : (
        <span className="doll-clan-avatar is-empty" aria-hidden="true">
          {owner.nickname.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span>{owner.nickname}</span>
      <span className="doll-clan-count">
        {count === 1 ? '1 персонаж' : count < 5 ? `${count} персонажі` : `${count} персонажів`}
      </span>
    </h3>
  );
}

// ── Список ────────────────────────────────────────────────────────

function ClanList({ onNavigate }: { onNavigate: Nav }) {
  const { login } = useMe();
  const [data, setData] = useState<ClanCharacterSummary[] | null>(null);
  const [err, setErr] = useState<{ code: string; text: string } | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setData((await listClanCharacters()).characters);
    } catch (e) {
      setErr({ code: e instanceof CharacterApiError ? e.code : 'internal', text: errText(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => (data ? groupByOwner(data) : []), [data]);
  const go = (id: string) => onNavigate?.({ name: 'clan-character', id });

  if (err) {
    return (
      <div className="card doll-page-notice is-warn" role="alert">
        <span>{err.code === 'unauthorized' ? 'Сесія завершилась — увійди через Discord ще раз.' : 'Не вдалося завантажити персонажів: ' + err.text}</span>
        <span className="doll-page-notice-acts">
          {err.code === 'unauthorized' ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={login}>
              Увійти через Discord
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
              Повторити
            </button>
          )}
        </span>
      </div>
    );
  }
  if (!data) return <p className="hint">Завантажую персонажів сокланів…</p>;
  if (data.length === 0) {
    return (
      <p className="hint">
        Поки ніхто із сокланів не зберіг персонажа в профіль. Коли збережуть — тут можна буде відкрити їхні ляльки.
      </p>
    );
  }

  return (
    <>
      {groups.map((g) => (
        <section key={g.owner.id} className="doll-clan-group" aria-label={`Персонажі — ${g.owner.nickname}`}>
          <OwnerHead owner={g.owner} count={g.characters.length} />
          <div className="doll-char-grid">
            {g.characters.map((c) => (
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
          </div>
        </section>
      ))}
    </>
  );
}

// ── Чужий персонаж: перегляд і примірка без збереження ─────────────

interface Loaded {
  rec: ClanCharacterRecord;
  /** Лялька такою, як її зберіг власник, — для «Скинути» й пігулки «змінено». */
  original: CharacterDoc;
  warning: string | null;
}
type LoadState = { kind: 'loading' } | { kind: 'error'; code: string; text: string } | { kind: 'ready'; data: Loaded };

function ClanCharacter({ id, onNavigate }: { id: string; onNavigate: Nav }) {
  const { login } = useMe();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [doc, setDoc] = useState<CharacterDoc>(() => emptyDoc());
  const [activeCfg, setActiveCfg] = useState(CFG_MAIN);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const rec = await getClanCharacter(id);
      const v = validateDoc(rec.doc);
      const got = v.ok ? { doc: v.doc, warning: null } : v.recoverable ? { doc: v.recoverable, warning: v.errors.slice(0, 2).join('; ') } : null;
      if (!got) {
        setState({ kind: 'error', code: 'broken', text: `Документ персонажа «${rec.name}» пошкоджено — відкрити його не вдалося.` });
        return;
      }
      setDoc(got.doc);
      setActiveCfg(CFG_MAIN);
      setState({ kind: 'ready', data: { rec, original: got.doc, warning: got.warning } });
    } catch (e) {
      setState({ kind: 'error', code: e instanceof CharacterApiError ? e.code : 'internal', text: errText(e) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const toList = () => onNavigate?.({ name: 'clan' });

  // Редактор повертає новий обʼєкт на кожну зміну, тож «змінено» = не той самий обʼєкт, що прийшов із сервера.
  const dirty = state.kind === 'ready' && doc !== state.data.original;

  const reset = () => {
    if (state.kind !== 'ready') return;
    setDoc(state.data.original);
    setActiveCfg(CFG_MAIN);
    setNotice(null);
  };

  /** Новий персонаж у своєму профілі з того, що на екрані. Зайняте імʼя — одна спроба з «(копія)». */
  const copyToMine = async () => {
    if (state.kind !== 'ready') return;
    setCopying(true);
    setNotice(null);
    const base: CharacterDoc = { ...doc, name: doc.name.trim() || state.data.rec.name };
    const tryCreate = (name: string) => createCharacter({ ...base, name });
    try {
      let rec;
      try {
        rec = await tryCreate(base.name);
      } catch (e) {
        if (e instanceof CharacterApiError && e.code === 'conflict' && /ім.?ям/i.test(e.message)) rec = await tryCreate(copyName(base.name));
        else throw e;
      }
      onNavigate?.({ name: 'character', id: rec.id });
    } catch (e) {
      if (e instanceof CharacterApiError && e.code === 'unauthorized') setNotice('Сесія завершилась — увійди через Discord ще раз.');
      else setNotice('Не вдалося скопіювати: ' + errText(e));
      setCopying(false);
    }
  };

  if (state.kind === 'loading') return <p className="hint">Завантажую персонажа…</p>;
  if (state.kind === 'error') {
    return (
      <div className="card doll-page-notice is-warn" role="alert">
        <span>{state.code === 'not_found' ? 'Персонажа не знайдено — можливо, власник його видалив.' : state.text}</span>
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
          <button type="button" className="btn btn-ghost btn-sm" onClick={toList}>
            До сокланів
          </button>
        </span>
      </div>
    );
  }

  const { rec, warning } = state.data;
  // Смужка персонажа: ліворуч «← Мої соклани», праворуч пігулка «перегляд / примірка», «Скинути», «Скопіювати собі».
  const barEnd = (
    <>
      <SavePill
        text={dirty ? 'примірка' : 'перегляд'}
        tone={dirty ? 'warn' : 'mute'}
        title={dirty ? 'Твої примірки живуть лише в цій вкладці — власник їх не побачить' : 'Лялька іншого гравця — зміни не зберігаються'}
      />
      <button type="button" className="btn btn-ghost btn-sm" disabled={!dirty || copying} title="Повернути ляльку такою, як її зберіг власник" onClick={reset}>
        Скинути
      </button>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={copying}
        title={dirty ? 'Створити нового персонажа у своєму профілі з цієї ляльки разом із твоїми примірками' : 'Створити нового персонажа у своєму профілі з цієї ляльки'}
        onClick={() => void copyToMine()}
      >
        <span className="doll-page-hint-long">{copying ? 'Копіюю…' : 'Скопіювати собі'}</span>
        <span className="doll-page-hint-short">{copying ? 'Копіюю…' : 'Копія'}</span>
      </button>
    </>
  );
  const barNote = (
    <span>
      Лялька «{rec.name}» гравця {rec.owner.nickname} · змінено {fmtDate(rec.updatedAt)}. Можна приміряти інші речі й подивитись стати — зміни лишаються
      лише в цій вкладці; «Скопіювати собі» зробить із неї нового персонажа у твоєму профілі.
    </span>
  );
  const top = (
    <>
      {warning && (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>Персонажа відкрито, але документ має зауваження: {warning}.</span>
        </div>
      )}
      {notice && (
        <div className="card doll-page-notice is-warn" role="alert">
          <span>{notice}</span>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Закрити" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}
    </>
  );

  return (
    <DollEditor
      value={doc}
      onChange={setDoc}
      activeCfg={activeCfg}
      onActiveCfg={setActiveCfg}
      barStart={
        <button type="button" className="doll-bar-back" aria-label="Мої соклани" title="До списку «Мої соклани»" onClick={toList}>
          <span aria-hidden="true">←</span>
          <span className="doll-bar-back-t" aria-hidden="true">
            Мої соклани
          </span>
        </button>
      }
      barEnd={barEnd}
      barNote={barNote}
      top={top}
    />
  );
}

export default function ClanPage({ id, onNavigate }: { id: string | null; onNavigate?: (route: Route) => void }) {
  return (
    <div className="doll-page">
      <PageMeta title="Мої соклани — PW PvP" description="Ляльки персонажів сокланів: подивитись спорядження й стати, приміряти інші речі, скопіювати собі." />
      {id === null ? (
        <>
          <header className="section-head">
            <span className="eyebrow">Персонаж</span>
            <h2>Мої соклани</h2>
            <p>Збережені ляльки інших учасників клану. Відкрий будь-яку, щоб побачити спорядження й стати, приміряти інші речі або скопіювати собі в нову ляльку.</p>
          </header>
          <ClanList onNavigate={onNavigate} />
        </>
      ) : (
        <ClanCharacter key={id} id={id} onNavigate={onNavigate} />
      )}
    </div>
  );
}
