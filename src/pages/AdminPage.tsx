// =========================================================
// Адмінка: логін (Supabase Auth, спільний з pw-events) + вкладки з адресою
// в URL (/admin/<tab>, див. app/useRoute.ts): турніри (заявки, команди,
// сітка), учасники, звіт балансу, версія шкали на двох вкладках зі спільною
// чернеткою («Шкала балів» / «Бафи й склад»), довідник рядків правил і
// ГМ-акаунти.
// Керування серіями прибрано з UI (див. коментар у TournamentEditor.tsx) —
// SeriesManager.tsx лишається в коді, просто не рендериться тут.
//
// Ролі: 'superadmin' бачить/керує ВСІМА турнірами й усі вкладки; 'gm' — лише
// своїми турнірами (created_by) і три перші вкладки; його турніри не
// показуються на публічних сторінках (видно лише за прямим посиланням —
// див. data/tournaments.ts). Перевірка ролі тут — лише для UI, справжній
// захист — RLS/RPC у базі.
// =========================================================

import { useEffect, useState } from 'react';
import { supabase } from '../app/supabaseClient';
import { useAuth } from '../app/useAuth';
import { reportError } from '../app/errorMessage';
import PageMeta from '../app/PageMeta';
import { ADMIN_TABS, routeUrl, type AdminTab } from '../app/useRoute';
import type { Tournament, TournamentSeries } from '../data/types';
import { STATUS_LABELS, effectiveStatus, isBalancedRandom, isRegistrationOpen } from '../data/types';
import { deleteTournament, fetchAdminTournaments, subscribeToTournamentChanges } from '../data/tournaments';
import TournamentEditor from './admin/TournamentEditor';
import RegistrationsPanel from './admin/RegistrationsPanel';
import TeamsPanel from './admin/TeamsPanel';
import BracketPanel from './admin/BracketPanel';
import AdminsManager from './admin/AdminsManager';
import ParticipantsManager from './admin/ParticipantsManager';
import BalanceReport from './admin/BalanceReport';
import AdminTabs, { ADMIN_TAB_TITLES } from './admin/AdminTabs';
import ScaleTab from './admin/ScaleTab';
import TeamTab from './admin/TeamTab';
import RulesFooter from './admin/RulesFooter';
import { RuleCatalogTab } from './admin/RuleCatalogTab';

/** ГМ бачить лише свої турніри, учасників і звіт; решта (версія шкали,
 * довідник правил, ГМ-акаунти) — глобальні для всіх турнірів, тому суперадмін. */
const GM_TABS: readonly AdminTab[] = ['tournaments', 'participants', 'report'];

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
          {isBalancedRandom(t) ? ` · фул-рандом×${t.teamSize}` : t.teamSize ? ` · команди×${t.teamSize}` : ''}
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
            <RegistrationsPanel tournament={t} />
          </div>
          {isBalancedRandom(t) && (
            // Блок між заявками й сіткою — лише для фул-рандому: сітка
            // генерується з team-рядків, які затверджуються тут.
            <div>
              <h4>Команди</h4>
              <TeamsPanel tournament={t} />
            </div>
          )}
          <div>
            <h4>Сітка</h4>
            <BracketPanel tournament={t} />
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, items, open, onToggle, render }: { title: string; items: Tournament[]; open: boolean; onToggle: () => void; render: (t: Tournament) => React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <button
        type="button"
        onClick={onToggle}
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
  // Стан розгорнутих груп живе тут (а не всередині Section) і рендериться
  // БЕЗУМОВНО (без tournaments.length === 0 ? … перемикання гілок нижче) —
  // інакше живий рефетч (subscribeToTournamentChanges) міг би на мить
  // розмонтувати Section і скинути розгорнутий стан груп/заявок.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Активні: true,
    Чернетки: false,
    Минулі: false,
  });
  const toggleSection = (title: string) => setOpenSections((s) => ({ ...s, [title]: !s[title] }));

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

      <Section title="Активні" items={active} open={openSections.Активні} onToggle={() => toggleSection('Активні')} render={renderRow} />
      <Section title="Чернетки" items={drafts} open={openSections.Чернетки} onToggle={() => toggleSection('Чернетки')} render={renderRow} />
      <Section title="Минулі" items={past} open={openSections.Минулі} onToggle={() => toggleSection('Минулі')} render={renderRow} />

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

export default function AdminPage({ series, tab, onTab }: { series: TournamentSeries[]; tab?: AdminTab; onTab: (tab: AdminTab) => void }) {
  const { session, isAdmin, role, loading } = useAuth();
  const isSuperadmin = role === 'superadmin';
  const tabs = isSuperadmin ? ADMIN_TABS : GM_TABS;
  // Недозволена для ролі вкладка (ГМ відкрив /admin/scale) → «Турніри»; URL
  // підправляємо без нового запису в історії, щоб «Назад» не повертав на неї.
  const active: AdminTab = tab && tabs.includes(tab) ? tab : 'tournaments';
  useEffect(() => {
    if (role && tab && tab !== active) history.replaceState(null, '', routeUrl({ name: 'admin' }));
  }, [role, tab, active]);

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

  let body;
  switch (active) {
    case 'participants': body = <ParticipantsManager />; break;
    case 'report': body = <BalanceReport />; break;
    // «Шкала балів» і «Бафи й склад» редагують ОДНУ чернетку версії
    // (data/rulesDraftStore), тому футер зі збереженням спільний.
    case 'scale': body = <><ScaleTab /><RulesFooter /></>; break;
    case 'buffs': body = <><TeamTab /><RulesFooter /></>; break;
    case 'rules': body = <RuleCatalogTab />; break;
    case 'admins': body = <AdminsManager currentUserId={session.user.id} />; break;
    default: body = <TournamentsAdmin series={series} currentUserId={session.user.id} isSuperadmin={isSuperadmin} />;
  }

  return (
    <div>
      <PageMeta title={`${ADMIN_TAB_TITLES[active]} — Адмінка PW PvP`} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="section-head">
        <div>
          <span className="eyebrow">Адмінка · {isSuperadmin ? 'Суперадмін' : 'ГМ'}</span>
          <h2>{ADMIN_TAB_TITLES[active]}</h2>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => supabase.auth.signOut()}>Вийти</button>
      </div>

      <AdminTabs tabs={tabs} active={active} onSelect={onTab} />

      {body}
    </div>
  );
}
