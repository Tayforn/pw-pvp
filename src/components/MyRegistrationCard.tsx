// =========================================================
// Статус своєї заявки — одна картка для «Моїх заявок» (/my), сторінки заявки
// (замість «ти вже зареєстрований») і банера «Твоя заявка» на сторінці турніру:
// нік, статус (на розгляді / підтверджено / відхилено / вибув, резерв), причина
// відхилення (лише для «відхилено»), після жеребки — команда зі складом (свій
// рядок виділено), а відхилена при відкритій реєстрації — кнопка «Подати знову».
// Заявка, знайдена лише за персонажем (не з цього браузера), — з поясненням.
// =========================================================

import { routeUrl } from '../app/useRoute';
import { CLASS_LABELS } from '../data/gearRules';
import { canReapply, playerStatus, type MyRegistrationItem } from '../data/myRegistrations';
import { isBalancedRandom, isPastTournament } from '../data/types';

/** Адреса форми заявки, що одразу відкриває повторну подачу. */
export const reapplyUrl = (tournamentId: string): string => routeUrl({ name: 'register' }) + '?t=' + encodeURIComponent(tournamentId) + '&again=1';

interface Props {
  item: MyRegistrationItem;
  /** Показати назву й дату турніру з посиланням («Мої заявки»). */
  showTournament?: boolean;
  /** «Подати знову» на самій сторінці заявки (форма відкривається тут же); без нього — посилання на форму. */
  onReapply?: () => void;
  /** Свої заявки на цей турнір — для правила повторної подачі (за замовчуванням лише ця);
   * знайдених лише за персонажем тут немає (reapplyBasis). */
  ownOnTournament?: MyRegistrationItem['reg'][];
  /** Банер на сторінці турніру — тонша рамка, без тіні. */
  banner?: boolean;
  /** Без «Подати знову» (картка над уже відкритою формою повторної подачі). */
  noActions?: boolean;
}

export default function MyRegistrationCard({ item, showTournament, onReapply, ownOnTournament, banner, noActions }: Props) {
  const { reg, tournament: t, team } = item;
  const st = playerStatus(reg, t);
  const balanced = t ? isBalancedRandom(t) : false;
  const basis = ownOnTournament?.length ? ownOnTournament : [reg];
  const again = !noActions && !!t && st.key === 'rejected' && canReapply(basis, t);

  // Минулий турнір — підсумок, а не «що буде далі».
  const past = t ? isPastTournament(t) : false;
  let note: string | null = null;
  if (st.key === 'pending') note = past ? 'Турнір уже пройшов, а заявку так і не розглянули.' : 'Адмін перевіряє заявку й підтвердить участь перед стартом.';
  else if (st.key === 'confirmed' && st.reserve) note = past ? 'Був у резерві — до команди не потрапив.' : 'Команди сформовано — ти в резерві: заміниш того, хто не з’явиться на старт.';
  else if (st.key === 'confirmed' && !team) note = balanced && !past ? 'Участь підтверджено. Команду сформує система після закриття реєстрації — вона з’явиться тут.' : 'Участь підтверджено.';
  else if (st.key === 'rejected') note = again ? 'Заявку відхилено. Виправ, що просив адмін, і подай знову.' : 'Заявку відхилено.';
  else if (st.key === 'out') note = 'Тебе замінили в команді — у сітці грає заміна.';

  return (
    <div className={'card myreg' + (banner ? ' myreg-banner' : '')} role={banner ? 'status' : undefined}>
      {showTournament && (
        <div className="myreg-tournament">
          {t ? (
            <a className="link" href={routeUrl({ name: 'tournament', id: t.id })}>{t.name}</a>
          ) : (
            <span className="hint" style={{ margin: 0 }}>Турнір видалено</span>
          )}
          {t && <span className="hint" style={{ margin: 0 }}>{t.eventDate}</span>}
        </div>
      )}
      <div className="myreg-head">
        <span className="myreg-who">
          {banner ? 'Твоя заявка: ' : ''}
          <b title={reg.nickname}>{reg.nickname}</b>
        </span>
        <span className={'badge ' + st.tone}>{st.label}</span>
        {st.reserve && <span className="badge mute">резерв</span>}
      </div>
      {note && <p className="hint myreg-note">{note}</p>}
      {item.byCharacterOnly && (
        <p className="hint myreg-note">Знайдено за твоїм збереженим персонажем — заявку подано не з цього браузера. Не подавав(ла) її — подай свою й напиши адміну.</p>
      )}
      {/* Причина — лише для відхиленої: «вибув» (заміна після жеребки) причини не має. */}
      {st.key === 'rejected' && reg.rejectReason && (
        <p className="myreg-reason">
          <span>Причина:</span> {reg.rejectReason}
        </p>
      )}
      {team && (
        <div className="myreg-team">
          <div className="myreg-team-name">
            Команда <b>«{team.name}»</b>
          </div>
          <ul className="myreg-members">
            {team.members.map((m) => (
              <li key={m.id} className={m.id === reg.id ? 'me' : undefined}>
                <span className="myreg-member-nick" title={m.nickname}>{m.nickname}</span>
                {m.charClass && <span className="badge mute">{CLASS_LABELS[m.charClass]}</span>}
                {m.id === reg.id && <span className="hint" style={{ margin: 0 }}>це ти</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {again && t && (
        <div className="myreg-actions">
          {onReapply ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={onReapply}>
              Подати знову
            </button>
          ) : (
            <a className="btn btn-primary btn-sm" href={reapplyUrl(t.id)}>
              Подати знову
            </a>
          )}
        </div>
      )}
    </div>
  );
}
