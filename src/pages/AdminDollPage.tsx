// =========================================================
// Адмінка: лялька із заявки (/admin/doll/:registrationId). Знімок персонажа
// (registrations.character_snapshot, 0028) відкривається в редакторі ляльки
// лише для перегляду: адмін бачить спорядження, сети, джина й «Готовність»
// такими, якими їх подав гравець у мить заявки, — не поточного персонажа
// (його лялька відтоді могла змінитись). Сюди веде «Переглянути ляльку» з
// картки заявки (RegistrationsPanel), назад — «← до заявок» у смужці.
//
// Сторінка — окремий ледачий чанк, як /characters (каталог і спрайти ляльки
// важать мегабайти); лише для адміна — гейт у Layout (app/access.ts). Правки
// нікуди не пишуться: редактор readOnly, зміни (режим «У бою» тощо) живуть у
// стані сторінки. Знімок — недовірені дані клієнта: validateDoc, зламаний —
// пояснення замість редактора, з мʼякими зауваженнями — редактор і попередження.
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '../app/errorMessage';
import PageMeta from '../app/PageMeta';
import type { Route } from '../app/useRoute';
import { fetchRegistration, fetchTournament } from '../data/tournaments';
import type { Registration } from '../data/types';
import { validateDoc, type CharacterDoc } from '../doll/model/doc';
import { CFG_MAIN } from '../doll/model/hydrate';
import DollEditor from '../doll/ui/DollEditor';

/** Документ зі знімка заявки: знімка немає / пошкоджений (reason) / відкрито
 * (warning — мʼякі зауваження validateDoc, редактор його все одно показує). */
export type SnapshotDoc = { kind: 'none' } | { kind: 'broken'; reason: string } | { kind: 'ok'; doc: CharacterDoc; warning: string | null };

export function snapshotDoc(raw: unknown): SnapshotDoc {
  if (raw == null) return { kind: 'none' };
  const v = validateDoc(raw);
  if (v.ok) return { kind: 'ok', doc: v.doc, warning: null };
  const reason = v.errors.slice(0, 2).join('; ');
  return v.recoverable ? { kind: 'ok', doc: v.recoverable, warning: reason } : { kind: 'broken', reason };
}

/** «1 жовтня 2026, 19:05» — коли подано заявку. */
function fmtWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface Loaded {
  reg: Registration;
  /** Назва турніру заявки; null — не завантажилась (підпис без неї). */
  tournamentName: string | null;
  doc: CharacterDoc;
  warning: string | null;
}
type LoadState = { kind: 'loading' } | { kind: 'error'; text: string; retry: boolean } | { kind: 'ready'; data: Loaded };

export default function AdminDollPage({ id, onNavigate }: { id: string; onNavigate?: (route: Route) => void }) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [activeCfg, setActiveCfg] = useState(CFG_MAIN);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const reg = await fetchRegistration(id);
      if (!reg) {
        setState({ kind: 'error', text: 'Заявку не знайдено — можливо, її видалено.', retry: false });
        return;
      }
      const snap = snapshotDoc(reg.characterSnapshot);
      if (snap.kind === 'none') {
        setState({ kind: 'error', text: `У заявці «${reg.nickname}» немає знімка ляльки — її подано анкетою, а не персонажем.`, retry: false });
        return;
      }
      if (snap.kind === 'broken') {
        setState({ kind: 'error', text: `Знімок ляльки в заявці «${reg.nickname}» пошкоджено (${snap.reason}) — відкрити його не вдалося.`, retry: false });
        return;
      }
      // Назва турніру — лише для підпису: не завантажилась — підпис без неї.
      const tournament = await fetchTournament(reg.tournamentId).catch(() => null);
      setActiveCfg(CFG_MAIN);
      setState({ kind: 'ready', data: { reg, tournamentName: tournament?.name ?? null, doc: snap.doc, warning: snap.warning } });
    } catch (e) {
      setState({ kind: 'error', text: errorMessage(e, 'Не вдалося завантажити заявку.'), retry: true });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  // Редактор readOnly нічого не змінює в документі, але стан перегляду (режим
  // статів, суперник) живе в ньому — тримаємо документ у стані сторінки, як /dev/doll.
  const setDoc = (doc: CharacterDoc) => setState((s) => (s.kind === 'ready' ? { kind: 'ready', data: { ...s.data, doc } } : s));
  const toAdmin = () => onNavigate?.({ name: 'admin' });

  let body;
  if (state.kind === 'loading') body = <p className="hint">Завантажую заявку…</p>;
  else if (state.kind === 'error') {
    body = (
      <div className="card doll-page-notice is-warn" role="alert">
        <span>{state.text}</span>
        <span className="doll-page-notice-acts">
          {state.retry && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void load()}>
              Повторити
            </button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={toAdmin}>
            До заявок
          </button>
        </span>
      </div>
    );
  } else {
    const { reg, tournamentName, doc, warning } = state.data;
    body = (
      <DollEditor
        value={doc}
        onChange={setDoc}
        readOnly
        activeCfg={activeCfg}
        onActiveCfg={setActiveCfg}
        barStart={
          <button type="button" className="doll-bar-back" onClick={toAdmin}>
            ← до заявок
          </button>
        }
        barEnd={<span className="badge mute">лише перегляд</span>}
        barNote={
          <span>
            Знімок ляльки із заявки «{reg.nickname}» · турнір «{tournamentName ?? '—'}» · подано {fmtWhen(reg.createdAt)}
          </span>
        }
        top={
          warning ? (
            <div className="card doll-page-notice is-warn" role="alert">
              <span>Знімок відкрито, але документ має зауваження: {warning}.</span>
            </div>
          ) : null
        }
      />
    );
  }

  const nick = state.kind === 'ready' ? ` «${state.data.reg.nickname}»` : '';
  return (
    <div className="doll-page">
      <PageMeta title={`Лялька із заявки${nick} — Адмінка PW PvP`} />
      {body}
    </div>
  );
}
