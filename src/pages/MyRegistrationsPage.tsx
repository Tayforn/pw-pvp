// =========================================================
// «Мої заявки» (/my): статус кожної своєї заявки — на розгляді / підтверджено /
// відхилено з причиною / вибув, після жеребки — команда зі складом; відхилену
// при відкритій реєстрації можна подати знову. Відкрита всім: гість бачить
// заявки, подані з цього браузера (id запамʼятовує форма заявки), хто увійшов
// через Discord — ще й заявки своїх персонажів з будь-якого пристрою.
// Статуси живі: адмін підтвердив чи відхилив — сторінка перечитується сама.
// =========================================================

import { useEffect, useMemo, useState } from 'react';
import PageMeta from '../app/PageMeta';
import { errorMessage } from '../app/errorMessage';
import { readLastNickname } from '../app/lastNickname';
import { useMyCharacterIds } from '../app/myCharacterIds';
import { readRegistrationRefs } from '../app/registeredTournaments';
import { useMe } from '../app/useMe';
import { routeUrl } from '../app/useRoute';
import MyRegistrationCard from '../components/MyRegistrationCard';
import { loadMyRegistrations, reapplyBasis, type MyRegistrationItem } from '../data/myRegistrations';
import { subscribeToTournamentChanges } from '../data/tournaments';

type State = { status: 'loading' } | { status: 'ready'; items: MyRegistrationItem[] } | { status: 'error'; err: string };

/** Пауза перед перечитуванням після події realtime: під час турніру їх сиплеться багато (сітка). */
const RELOAD_DEBOUNCE_MS = 800;

export default function MyRegistrationsPage() {
  const { me, loading: meLoading, login } = useMe();
  const charIds = useMyCharacterIds(!!me);
  const refs = useMemo(() => readRegistrationRefs(), []);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    if (meLoading || charIds === null) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () =>
      loadMyRegistrations({ refs, characterIds: charIds, lastNickname: readLastNickname() })
        .then((items) => { if (alive) setState({ status: 'ready', items }); })
        .catch((e) => { if (alive) setState((s) => (s.status === 'ready' ? s : { status: 'error', err: errorMessage(e, String(e)) })); });
    void load();
    const unsubscribe = subscribeToTournamentChanges(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), RELOAD_DEBOUNCE_MS);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [meLoading, charIds, refs]);

  const items = state.status === 'ready' ? state.items : [];
  // Правило повторної подачі — за всіма своїми заявками на турнір, не лише за однією
  // (знайдені лише за персонажем не рахуються — reapplyBasis).
  const byTournament = useMemo(() => reapplyBasis(items), [items]);

  return (
    <div>
      <PageMeta title="Мої заявки — PW PvP" description="Статус твоїх заявок на турніри: на розгляді, підтверджено чи відхилено, і твоя команда після жеребки." />
      <div className="section-head">
        <span className="eyebrow">PvP</span>
        <h2>Мої заявки</h2>
        <p>Статус заявок{me ? ' твоїх персонажів і поданих' : ', поданих'} з цього браузера: на розгляді, підтверджено чи відхилено — і твоя команда після жеребки.</p>
      </div>

      {state.status === 'loading' ? (
        <p className="hint">Завантаження…</p>
      ) : state.status === 'error' ? (
        <p className="form-err">Не вдалося завантажити заявки: {state.err}</p>
      ) : items.length === 0 ? (
        <div className="card myreg-empty">
          <b>Заявок ще немає</b>
          <span className="hint" style={{ margin: 0 }}>
            Тут з’являться заявки, подані з цього браузера{me ? ', і заявки твоїх збережених персонажів' : ''}.
          </span>
          <div>
            <a className="btn btn-primary btn-sm" href={routeUrl({ name: 'register' })} data-goto="register">
              Подати заявку
            </a>
          </div>
        </div>
      ) : (
        <div className="myreg-list">
          {items.map((it) => (
            <MyRegistrationCard key={it.reg.id} item={it} showTournament ownOnTournament={byTournament.get(it.reg.tournamentId)} />
          ))}
        </div>
      )}

      {!meLoading && !me && (
        <p className="hint" style={{ marginTop: 16 }}>
          Заявки з інших браузерів і пристроїв тут не видно — браузер памʼятає лише ті, що подано з нього.
          Учасники клану можуть{' '}
          <button type="button" className="link" onClick={login}>
            увійти через Discord
          </button>{' '}
          — тоді тут будуть і заявки збережених персонажів з будь-якого пристрою.
        </p>
      )}
    </div>
  );
}
