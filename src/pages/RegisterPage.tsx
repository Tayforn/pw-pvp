import { useEffect, useMemo, useState } from 'react';
import PageMeta from '../app/PageMeta';
import { routeUrl } from '../app/useRoute';
import { errorMessage } from '../app/errorMessage';
import { hasRegistered, markRegistered } from '../app/registeredTournaments';
import { isBalancedRandom, isRegistrationOpen, type PlayerGear, type Tournament } from '../data/types';
import { fetchPublicTournaments, fetchTournament, submitRegistration } from '../data/tournaments';
import GearFields, { isGearComplete } from '../components/GearFields';

/** Суфікс до назви турніру у виборі/підписі — формат командного турніру. */
function teamSuffix(t: Tournament): string {
  if (!t.teamSize) return '';
  return isBalancedRandom(t) ? ` (фул-рандом, команди по ${t.teamSize})` : ` (команди по ${t.teamSize})`;
}

export default function RegisterPage() {
  // ?t=<id> — пряме посилання на конкретний турнір (у т.ч. "unlisted" ГМ-турніри,
  // яких немає в публічному переліку) — fetchTournament(id) навмисно без
  // фільтра visibility, працює для будь-кого за посиланням.
  const pinnedId = useMemo(() => new URLSearchParams(window.location.search).get('t'), []);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [pinned, setPinned] = useState<Tournament | null | undefined>(pinnedId ? undefined : null);
  const [tournamentId, setTournamentId] = useState('');
  const [nickname, setNickname] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  // Анкета спорядження — лише для балансного фул-рандому.
  const [gear, setGear] = useState<Partial<PlayerGear>>({});
  const [attackLevel, setAttackLevel] = useState<number | null>(null);
  const [defenseLevel, setDefenseLevel] = useState<number | null>(null);
  const [rulesAck, setRulesAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (pinnedId) {
      fetchTournament(pinnedId).then((t) => {
        setPinned(t);
        if (t) setTournamentId(t.id);
      });
    } else {
      fetchPublicTournaments().then((all) => {
        const open = all.filter((t) => isRegistrationOpen(t));
        setTournaments(open);
        if (open.length) setTournamentId(open[0].id);
      });
    }
  }, [pinnedId]);

  const tournament = pinnedId ? pinned : tournaments.find((t) => t.id === tournamentId);
  // Балансний фул-рандом — теж командний турнір, але заявка індивідуальна
  // (нік + анкета спорядження); «готові команди» — назва + N ніків, як було.
  const isBalanced = tournament ? isBalancedRandom(tournament) : false;
  const isTeam = !!tournament?.teamSize && !isBalanced;

  useEffect(() => {
    setMembers(tournament?.teamSize ? Array.from({ length: tournament.teamSize }, () => '') : []);
    // Анкета прив'язана до турніру — при зміні вибору починаємо з чистої.
    setGear({});
    setAttackLevel(null);
    setDefenseLevel(null);
  }, [tournament?.teamSize, tournamentId]);

  const membersValid = !isTeam || members.every((m) => m.trim());
  const gearValid = !isBalanced || isGearComplete(gear);
  // Клієнтська перевірка — доповнює серверний unique-індекс (той блокує лише
  // повтор ТОГО САМОГО нікнейму); ця блокує ще одну заявку з ІНШИМ нікнеймом
  // з того самого браузера.
  const alreadyRegistered = !!tournamentId && hasRegistered(tournamentId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tournamentId || !nickname.trim() || !rulesAck || !membersValid || !gearValid) return;
    setBusy(true);
    setErr(null);
    try {
      await submitRegistration({
        tournamentId,
        nickname: nickname.trim(),
        rulesAck,
        memberNicknames: isTeam ? members.map((m) => m.trim()) : undefined,
        ...(isBalanced && isGearComplete(gear) ? { gear, attackLevel, defenseLevel } : {}),
      });
      markRegistered(tournamentId);
      setDone(true);
    } catch (e) {
      const msg = errorMessage(e, String(e));
      setErr(
        msg.includes('duplicate key') || msg.includes('registrations_tournament_nickname')
          ? `Ц${isTeam ? 'я назва команди' : 'ей нікнейм'} уже зареєстрован${isTeam ? 'а' : 'ий'} на цей турнір.`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  };

  // Пряме посилання: свої стани завантаження/помилки, форма реєстрації спільна нижче.
  if (pinnedId) {
    if (pinned === undefined) return <p className="hint">Завантаження…</p>;
    if (pinned === null) return <p className="hint">Турнір не знайдено.</p>;
    if (!isRegistrationOpen(pinned)) {
      const passed = pinned.status === 'registration_open';
      return (
        <div>
          <PageMeta title="Заявка на турнір — PW PvP" />
          <div className="section-head">
            <span className="eyebrow">PvP</span>
            <h2>{pinned.name}</h2>
          </div>
          <p className="hint">{passed ? 'Турнір уже пройшов.' : 'Реєстрація на цей турнір зараз не відкрита.'}</p>
          <p>
            <a className="link" href={routeUrl({ name: 'tournament', id: pinned.id })}>Сторінка турніру</a>
          </p>
        </div>
      );
    }
  }

  return (
    <div>
      <PageMeta title="Заявка на турнір — PW PvP" description="Подай заявку на участь у турнірі." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Заявка на турнір</h2>
      </div>

      {!pinnedId && tournaments.length === 0 ? (
        <p className="hint">Зараз немає турнірів з відкритою реєстрацією.</p>
      ) : done ? (
        <div className="card">
          <p className="badge good">Заявку подано!</p>
          {isBalanced ? (
            <>
              <p className="hint">
                Адмін підтвердить участь. Команду дізнаєшся на сторінці турніру після закриття реєстрації — команду собі не обирають.
                Помилився в анкеті? Напиши адміну.
              </p>
              <p style={{ margin: 0 }}>
                <a className="link" href={routeUrl({ name: 'tournament', id: tournamentId })}>Сторінка турніру</a>
              </p>
            </>
          ) : (
            <p className="hint">Адмін підтвердить участь перед стартом турніру.</p>
          )}
        </div>
      ) : alreadyRegistered ? (
        <div className="card">
          <p className="hint" style={{ margin: 0 }}>З цього браузера вже подано заявку на цей турнір.</p>
        </div>
      ) : (
        // 560 для анкети: при 480 внутрішня ширина менша за потрібну парі полів
        // .field-row — пари переносились би в стовпчик навіть на десктопі.
        <form className="card" onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: isBalanced ? 560 : 480 }}>
          {pinnedId ? (
            <div className="field">
              <span>Турнір</span>
              <p style={{ margin: '4px 0 0', fontWeight: 600 }}>
                {tournament!.name} · {tournament!.eventDate}
                {teamSuffix(tournament!)}
              </p>
            </div>
          ) : (
            <label className="field">
              <span>Турнір</span>
              <select value={tournamentId} onChange={(e) => setTournamentId(e.target.value)}>
                {tournaments.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} · {t.eventDate}
                    {teamSuffix(t)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isBalanced && (
            <p className="hint" style={{ margin: 0 }}>
              Команду формує система випадково після закриття реєстрації. Заповни чесно — адмін перевіряє в грі, неправда = дискваліфікація.
            </p>
          )}
          <label className="field">
            <span>{isTeam ? 'Назва команди' : 'Нікнейм персонажа'}</span>
            <input
              type="text"
              value={nickname}
              maxLength={40}
              required
              onChange={(e) => setNickname(e.target.value)}
              placeholder={isTeam ? 'Назва твоєї команди' : 'Твій нікнейм у грі'}
            />
          </label>
          {isTeam && (
            <div className="field">
              <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 500 }}>Учасники команди ({tournament!.teamSize})</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {members.map((m, i) => (
                  <input
                    key={i}
                    type="text"
                    value={m}
                    maxLength={40}
                    placeholder={`Нікнейм учасника ${i + 1}`}
                    onChange={(e) => setMembers((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                  />
                ))}
              </div>
            </div>
          )}
          {isBalanced && (
            <GearFields
              value={gear}
              onChange={setGear}
              attackLevel={attackLevel}
              defenseLevel={defenseLevel}
              onExtraChange={(a, d) => {
                setAttackLevel(a);
                setDefenseLevel(d);
              }}
              showScore
            />
          )}
          <label className="checkbox-row">
            <input type="checkbox" checked={rulesAck} onChange={(e) => setRulesAck(e.target.checked)} />
            {isBalanced ? 'З правилами ознайомлений(а), дані про спорядження правдиві' : 'З правилами турніру ознайомлений(а)'}
          </label>
          <small className="hint">
            Ще не знайомий(а) з правилами?{' '}
            {tournament?.rulesMd ? (
              <a className="link" href={routeUrl({ name: 'tournament', id: tournament.id })}>
                Правила цього турніру
              </a>
            ) : (
              <a className="link" href={routeUrl({ name: 'rules' })} data-goto="rules">
                Загальні правила турнірів
              </a>
            )}
          </small>
          {err && <p className="form-err">{err}</p>}
          <button type="submit" className="btn btn-primary" disabled={busy || !rulesAck || !nickname.trim() || !membersValid || !gearValid}>
            {busy ? 'Надсилання…' : 'Подати заявку'}
          </button>
        </form>
      )}
    </div>
  );
}
