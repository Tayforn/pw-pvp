import { useEffect, useMemo, useState } from 'react';
import PageMeta from '../app/PageMeta';
import { routeUrl } from '../app/useRoute';
import { errorMessage } from '../app/errorMessage';
import { hasRegistered, markRegistered } from '../app/registeredTournaments';
import { isBalancedRandom, isRegistrationOpen, type PlayerGear, type Tournament } from '../data/types';
import { fetchPublicTournaments, fetchTournament, submitRegistration } from '../data/tournaments';
import { isGearComplete } from '../components/GearFields';
import RulesList from '../components/RulesList';
import { parseRulesMd } from '../data/ruleCatalog';
import { readLastNickname, saveLastNickname } from '../app/lastNickname';
import { useMe } from '../app/useMe';
import { BUILD_LABELS, CLASS_LABELS, computeGearScore, gearParts, gearSummary, gemMixLabel, rulesFor, SPECIAL_SET_LABELS } from '../data/gearRules';
import type { CharacterForRegistration, CharacterSummary } from '../doll/registration';

// Модуль ляльки (каталоги, формули) — окремий чанк: вантажимо лише коли
// учасник клану відкрив форму фул-рандому.
const loadDollReg = () => import('../doll/registration');
const CLS_NAME: Record<string, string> = { by: 'Воїн', ga: 'Маг', ya: 'Танк', rl: 'Друїд', ij: 'Прист', js: 'Лучник', fx: 'Сін', sj: 'Шаман', ej: 'Страж', rg: 'Містик' };

/** «1 пункт · 2 пункти · 5 пунктів». */
function pointsLabel(n: number): string {
  const m10 = n % 10, m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'пункт' : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? 'пункти' : 'пунктів';
  return `${n} ${word}`;
}

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
  const { me: discordMe, login } = useMe();
  const [members, setMembers] = useState<string[]>([]);
  // Анкета спорядження — лише для балансного фул-рандому.
  const [gear, setGear] = useState<Partial<PlayerGear>>({});
  const [attackLevel, setAttackLevel] = useState<number | null>(null);
  const [defenseLevel, setDefenseLevel] = useState<number | null>(null);
  // Фул-рандом — лише персонажем з ляльки (рішення власника 25.09.2026: «все має
  // йти через ляльку»); ручної анкети більше немає. '' — персонажа не обрано.
  const [chars, setChars] = useState<CharacterSummary[] | null>(null);
  const [charId, setCharId] = useState('');
  const [charLoad, setCharLoad] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data?: CharacterForRegistration; err?: string }>({ status: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
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

  const clearGear = () => {
    setGear({});
    setAttackLevel(null);
    setDefenseLevel(null);
  };

  useEffect(() => {
    setMembers(tournament?.teamSize ? Array.from({ length: tournament.teamSize }, () => '') : []);
    // Анкета прив'язана до турніру — при зміні вибору починаємо з чистої.
    clearGear();
    // Збережений нік — лише для індивідуальної заявки: у fixed-командному
    // турнірі це поле — назва команди, свій нік туди підставляти не можна
    // (а якщо він уже стоїть зі сховища — прибираємо).
    const stored = readLastNickname();
    const nick = isTeam ? (nickname === stored ? '' : nickname) : nickname || stored;
    if (nick !== nickname) setNickname(nick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournament?.teamSize, tournamentId]);

  // Нік із Discord-сесії (спільний вхід на thunderpw.fun) — підставляємо в
  // особисту заявку, поки поле порожнє; назву команди не чіпаємо.
  useEffect(() => {
    if (!discordMe || isTeam || nickname.trim()) return;
    setNickname(discordMe.nickname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discordMe, isTeam]);

  // Персонажі учасника клану — лише для фул-рандому (там потрібна анкета).
  useEffect(() => {
    if (!discordMe || !isBalanced || chars) return;
    let alive = true;
    loadDollReg()
      .then((m) => m.myCharacters())
      .then((list) => { if (alive) setChars(list); })
      .catch(() => { if (alive) setChars([]); });
    return () => { alive = false; };
  }, [discordMe, isBalanced, chars]);

  // Інший турнір — анкету скинуто (clearGear вище), тож і вибір персонажа теж.
  useEffect(() => {
    setCharId('');
    setCharLoad({ status: 'idle' });
  }, [tournamentId]);

  const pickCharacter = (id: string) => {
    setCharId(id);
    setConfirmChecked(false);
    clearGear();
    if (!id) {
      setCharLoad({ status: 'idle' });
      return;
    }
    setCharLoad({ status: 'loading' });
    loadDollReg()
      .then((m) => m.characterForRegistration(id))
      .then((data) => {
        setCharLoad({ status: 'ready', data });
        if (data.result.gear) setGear(data.result.gear);
        setAttackLevel(data.result.attackLevel);
        setDefenseLevel(data.result.defenseLevel);
        setNickname(data.rec.name);
      })
      .catch((e) => setCharLoad({ status: 'error', err: errorMessage(e, String(e)) }));
  };
  const charData = charId && charLoad.status === 'ready' ? charLoad.data ?? null : null;

  const membersValid = !isTeam || members.every((m) => m.trim());
  // Фул-рандом — лише персонажем із заповненою анкетою персонажа.
  const gearValid = !isBalanced || (!!charData?.result.gear && isGearComplete(gear));
  // Клієнтська перевірка — доповнює серверний unique-індекс (той блокує лише
  // повтор ТОГО САМОГО нікнейму); ця блокує ще одну заявку з ІНШИМ нікнеймом
  // з того самого браузера.
  const alreadyRegistered = !!tournamentId && hasRegistered(tournamentId);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!tournamentId || !nickname.trim() || !rulesAck || !membersValid || !gearValid) return;
    // Персонажем — спершу попап «дані в ляльці актуальні».
    if (charData && !confirmOpen) {
      setConfirmChecked(false);
      setConfirmOpen(true);
      return;
    }
    setConfirmOpen(false);
    setBusy(true);
    setErr(null);
    try {
      await submitRegistration({
        tournamentId,
        nickname: nickname.trim(),
        rulesAck,
        memberNicknames: isTeam ? members.map((m) => m.trim()) : undefined,
        ...(isBalanced && isGearComplete(gear) ? { gear, attackLevel, defenseLevel } : {}),
        ...(charData ? { character: { id: charData.rec.id, revision: charData.rec.revision, snapshot: charData.doc, power: charData.power } } : {}),
      });
      markRegistered(tournamentId);
      // У fixed-командному поле — назва команди, не нік; його не запам'ятовуємо.
      if (!isTeam) saveLastNickname(nickname.trim());
      setDone(true);
    } catch (e) {
      const msg = errorMessage(e, String(e));
      setErr(
        msg.includes('duplicate key') || msg.includes('registrations_tournament_nickname')
          ? `Ц${isTeam ? 'я назва команди' : 'ей нікнейм'} уже зареєстрован${isTeam ? 'а' : 'ий'} на цей турнір.`
          // RLS (0027) не пропускає заявку без rules_ack; та сама відмова — коли
          // реєстрацію закрили, поки форма була відкрита.
          : msg.includes('row-level security')
            ? 'Заявку не прийнято: підтвердь ознайомлення з правилами (галочка нижче) і перевір, чи реєстрація ще відкрита.'
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
              Команду формує система випадково після закриття реєстрації. Заявка — лише персонажем з ляльки: спорядження береться з неї, адмін звіряє в грі.
            </p>
          )}
          {isBalanced && !discordMe && (
            <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>Потрібен персонаж з ляльки</b>
              <span className="hint" style={{ margin: 0 }}>
                На цей турнір подаються персонажем: увійди через Discord, створи персонажа на сторінці «Персонаж» і обери його тут.
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={login}>
                  Увійти через Discord
                </button>
                <a className="btn btn-ghost btn-sm" href={routeUrl({ name: 'characters' })}>
                  Мої персонажі
                </a>
              </div>
            </div>
          )}
          {isBalanced && discordMe && (
            <div className="field">
              <label htmlFor="regChar">Яким персонажем ідеш?</label>
              <select id="regChar" value={charId} onChange={(e) => pickCharacter(e.target.value)} disabled={!chars}>
                <option value="">{chars === null ? 'Завантажую персонажів…' : '— обери персонажа —'}</option>
                {(chars ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {CLS_NAME[c.cls] ?? c.cls} · {c.level}
                  </option>
                ))}
              </select>
              <small className="hint">
                {chars && chars.length === 0 ? 'Збережених персонажів ще немає — створи його: ' : 'Спорядження підставиться з ляльки. '}
                <a className="link" href={routeUrl({ name: 'characters' })} target="_blank" rel="noreferrer">
                  Мої персонажі
                </a>
              </small>
            </div>
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
          {isBalanced && charId && charLoad.status === 'loading' && <p className="hint" style={{ margin: 0 }}>Завантажую персонажа й рахую анкету з ляльки…</p>}
          {isBalanced && charId && charLoad.status === 'error' && <p className="form-err">Не вдалося завантажити персонажа: {charLoad.err}</p>}
          {isBalanced && charData && (
            <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>Анкета з персонажа «{charData.rec.name}»</b>
              {charData.result.gear ? (
                <>
                  <span className="hint" style={{ margin: 0 }}>{gearSummary(charData.result.gear, null, gemMixLabel(charData.result.facts.gemCounts, rulesFor()) || undefined)}</span>
                  <span className="hint" style={{ margin: 0 }}>
                    Свап-сети з ляльки: {charData.result.facts.specialSets.length ? charData.result.facts.specialSets.map((k) => SPECIAL_SET_LABELS[k]).join(', ') : 'немає'}
                    {charData.result.facts.specialSets.length > 0 && !charData.setsFromDoll ? ' (у бали поки не йдуть — це вмикає адмін)' : ''}
                  </span>
                  <span className="badge mute" style={{ alignSelf: 'flex-start' }}>
                    Орієнтовний гір-скор: {computeGearScore(charData.result.gear, null, tournament?.teamSize)}
                  </span>
                </>
              ) : (
                <span className="form-err" style={{ margin: 0 }}>У персонажа не заповнена анкета: бракує {charData.result.missing.join(', ')}.</span>
              )}
              <a className="link" href={routeUrl({ name: 'character', id: charData.rec.id })} target="_blank" rel="noreferrer">
                {charData.result.gear ? 'Змінити в персонажі' : 'Заповнити анкету в персонажі'}
              </a>
              <small className="hint" style={{ margin: 0 }}>Змінив персонажа в іншій вкладці? Обери його тут ще раз, щоб підтягнути зміни.</small>
            </div>
          )}
          {/* Пункти правил над галочкою — з rules_md турніру, щоб гравець читав те,
              що підтверджує, не переходячи на сторінку турніру. */}
          {tournament?.rulesMd && (() => {
            const n = parseRulesMd(tournament.rulesMd).points.length;
            return (
              <details open style={{ border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>Правила турніру{n > 0 ? ` (${pointsLabel(n)})` : ''}</summary>
                <div style={{ marginTop: 8 }}>
                  <RulesList rulesMd={tournament.rulesMd} compact />
                </div>
              </details>
            );
          })()}
          <label className="checkbox-row">
            <input type="checkbox" checked={rulesAck} onChange={(e) => setRulesAck(e.target.checked)} />
            {isBalanced ? 'З правилами ознайомлений(а), лялька відповідає моєму спорядженню в грі' : 'З правилами турніру ознайомлений(а)'}
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
      {confirmOpen && charData?.result.gear && (() => {
        const g = charData.result.gear;
        const f = charData.result.facts;
        return (
          // Закривається лише кнопками й хрестиком — випадковий клік повз вікно не скидає галочку.
          <div className="modal-overlay" role="presentation">
            <div className="modal doll-confirm" role="dialog" aria-modal="true" aria-labelledby="confirmDollTitle" style={{ width: 'min(560px, 100%)' }}>
              <div className="modal-head">
                <h3 id="confirmDollTitle">Лялька актуальна?</h3>
                <button type="button" className="modal-close" aria-label="Закрити" onClick={() => setConfirmOpen(false)}>✕</button>
              </div>
              <div className="modal-body">
                <div className="doll-confirm-hero">
                  <div>
                    <div className="doll-confirm-name">{charData.rec.name}</div>
                    <div className="doll-confirm-sub">
                      {CLASS_LABELS[g.charClass]} · рівень {charData.doc.level}
                      {g.build ? ' · ' + BUILD_LABELS[g.build] : ''}
                    </div>
                  </div>
                  <div className="doll-confirm-stats">
                    <span className="doll-confirm-stat"><b>{Math.round(f.pa)}</b>ПА</span>
                    <span className="doll-confirm-stat"><b>{Math.round(f.pz)}</b>ПЗ</span>
                  </div>
                </div>

                <dl className="doll-confirm-grid">
                  {gearParts(g, gemMixLabel(f.gemCounts, rulesFor()) || undefined).map((p) => (
                    <div key={p.key} className="doll-confirm-row">
                      <dt>{p.label}</dt>
                      <dd>{p.value}</dd>
                    </div>
                  ))}
                  <div className="doll-confirm-row">
                    <dt>Свап-сети</dt>
                    <dd>
                      {f.specialSets.length ? (
                        <span className="doll-confirm-sets">
                          {f.specialSets.map((k) => (
                            <span key={k} className="badge">{SPECIAL_SET_LABELS[k]}</span>
                          ))}
                        </span>
                      ) : (
                        <span className="doll-confirm-none">немає</span>
                      )}
                    </dd>
                  </div>
                </dl>

                <p className="hint doll-confirm-note">
                  Адмін бачитиме ляльку такою, як зараз, і може звірити спорядження в грі. Змінилось щось — повернись і онови персонажа.
                </p>

                <label className={'doll-confirm-ack' + (confirmChecked ? ' on' : '')}>
                  <input type="checkbox" checked={confirmChecked} onChange={(e) => setConfirmChecked(e.target.checked)} />
                  <span>Так, лялька актуальна: саме в цьому спорядженні (Головний і сети) я гратиму на турнірі</span>
                </label>
              </div>
              <div className="modal-foot">
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>
                  Повернутись
                </button>
                <button type="button" className="btn btn-primary" disabled={!confirmChecked || busy} onClick={() => void submit()}>
                  {busy ? 'Надсилання…' : 'Подати заявку'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
