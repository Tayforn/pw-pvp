// =========================================================
// Заявка на турнір. Фул-рандом — лише персонажем з ляльки: учасник клану
// (вхід через Discord) обирає збереженого персонажа, гравець без Discord-ролі —
// чернетку цього браузера (/characters/new). Заявку на фул-рандом подає бекенд
// (data/registerApi.ts: скор рахує сервер), запасний шлях — прямий insert.
//
// Шлях гравця: якщо своя заявка на турнір уже є (id чи нік із записів цього
// браузера) — замість форми її статус (на розгляді / підтверджено / відхилено з
// причиною / вибув, після жеребки — команда); відхилену можна подати знову
// («Подати знову» чи ?again=1 з «Моїх заявок»). Заявка, знайдена лише за своїм
// персонажем (character_id), форму не ховає — картка над формою (до 0034 чужий
// character_id міг підставити будь-хто). Пошук своїх заявок не вдався — форма
// (без записів браузера) або помилка з «Спробувати ще» (data/myRegistrations.ts,
// registerGate).
// =========================================================

import { useEffect, useMemo, useState, useRef } from 'react';
import PageMeta from '../app/PageMeta';
import { routeUrl } from '../app/useRoute';
import { errorMessage } from '../app/errorMessage';
import { markRegistered, refsForTournament } from '../app/registeredTournaments';
import { isBalancedRandom, isPastTournament, isRegistrationOpen, type PlayerGear, type Tournament } from '../data/types';
import { fetchPlayerStatusByNickname, fetchPublicTournaments, fetchTournament, findLiveRegistration, submitRegistration } from '../data/tournaments';
import { newNonce, registerPlayer, type RegisterOutcome } from '../data/registerApi';
import { loadMyRegistrations, registerGate, type MyRegistrationItem, type RegisterGate } from '../data/myRegistrations';
import { isGearComplete } from '../components/GearFields';
import MyRegistrationCard from '../components/MyRegistrationCard';
import RulesList from '../components/RulesList';
import ScoreBreakdown from '../components/ScoreBreakdown';
import { parseRulesMd } from '../data/ruleCatalog';
import { readLastNickname, saveLastNickname } from '../app/lastNickname';
import { useMe } from '../app/useMe';
import { BUILD_LABELS, CLASS_LABELS, gearParts, gearSummary, gemMixLabel, registrationScore, rulesFor, tierForWith } from '../data/gearRules';
import { useRules } from '../data/rulesStore';
import { rulesVersionFor } from '../data/teams';
import type { CharacterForRegistration, CharacterSummary } from '../doll/registration';

// Модуль ляльки (каталоги, формули) — окремий чанк: вантажимо лише коли
// відкрито форму фул-рандому.
const loadDollReg = () => import('../doll/registration');
/** id чернетки у виборі персонажа — те саме, що DRAFT_ID у doll/registration.ts (тут без імпорту чанка). */
const DRAFT_OPTION = 'new';
/** Пояснення для гравця без Discord-ролі (рішення власника, шлях гравця). */
const DRAFT_NOTE = 'Без Discord-ролі гільдії заявку подають персонажем із чернетки цього браузера; збережи чернетку, поки турнір не закінчиться.';
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
  // ?again=1 — «Подати знову» з «Моїх заявок»: відхилена заявка не ховає форму.
  const [again, setAgain] = useState(() => new URLSearchParams(window.location.search).get('again') === '1');

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [pinned, setPinned] = useState<Tournament | null | undefined>(pinnedId ? undefined : null);
  const [tournamentId, setTournamentId] = useState('');
  const [nickname, setNickname] = useState('');
  const { me: discordMe, loading: meLoading, login } = useMe();
  // Версії шкали з бази — скор і тир персонажа рахуються за версією турніру.
  useRules();
  const [members, setMembers] = useState<string[]>([]);
  // Спорядження для legacy-колонок заявки (з ляльки) — лише для балансного фул-рандому.
  const [gear, setGear] = useState<Partial<PlayerGear>>({});
  const [attackLevel, setAttackLevel] = useState<number | null>(null);
  const [defenseLevel, setDefenseLevel] = useState<number | null>(null);
  // Фул-рандом — лише персонажем з ляльки (рішення власника 25.09.2026: «все має
  // йти через ляльку»); ручних полів спорядження немає. '' — персонажа не обрано.
  const [chars, setChars] = useState<CharacterSummary[] | null>(null);
  // Гість — чернетка цього браузера: undefined — ще читаємо, null — немає.
  const [draft, setDraft] = useState<CharacterSummary | null | undefined>(undefined);
  const [charId, setCharId] = useState('');
  const [charLoad, setCharLoad] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; data?: CharacterForRegistration; err?: string }>({ status: 'idle' });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [rulesAck, setRulesAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Подана заявка: як прийнята (сервер / напряму) і примітки скору від сервера.
  const [done, setDone] = useState<RegisterOutcome | null>(null);
  // Свої заявки на обраний турнір (статус замість форми).
  const [own, setOwn] = useState<{ status: 'loading' | 'ready' | 'error'; items: MyRegistrationItem[]; key: string }>({ status: 'loading', items: [], key: '' });
  // «Спробувати ще» після збою пошуку своїх заявок — перезапускає ефект нижче.
  const [ownRetry, setOwnRetry] = useState(0);

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
  // (нік + спорядження з ляльки); «готові команди» — назва + N ніків, як було.
  const isBalanced = tournament ? isBalancedRandom(tournament) : false;
  const isTeam = !!tournament?.teamSize && !isBalanced;

  const clearGear = () => {
    setGear({});
    setAttackLevel(null);
    setDefenseLevel(null);
  };

  useEffect(() => {
    setMembers(tournament?.teamSize ? Array.from({ length: tournament.teamSize }, () => '') : []);
    // Спорядження привʼязане до турніру — при зміні вибору починаємо з чистого.
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

  // Персонажі учасника клану — лише для фул-рандому (там заявка персонажем).
  useEffect(() => {
    if (!discordMe || !isBalanced || chars) return;
    let alive = true;
    loadDollReg()
      .then((m) => m.myCharacters())
      .then((list) => { if (alive) setChars(list); })
      .catch(() => { if (alive) setChars([]); });
    return () => { alive = false; };
  }, [discordMe, isBalanced, chars]);

  // Гість на фул-рандомі — чернетка цього браузера (без входу персонажа в профілі немає).
  // Перечитуємо й при поверненні на вкладку: чернетку часто збирають у сусідній.
  useEffect(() => {
    if (meLoading || discordMe || !isBalanced) return;
    let alive = true;
    const read = () => {
      loadDollReg()
        .then((m) => m.draftCharacter())
        .then((d) => { if (alive) setDraft(d); })
        .catch(() => { if (alive) setDraft(null); });
    };
    read();
    window.addEventListener('focus', read);
    return () => {
      alive = false;
      window.removeEventListener('focus', read);
    };
  }, [meLoading, discordMe, isBalanced]);

  // Свої заявки на цей турнір: id, запамʼятовані браузером, і (вхід через Discord,
  // фул-рандом) заявки своїх персонажів. Поки персонажі вантажаться — чекаємо, щоб
  // не блимнути формою перед статусом.
  const ownCharIds = isBalanced && discordMe ? (chars ? chars.map((c) => c.id) : null) : [];
  const ownKey = tournamentId && !meLoading && ownCharIds ? tournamentId + '|' + ownCharIds.join(',') : '';
  useEffect(() => {
    if (!ownKey || !tournament) return;
    const refs = refsForTournament(tournament.id);
    if (!refs.length && !ownCharIds?.length) {
      setOwn({ status: 'ready', items: [], key: ownKey });
      return;
    }
    let alive = true;
    setOwn((s) => ({ status: 'loading', items: s.key === ownKey ? s.items : [], key: ownKey }));
    loadMyRegistrations({ refs, characterIds: ownCharIds, lastNickname: readLastNickname(), tournamentId: tournament.id })
      .then((items) => { if (alive) setOwn({ status: 'ready', items, key: ownKey }); })
      .catch(() => { if (alive) setOwn({ status: 'error', items: [], key: ownKey }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownKey, tournament?.id, ownRetry]);

  // Інший турнір — спорядження скинуто (clearGear вище), тож і вибір персонажа теж.
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
    // Скор v2 — за версією шкали, закріпленою за турніром (до жеребки — поточна), і розміром його команди.
    const opts = { rulesVersion: tournament ? rulesVersionFor(tournament) : null, teamSize: tournament?.teamSize ?? null };
    loadDollReg()
      .then((m) => (id === DRAFT_OPTION && !discordMe ? m.draftForRegistration(opts) : m.characterForRegistration(id, opts)))
      .then((data) => {
        setCharLoad({ status: 'ready', data });
        if (data.result.gear) setGear(data.result.gear);
        setAttackLevel(data.result.attackLevel);
        setDefenseLevel(data.result.defenseLevel);
        // Чернетка може бути без імені — тоді нік лишається з поля.
        if (data.rec.name.trim()) setNickname(data.rec.name);
      })
      .catch((e) => setCharLoad({ status: 'error', err: errorMessage(e, String(e)) }));
  };
  const charData = charId && charLoad.status === 'ready' ? charLoad.data ?? null : null;
  // Скор v2 для картки й попапа: клас (за розміром команди турніру) + бали за речі + рівень + джин —
  // так само його порахує жеребка (registrationScore), за версією шкали, якою рахувала лялька.
  const charRules = charData ? rulesFor(charData.rulesVersion) : null;
  const charScore = charData && charRules ? registrationScore({ gear: charData.result.gear, itemPoints: charData.itemPoints }, charRules, tournament?.teamSize) : null;
  const charTier = charScore != null && charRules ? tierForWith(charScore, charRules) : null;
  const setNames = useMemo(() => charData?.doc.sets.map((s) => s.name) ?? [], [charData]);
  // Назви речей для розкладу — з результату ляльки (у item_breakdown назв немає).
  const itemNameOf = useMemo(() => {
    const names = new Map<string, string>();
    if (charData) for (const r of [...charData.items.main, ...charData.items.sets.flatMap((s) => s.rows)]) names.set(r.slot + ':' + r.catId, r.name);
    return (catId: number, slot: string): string | null => names.get(slot + ':' + catId) ?? null;
  }, [charData]);

  const membersValid = !isTeam || members.every((m) => m.trim());
  // Фул-рандом — лише персонажем, на якому є зброя й броня (gear з ляльки повний).
  const gearValid = !isBalanced || (!!charData?.result.gear && isGearComplete(gear));
  // Свої заявки на турнір. Клієнтська перевірка доповнює серверний unique-індекс
  // (той блокує лише повтор ТОГО САМОГО нікнейму): жива своя заявка (на розгляді
  // чи підтверджена) не дає подати ще одну з ІНШИМ нікнеймом з того самого
  // браузера; відхилена — дає (повторна подача): статус із «Подати знову»,
  // натиснув — форма, а картка лишається над нею. Знайдена лише за персонажем —
  // картка над формою, подавати можна. Що саме показати — registerGate.
  const ownCurrent = own.key === ownKey;
  const ownItems = ownCurrent && own.status === 'ready' ? own.items : [];
  const refsHere = tournamentId ? refsForTournament(tournamentId) : [];
  const gate: RegisterGate = tournamentId
    ? registerGate({ own: { status: own.status, items: own.items, current: ownCurrent }, refs: refsHere, again })
    : { view: 'form', rejected: [], foreign: [], basis: [] };

  // Мітка спроби подачі: та сама для повторів після збою (бекенд міг уже записати заявку —
  // за міткою її й упізнаємо), нова — після прийнятої заявки.
  const nonceRef = useRef<string | null>(null);

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
    const nick = nickname.trim();
    const draftDoc = charData?.source === 'draft';
    const nonce = (nonceRef.current ??= newNonce());
    try {
      const outcome = await registerPlayer(
        {
          isTeam,
          // Запасний шлях — прямий insert, як було до бекенда.
          direct: {
            tournamentId,
            nickname: nick,
            rulesAck,
            memberNicknames: isTeam ? members.map((m) => m.trim()) : undefined,
            ...(isBalanced && isGearComplete(gear) ? { gear, attackLevel, defenseLevel } : {}),
            // Скор v2 (0032): бали за речі й розклад — до міграції submitRegistration повторює insert без них.
            // character_id прямий insert не пише (чий персонаж, перевіряє лише бекенд; чернетка гостя
            // в профілі й не має персонажа) — лише знімок.
            ...(charData
              ? { character: { snapshot: charData.doc, power: charData.power, itemPoints: charData.itemPoints, itemBreakdown: charData.itemBreakdown } }
              : {}),
          },
          // Фул-рандом — спершу бекенд: скор рахує сервер (свій персонаж — з бази, чернетка — з тіла).
          server:
            isBalanced && charData
              ? { tournamentId, nickname: nick, rulesAck: true, nonce, ...(draftDoc ? { doc: charData.doc } : { characterId: charData.rec.id }) }
              : undefined,
        },
        // findLive — бекенд міг записати заявку, але не встигнути відповісти.
        { submitDirect: submitRegistration, statusByNickname: fetchPlayerStatusByNickname, findLive: findLiveRegistration },
      );
      nonceRef.current = null;
      markRegistered(tournamentId, outcome.id, nick);
      // У fixed-командному поле — назва команди, не нік; його не запам'ятовуємо.
      if (!isTeam) saveLastNickname(nick);
      setDone(outcome);
      setAgain(false);
    } catch (e) {
      setErr(errorMessage(e, String(e)));
    } finally {
      setBusy(false);
    }
  };

  // Пряме посилання: свої стани завантаження/помилки, форма реєстрації спільна нижче.
  if (pinnedId) {
    if (pinned === undefined) return <p className="hint">Завантаження…</p>;
    if (pinned === null) return <p className="hint">Турнір не знайдено.</p>;
    if (!isRegistrationOpen(pinned)) {
      // Минулий: завершений/скасований або дата минула (реєстрацію могли й не закрити).
      const passed = isPastTournament(pinned);
      return (
        <div>
          <PageMeta title="Заявка на турнір — PW PvP" />
          <div className="section-head">
            <span className="eyebrow">PvP</span>
            <h2>{pinned.name}</h2>
          </div>
          <p className="hint">{passed ? 'Турнір уже пройшов.' : 'Реєстрація на цей турнір зараз не відкрита.'}</p>
          {/* Своя заявка на цей турнір — статус і (після жеребки) команда навіть після закриття реєстрації. */}
          {ownItems.length > 0 && (
            <div className="myreg-list" style={{ margin: '14px 0' }}>
              {ownItems.map((it) => <MyRegistrationCard key={it.reg.id} item={it} ownOnTournament={ownItems.map((x) => x.reg)} />)}
            </div>
          )}
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
                {charData?.source === 'draft'
                  ? ' Заявку подано чернеткою цього браузера — не видаляй її й не очищуй дані сайту, поки турнір не закінчиться: адмін може попросити звірити ляльку.'
                  : ' Помилився в ляльці? Онови персонажа й напиши адміну.'}
              </p>
              {done.warn.length > 0 && (
                <p className="hint">Примітки до скору: {done.warn.join('; ')}.</p>
              )}
            </>
          ) : (
            <p className="hint">Адмін підтвердить участь перед стартом турніру.</p>
          )}
          <p style={{ margin: 0, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <a className="link" href={routeUrl({ name: 'my' })} data-goto="my">Мої заявки — статус</a>
            <a className="link" href={routeUrl({ name: 'tournament', id: tournamentId })}>Сторінка турніру</a>
          </p>
        </div>
      ) : gate.view === 'checking' ? (
        <p className="hint">Перевіряю, чи є вже твоя заявка на цей турнір…</p>
      ) : gate.view === 'error' ? (
        // Свої заявки знайти не вдалося, а з цього браузера на турнір уже подавали — не форма, а повтор.
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <p className="form-err" style={{ margin: 0 }}>
            Не вдалося перевірити, чи є вже твоя заявка на цей турнір (з цього браузера на нього вже подавали). Перевір інтернет і спробуй ще раз.
          </p>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOwnRetry((n) => n + 1)}>
              Спробувати ще
            </button>
            <a className="link" href={routeUrl({ name: 'my' })} data-goto="my">Мої заявки</a>
          </div>
        </div>
      ) : gate.view === 'status' ? (
        // Своя заявка вже є — її статус замість форми; відхилена — з «Подати знову».
        <div className="myreg-list">
          {gate.cards.map((it) => (
            <MyRegistrationCard key={it.reg.id} item={it} ownOnTournament={gate.basis} onReapply={() => setAgain(true)} />
          ))}
        </div>
      ) : gate.view === 'unknown' ? (
        <div className="card">
          <p className="hint" style={{ margin: 0 }}>
            З цього браузера вже подано заявку на цей турнір. Її статус — у{' '}
            <a className="link" href={routeUrl({ name: 'my' })} data-goto="my">Моїх заявках</a>.
          </p>
        </div>
      ) : (
        <>
        {/* Над формою: при повторній подачі — відхилена заявка з причиною (видно, що виправити);
            заявки, знайдені лише за своїм персонажем, — для відома, подати свою вони не заважають. */}
        {(gate.rejected.length > 0 || gate.foreign.length > 0) && (
          <div className="myreg-list" style={{ marginBottom: 16, maxWidth: isBalanced ? 560 : 480 }}>
            {[...gate.rejected, ...gate.foreign].map((it) => <MyRegistrationCard key={it.reg.id} item={it} noActions />)}
          </div>
        )}
        {/* 560 для фул-рандому: картці персонажа з розкладом по речах при 480 тісно
            (рядки розкладу переносились би навіть на десктопі). */}
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
          {isBalanced && !discordMe && draft !== undefined && !draft && (
            // Гість без чернетки: створити персонажа в ляльці (чернетка браузера) або увійти.
            <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>Потрібен персонаж з ляльки</b>
              <span className="hint" style={{ margin: 0 }}>
                На цей турнір подаються персонажем. Учасники клану входять через Discord і обирають збереженого персонажа. {DRAFT_NOTE} Збери персонажа на сторінці «Персонаж» і повернись сюди.
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <a className="btn btn-primary btn-sm" href={routeUrl({ name: 'character', id: DRAFT_OPTION })}>
                  Зібрати персонажа
                </a>
                <button type="button" className="btn btn-ghost btn-sm" onClick={login}>
                  Увійти через Discord
                </button>
              </div>
            </div>
          )}
          {isBalanced && !discordMe && draft !== null && (
            // Гість із чернеткою — той самий вибір, що в учасника клану, з однією опцією.
            <div className="field">
              <label htmlFor="regChar">Яким персонажем ідеш?</label>
              <select id="regChar" value={charId} onChange={(e) => pickCharacter(e.target.value)} disabled={draft === undefined || meLoading}>
                <option value="">{draft === undefined ? 'Шукаю чернетку персонажа…' : '— обери персонажа —'}</option>
                {draft && (
                  <option value={DRAFT_OPTION}>
                    Чернетка цього браузера: {draft.name || 'без імені'} · {CLS_NAME[draft.cls] ?? draft.cls} · {draft.level}
                  </option>
                )}
              </select>
              <small className="hint">
                {DRAFT_NOTE}{' '}
                <a className="link" href={routeUrl({ name: 'character', id: DRAFT_OPTION })} target="_blank" rel="noreferrer">
                  Відкрити чернетку
                </a>
                {' · '}
                <button type="button" className="link" onClick={login}>
                  увійти через Discord
                </button>
              </small>
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
                {chars && chars.length === 0 ? 'Збережених персонажів ще немає — створи його: ' : 'Спорядження підставиться з ляльки. Одна заявка з Discord-акаунта на турнір. '}
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
          {isBalanced && charId && charLoad.status === 'loading' && <p className="hint" style={{ margin: 0 }}>Завантажую персонажа й рахую бали з ляльки…</p>}
          {isBalanced && charId && charLoad.status === 'error' && <p className="form-err">Не вдалося завантажити персонажа: {charLoad.err}</p>}
          {isBalanced && charData && (
            <div className="card" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b>
                {charData.source === 'draft' ? 'Скор із чернетки' : 'Скор із персонажа'} «{charData.rec.name || nickname.trim() || 'без імені'}»
                {charScore != null && charTier ? `: ${charScore} · тир ${charTier}` : ''}
              </b>
              {charData.result.gear ? (
                <span className="hint" style={{ margin: 0 }}>{gearSummary(charData.result.gear, null, gemMixLabel(charData.result.facts.gemCounts, charRules ?? undefined) || undefined)}</span>
              ) : (
                <span className="form-err" style={{ margin: 0 }}>{charData.blockReason}</span>
              )}
              <ScoreBreakdown breakdown={charData.itemBreakdown} resolver={itemNameOf} setNames={setNames} />
              {charScore != null && (
                <span className="badge mute" style={{ alignSelf: 'flex-start' }}>
                  Орієнтовний скор: {charScore} · за версією шкали {charData.rulesVersion}
                </span>
              )}
              <a className="link" href={routeUrl({ name: 'character', id: charData.rec.id })} target="_blank" rel="noreferrer">
                {charData.source === 'draft' ? 'Відкрити чернетку' : 'Відкрити персонажа'}
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
        </>
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
                    <div className="doll-confirm-name">{charData.rec.name || nickname.trim()}</div>
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
                  {gearParts(g, gemMixLabel(f.gemCounts, charRules ?? undefined) || undefined).map((p) => (
                    <div key={p.key} className="doll-confirm-row">
                      <dt>{p.label}</dt>
                      <dd>{p.value}</dd>
                    </div>
                  ))}
                </dl>
                <ScoreBreakdown
                  breakdown={charData.itemBreakdown}
                  resolver={itemNameOf}
                  setNames={setNames}
                  title={charScore != null && charTier ? `Розклад по речах — скор ${charScore} · тир ${charTier}` : 'Розклад по речах'}
                />

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
