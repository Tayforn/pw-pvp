// =========================================================
// Адмінка: логін (Supabase Auth, спільний з pw-events) + керування
// серіями, турнірами, верифікацією заявок, сіткою і ГМ-акаунтами.
//
// Ролі: 'superadmin' бачить/керує ВСІМА турнірами; 'gm' — лише своїми
// (created_by), і його турніри не показуються на публічних сторінках
// (видно лише за прямим посиланням — див. data/tournaments.ts).
// =========================================================

import { useEffect, useState } from 'react';
import { supabase } from '../app/supabaseClient';
import { useAuth } from '../app/useAuth';
import { reportError } from '../app/errorMessage';
import PageMeta from '../app/PageMeta';
import type { Tournament, TournamentSeries } from '../data/types';
import { STATUS_LABELS, effectiveStatus, isRegistrationOpen } from '../data/types';
import { deleteTournament, fetchAdminTournaments, subscribeToTournamentChanges } from '../data/tournaments';
import SeriesManager from './admin/SeriesManager';
import TournamentEditor from './admin/TournamentEditor';
import RegistrationsPanel from './admin/RegistrationsPanel';
import BracketPanel from './admin/BracketPanel';
import AdminsManager from './admin/AdminsManager';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setErr(error.message);
    setBusy(false);
  };

  return (
    <div className="card" style={{ maxWidth: 380, margin: '40px auto' }}>
      <div className="section-head" style={{ marginBottom: 16 }}>
        <span className="eyebrow">Адмінка</span>
        <h2>Вхід</h2>
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} required onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Пароль</span>
          <input type="password" value={password} required onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <p className="form-err">{err}</p>}
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Вхід…' : 'Увійти'}</button>
      </form>
    </div>
  );
}

function copyLink(path: string) {
  const url = window.location.origin + import.meta.env.BASE_URL + path;
  navigator.clipboard?.writeText(url);
}

function TournamentRow({
  t,
  seriesName,
  expanded,
  onToggleExpand,
  onEdit,
  onDelete,
}: {
  t: Tournament;
  seriesName: (id: string | null) => string;
  expanded: boolean;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--line)' }}>
      <div
        style={{
          // Усі колонки, крім назви/серії, ФІКСОВАНОЇ ширини (не auto) —
          // інакше ширина "auto"-колонки залежить від її вмісту В ЦЬОМУ рядку
          // (напр. посилань-кнопок: 1 чи 2, залежно від статусу), і та сама
          // колонка в різних рядках рендериться різної ширини — таблиця
          // "їде". auto тут ніколи не було насправді безпечним для вирівнювання.
          // Колонка посилань — 100px: 2 кнопки-іконки (🔗📝) з .btn-sm
          // padding (7px 12px) реально потребують ~85-90px, 60px замало.
          display: 'grid',
          gridTemplateColumns: '28px minmax(160px,2fr) 104px minmax(100px,1fr) 170px 100px 110px 95px',
          gap: 10,
          alignItems: 'center',
          padding: '10px 18px',
        }}
      >
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleExpand} style={{ padding: '4px 8px' }}>
          {expanded ? '▾' : '▸'}
        </button>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
        <span className="hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{t.eventDate}</span>
        <span className="hint" style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {seriesName(t.seriesId)}
          {t.teamSize ? ` · команди×${t.teamSize}` : ''}
        </span>
        <span className={'badge ' + (effectiveStatus(t) === 'completed' ? 'good' : effectiveStatus(t) === 'cancelled' ? 'bad' : 'warn')} style={{ whiteSpace: 'nowrap' }}>
          {t.visibility === 'unlisted' ? '🔒 ' : ''}
          {STATUS_LABELS[effectiveStatus(t)]}
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="btn btn-ghost btn-sm" title="Копіювати посилання на сторінку турніру" onClick={() => copyLink('t/' + t.id)}>🔗</button>
          {isRegistrationOpen(t) && (
            <button type="button" className="btn btn-ghost btn-sm" title="Копіювати посилання на реєстрацію" onClick={() => copyLink('register?t=' + t.id)}>📝</button>
          )}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>Редагувати</button>
        <button type="button" className="btn btn-bad btn-sm" onClick={onDelete}>Видалити</button>
      </div>
      {expanded && (
        <div style={{ padding: '4px 18px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div>
            <h4>Заявки</h4>
            <RegistrationsPanel tournamentId={t.id} />
          </div>
          <div>
            <h4>Сітка</h4>
            <BracketPanel tournament={t} />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, items, defaultOpen, render }: { title: string; items: Tournament[]; defaultOpen: boolean; render: (t: Tournament) => React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px',
          background: 'transparent', border: 0, cursor: 'pointer', color: 'var(--text)', fontWeight: 700, fontSize: 15, textAlign: 'left',
        }}
      >
        <span>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        <span className="badge mute">{items.length}</span>
      </button>
      {open && (items.length === 0 ? <p className="hint" style={{ padding: '0 18px 16px' }}>Порожньо.</p> : <div>{items.map(render)}</div>)}
    </div>
  );
}

function TournamentsAdmin({ series, currentUserId, isSuperadmin }: { series: TournamentSeries[]; currentUserId: string; isSuperadmin: boolean }) {
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [editing, setEditing] = useState<Tournament | 'new' | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const reload = () => fetchAdminTournaments(currentUserId, isSuperadmin).then(setTournaments);
  useEffect(() => {
    reload();
    return subscribeToTournamentChanges(reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, isSuperadmin]);

  const seriesName = (id: string | null) => series.find((s) => s.id === id)?.name ?? '—';

  // "Активні" враховує дату, не лише статус: registration_open/closed з датою
  // в минулому (адмін не перевів статус далі вручну) — це вже "Минулі", а не
  // "Активні". in_progress лишається активним завжди, незалежно від дати.
  const today = new Date().toISOString().slice(0, 10);
  const isPastDated = (t: Tournament) => t.eventDate < today;
  const isOpenish = (t: Tournament) => t.status === 'registration_open' || t.status === 'registration_closed';

  const drafts = tournaments.filter((t) => t.status === 'draft');
  const active = tournaments.filter((t) => t.status === 'in_progress' || (isOpenish(t) && !isPastDated(t)));
  const past = tournaments.filter((t) => t.status === 'completed' || t.status === 'cancelled' || (isOpenish(t) && isPastDated(t)));

  const renderRow = (t: Tournament) => (
    <TournamentRow
      key={t.id}
      t={t}
      seriesName={seriesName}
      expanded={expandedId === t.id}
      onToggleExpand={() => setExpandedId(expandedId === t.id ? null : t.id)}
      onEdit={() => setEditing(t)}
      onDelete={() => confirm(`Видалити турнір «${t.name}»?`) && deleteTournament(t.id).then(reload).catch(reportError)}
    />
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Турніри</h3>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>+ Новий турнір</button>
      </div>

      {tournaments.length === 0 ? (
        <p className="hint">Турнірів ще немає.</p>
      ) : (
        <>
          <Section title="Активні" items={active} defaultOpen render={renderRow} />
          <Section title="Чернетки" items={drafts} defaultOpen={false} render={renderRow} />
          <Section title="Минулі" items={past} defaultOpen={false} render={renderRow} />
        </>
      )}

      {editing && (
        <TournamentEditor
          initial={editing === 'new' ? null : editing}
          series={series}
          isSuperadmin={isSuperadmin}
          currentUserId={currentUserId}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </div>
  );
}

export default function AdminPage({ series }: { series: TournamentSeries[] }) {
  const { session, isAdmin, role, loading } = useAuth();

  if (loading) return <p className="hint">Перевірка сесії…</p>;
  if (!session) return <LoginForm />;
  if (!isAdmin || !role) {
    return (
      <div className="card">
        <p>Цей акаунт не має прав адміністратора.</p>
        <button type="button" className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Вийти</button>
      </div>
    );
  }

  const isSuperadmin = role === 'superadmin';

  return (
    <div>
      <PageMeta title="Адмінка — PW PvP" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="section-head">
        <div>
          <span className="eyebrow">Адмінка · {isSuperadmin ? 'Суперадмін' : 'ГМ'}</span>
          <h2>Керування турнірами</h2>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Вийти</button>
      </div>
      {isSuperadmin && (
        <div style={{ marginBottom: 32 }}>
          <SeriesManager series={series} onChanged={() => {}} />
        </div>
      )}
      <TournamentsAdmin series={series} currentUserId={session.user.id} isSuperadmin={isSuperadmin} />
      {isSuperadmin && (
        <div style={{ marginTop: 32 }}>
          <AdminsManager currentUserId={session.user.id} />
        </div>
      )}
    </div>
  );
}
