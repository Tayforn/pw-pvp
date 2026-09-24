// =========================================================
// Адмінка: модалка створення/редагування турніру — назва, дата,
// статус, правила, призи, тип сітки, командний режим і спосіб
// формування команд. Серія (для суперадміна) в UI не показується —
// новий турнір мовчки прив'язується до єдиної активної.
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage } from '../../app/errorMessage';
import type { BracketType, TeamMode, Tournament, TournamentSeries, TournamentStatus } from '../../data/types';
import { STATUS_LABELS } from '../../data/types';
import { createTournament, fetchRegistrations, updateTournament, type TournamentInput } from '../../data/tournaments';
import { standardRulesFor, standardRulesLabel } from '../../data/standardRules';
import type { TournamentRuleFlags } from '../../data/ruleFlags';
import { defaultFlagsFor, drawSummary, flagsFromLegacyText, formatOf, itemsForFormat, renderRulesMd } from '../../data/ruleCatalog';
import { useRuleCatalog } from '../../data/catalogStore';
import RulesPopup from './RulesPopup';

const STATUSES: TournamentStatus[] = ['draft', 'registration_open', 'registration_closed', 'in_progress', 'completed', 'cancelled'];

interface Props {
  initial: Tournament | null; // null = новий
  series: TournamentSeries[];
  /** ГМ (не суперадмін) не бачить вибір серії — його турніри завжди
   * одноразові й "unlisted" (не публічні), задається автоматично при створенні. */
  isSuperadmin: boolean;
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function TournamentEditor({ initial, series, isSuperadmin, currentUserId, onClose, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [eventDate, setEventDate] = useState(initial?.eventDate ?? new Date().toISOString().slice(0, 10));
  // Сайт спрощено до однієї активної серії — вибір серії в UI прибрано,
  // новий турнір мовчки прив'язується до активної (якщо є); при редагуванні
  // існуючого турніру seriesId лишається як був, історію не чіпаємо.
  const [seriesId] = useState(initial?.seriesId ?? series.find((s) => s.isActive)?.id ?? '');
  const [status, setStatus] = useState<TournamentStatus>(initial?.status ?? 'draft');
  const [rulesMd, setRulesMd] = useState(initial?.rulesMd ?? '');
  // Правила рядками (0027): знімок довідника. Новий турнір — конструктор
  // (дефолти формату, поки адмін не зберіг попап); старий турнір без
  // rule_flags — textarea як раніше, доки не збережуть попап після «Перейти на
  // конструктор» (ГМ інакше не виправив би текст турніру, створеного кроном
  // серії). Кандидат конверсії (pendingFlags) живе окремо, поки попап не
  // збережено: «Скасувати» повертає textarea, а «Зберегти» редактора без
  // збереженого попапу rule_flags не пише.
  const { loaded: catalogLoaded, items: catalog } = useRuleCatalog();
  const [ruleFlags, setRuleFlags] = useState<TournamentRuleFlags | null>(initial?.ruleFlags ?? null);
  const [legacyText, setLegacyText] = useState(!!initial && initial.ruleFlags === null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [pendingFlags, setPendingFlags] = useState<TournamentRuleFlags | null>(null);
  const [prizesMd, setPrizesMd] = useState(initial?.prizesMd ?? '');
  const [bracketType, setBracketType] = useState<BracketType>(initial?.bracketType ?? 'single_elim');
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(initial?.thirdPlaceMatch ?? false);
  const [bracketNewLook, setBracketNewLook] = useState(initial?.bracketNewLook ?? true);
  const [teamMode, setTeamMode] = useState(!!initial?.teamSize);
  const [teamSize, setTeamSize] = useState(initial?.teamSize ?? 5);
  // Спосіб формування команд — має значення лише при увімкненому «Командний турнір».
  const [teamModeSel, setTeamModeSel] = useState<TeamMode>(initial?.teamMode ?? 'fixed');
  // Заявки існуючого турніру: null = ще не знаємо — режим і розмір команди
  // тримаємо заблокованими, поки не перевірили заявки. Блокуємо лише те, що
  // справді ламається:
  //  • режим (соло / готові команди / фул-рандом) — при підтверджених заявках:
  //    анкети в режимах різні;
  //  • розмір команди у готових командах — теж при підтверджених: заявка там —
  //    список з N ніків;
  //  • розмір команди у фул-рандомі — лише коли команди вже сформовані. Анкета
  //    гравця від розміру не залежить, а гір-скор рахується на читанні з поточного
  //    team_size (колонка матриці «клас × розмір паті»), тож після зміни все
  //    перерахується само. Сформовані команди (і знімок скорів у balance_stats)
  //    спершу треба розформувати.
  // total рахує й team-рядки фул-рандому, players — лише заявки гравців (для підказки),
  // confirmed — усі підтверджені рядки, teams — сформовані команди фул-рандому.
  const [regInfo, setRegInfo] = useState<{ total: number; players: number; confirmed: number; teams: number } | null>(
    initial ? null : { total: 0, players: 0, confirmed: 0, teams: 0 },
  );
  const [regCheckFailed, setRegCheckFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const initialId = initial?.id;
  useEffect(() => {
    if (!initialId) return;
    let cancelled = false;
    fetchRegistrations(initialId)
      .then((rs) => {
        if (!cancelled)
          setRegInfo({
            total: rs.length,
            players: rs.filter((r) => r.kind === 'player').length,
            confirmed: rs.filter((r) => r.status === 'confirmed').length,
            teams: rs.filter((r) => r.kind === 'team').length,
          });
      })
      .catch(() => {
        if (!cancelled) setRegCheckFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const mode: TeamMode = teamMode ? teamModeSel : 'fixed';
  const locked = regInfo === null || regInfo.confirmed > 0;
  const lockedStyle = locked ? { opacity: 0.5, cursor: 'not-allowed' as const } : undefined;
  // Режим при підтверджених заявках не змінюється, тож teamModeSel тут = збережений режим.
  const balancedSel = teamModeSel === 'balanced_random';
  const sizeLocked = regInfo === null || (balancedSel ? regInfo.teams > 0 : regInfo.confirmed > 0);
  const sizeLockedStyle = sizeLocked ? { opacity: 0.5, cursor: 'not-allowed' as const } : undefined;

  const effectiveTeamSize = teamMode ? teamSize : null;
  // Знімок, який піде в турнір у режимі конструктора: свій (після попапу) або
  // дефолти довідника для поточного формату — але лише коли довідник
  // довантажився, інакше у знімок пішов би вбудований текст.
  const constructorFlags: TournamentRuleFlags | null = legacyText ? null : ruleFlags ?? (catalogLoaded ? defaultFlagsFor(catalog, effectiveTeamSize, mode) : null);
  const rulesReady = legacyText || constructorFlags !== null;
  const rulesPreview = constructorFlags ? renderRulesMd(constructorFlags, effectiveTeamSize, mode) : '';
  // Після зміни формату (чи довідника) у знімку можуть бути рядки не для цього
  // формату або бракувати нових — попап покаже це чіпами, тут лише підказка.
  const rulesMismatch = !!ruleFlags && !legacyText && (() => {
    const want = itemsForFormat(catalog, formatOf(effectiveTeamSize, mode)).map((i) => i.key);
    const have = ruleFlags.items.map((i) => i.key);
    return want.some((k) => !have.includes(k)) || have.some((k) => !want.includes(k));
  })();
  // Рядки, що впливають на жеребку, після формування команд не змінюються (як sizeLocked).
  const drawLocked = balancedSel && (regInfo === null || regInfo.teams > 0);

  const save = async () => {
    if (!name.trim() || !rulesReady) return;
    setBusy(true);
    setErr(null);
    const input: TournamentInput = {
      seriesId: seriesId || null,
      name: name.trim(),
      eventDate,
      status,
      // Конструктор: rules_md генерується зі знімка (сторінка турніру й реєстрація
      // читають лише текст); старий textarea — текст як є, rule_flags не чіпаємо.
      rulesMd: constructorFlags ? rulesPreview : rulesMd,
      prizesMd,
      bracketType,
      teamSize: effectiveTeamSize,
      teamMode: mode,
      thirdPlaceMatch,
      bracketNewLook,
      ...(constructorFlags ? { ruleFlags: constructorFlags } : {}),
    };
    try {
      if (initial) await updateTournament(initial.id, input);
      else await createTournament(input, { createdBy: currentUserId, visibility: isSuperadmin ? 'public' : 'unlisted' });
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося зберегти турнір.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" style={{ width: 'min(640px, 100%)' }}>
        <div className="modal-head">
          <h3>{initial ? 'Редагувати турнір' : 'Новий турнір'}</h3>
          <button type="button" className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field-row">
            <label className="field" style={{ flex: '1 1 260px' }}>
              <span>Назва турніру</span>
              <input type="text" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="Кубок сервера #1" />
            </label>
            <label className="field" style={{ flex: '0 0 160px' }}>
              <span>Дата</span>
              <input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>Статус</span>
              <select value={status} onChange={(e) => setStatus(e.target.value as TournamentStatus)}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
              </select>
            </label>
          </div>
          {!isSuperadmin && !initial && (
            <p className="hint">Твої турніри не показуються на публічних сторінках — лише за прямим посиланням (скопіюєш зі списку після створення).</p>
          )}
          <label className="field">
            <span>Тип сітки</span>
            <select
              value={bracketType}
              onChange={(e) => {
                const v = e.target.value as BracketType;
                setBracketType(v);
                if (v === 'double_elim') setThirdPlaceMatch(false);
              }}
            >
              <option value="single_elim">Одинарна елімінація</option>
              <option value="double_elim">Подвійна елімінація (лише степінь двійки учасників, без байів)</option>
            </select>
            {bracketType === 'double_elim' && mode === 'balanced_random' && (
              <small className="hint">
                Подвійна елімінація потребує кількість команд = степінь двійки (4, 8, 16). Кількість команд обираєш під час формування — зайві гравці підуть у резерв.
              </small>
            )}
          </label>
          <label className="checkbox-row" style={bracketType !== 'single_elim' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            <input
              type="checkbox"
              checked={thirdPlaceMatch}
              disabled={bracketType !== 'single_elim'}
              onChange={(e) => setThirdPlaceMatch(e.target.checked)}
            />
            Матч за 3-тє місце (лише одинарна елімінація)
          </label>
          <label className="checkbox-row" style={bracketType !== 'single_elim' ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}>
            <input
              type="checkbox"
              checked={bracketNewLook}
              disabled={bracketType !== 'single_elim'}
              onChange={(e) => setBracketNewLook(e.target.checked)}
            />
            Новий вигляд сітки (дзеркальна, лише одинарна елімінація)
          </label>
          {/* Той самий lock, що й для режиму/розміру: зняти «командність» при
              наявних заявках означало б соло-турнір з анкетами/списками ніків у базі. */}
          <label className="checkbox-row" style={lockedStyle} title={locked ? 'Режим не змінюється — вже є підтверджені заявки' : undefined}>
            <input type="checkbox" checked={teamMode} disabled={locked} onChange={(e) => setTeamMode(e.target.checked)} />
            Командний турнір
          </label>
          {teamMode && (
            <>
              <div className="field-row">
                <label className="field" style={{ flex: '0 0 170px', ...sizeLockedStyle }}>
                  <span>Людей у команді</span>
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={teamSize}
                    disabled={sizeLocked}
                    onChange={(e) => setTeamSize(Math.max(2, parseInt(e.target.value, 10) || 2))}
                  />
                </label>
                <label className="field" style={lockedStyle}>
                  <span>Формування команд</span>
                  <select value={teamModeSel} disabled={locked} onChange={(e) => setTeamModeSel(e.target.value as TeamMode)}>
                    <option value="fixed">Готові команди</option>
                    <option value="balanced_random">Балансний фул-рандом</option>
                  </select>
                </label>
              </div>
              {teamModeSel === 'balanced_random' && (
                <p className="hint">
                  Гравці реєструються поодинці й заповнюють коротку анкету спорядження — команди по {teamSize} формує система випадково, вирівнюючи гір-скор і класи.
                </p>
              )}
              {regInfo === null ? (
                <p className="hint">{regCheckFailed ? 'Не вдалося перевірити заявки — режим і розмір команди заблоковано.' : 'Перевіряю заявки…'}</p>
              ) : balancedSel && regInfo.teams > 0 ? (
                <p className="hint">
                  Команди вже сформовані — щоб змінити розмір команди, спершу розформуй їх (блок «Команди» турніру).
                  Режим не змінюється — є підтверджені заявки.
                </p>
              ) : balancedSel && regInfo.confirmed > 0 ? (
                <p className="hint">
                  Режим не змінюється — вже є підтверджені заявки ({regInfo.confirmed}). Розмір команди змінити можна:
                  бали за клас перерахуються за колонкою «клас × розмір паті» для нового розміру.
                </p>
              ) : regInfo.confirmed > 0 ? (
                <p className="hint">Режим і розмір команди не змінюються — вже є підтверджені заявки ({regInfo.confirmed}).</p>
              ) : regInfo.total > 0 && balancedSel ? (
                <p className="hint">
                  Заявок на розгляді: {regInfo.players}. Розмір команди змінюй вільно; зміна режиму зробить ці анкети
                  неузгодженими — їх доведеться подати заново.
                </p>
              ) : regInfo.total > 0 ? (
                <p className="hint">
                  Заявок на розгляді: {regInfo.players}. Змінити режим чи розмір команди ще можна, але ці заявки стануть
                  неузгодженими — анкети та списки ніків доведеться подати заново.
                </p>
              ) : null}
            </>
          )}
          {legacyText ? (
            <label className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Правила</span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (rulesMd.trim() && !confirm('Замінити поточний текст правил стандартними?')) return;
                      setRulesMd(standardRulesFor(effectiveTeamSize, mode, catalog));
                    }}
                  >
                    Вставити стандартні правила ({standardRulesLabel(effectiveTeamSize, mode)})
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={!catalogLoaded}
                    title={catalogLoaded ? 'Рядки довідника для формату + цей текст у «Додатково»' : 'Зачекай, довідник довантажується'}
                    onClick={() => {
                      setPendingFlags(flagsFromLegacyText(rulesMd, catalog, effectiveTeamSize, mode));
                      setRulesOpen(true);
                    }}
                  >
                    Перейти на конструктор
                  </button>
                </div>
              </div>
              <textarea rows={4} value={rulesMd} onChange={(e) => setRulesMd(e.target.value)} />
              <small className="hint">
                Цей турнір зберігає правила вільним текстом. «Перейти на конструктор» підставить рядки довідника для формату, а цей текст
                покладе в «Додатково» по рядках — дублі прибереш у попапі.
              </small>
            </label>
          ) : (
            <div className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Правила</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!catalogLoaded && !ruleFlags}
                  title={catalogLoaded || ruleFlags ? 'Галочки й параметри з довідника; текст збирається сам' : 'Зачекай, довідник довантажується'}
                  onClick={() => setRulesOpen(true)}
                >
                  Правила…
                </button>
              </div>
              <pre
                style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.5, padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 12, maxHeight: 160, overflowY: 'auto', color: 'var(--text-dim)' }}
              >
                {rulesPreview || 'довантажую довідник…'}
              </pre>
              {constructorFlags && drawSummary(constructorFlags, catalog).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {drawSummary(constructorFlags, catalog).map((c) => <span key={c} className="badge mute">{c}</span>)}
                </div>
              )}
              <small className="hint">
                {rulesMismatch
                  ? 'Формат або довідник змінились — відкрий «Правила…» і перевір рядки (кнопка «Стандартні для формату»).'
                  : ruleFlags
                    ? 'Текст зафіксовано на момент збереження — правки довідника цей турнір не змінюють.'
                    : 'Стандартні рядки довідника для формату — зміниш у «Правила…».'}
              </small>
            </div>
          )}
          <label className="field">
            <span>Призи</span>
            <textarea rows={3} value={prizesMd} onChange={(e) => setPrizesMd(e.target.value)} />
          </label>
          {err && <p className="form-err">{err}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Скасувати</button>
          {!rulesReady && <span className="hint" style={{ margin: 0 }}>довантажую довідник правил…</span>}
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !rulesReady} onClick={save}>Зберегти</button>
        </div>
      </div>
      {rulesOpen && (
        <RulesPopup
          teamSize={effectiveTeamSize}
          teamMode={mode}
          initial={pendingFlags ?? ruleFlags}
          drawLocked={drawLocked}
          confirmedCount={regInfo?.confirmed ?? 0}
          onClose={() => { setPendingFlags(null); setRulesOpen(false); }}
          onSave={(flags) => {
            // Перший збережений попап старого турніру — і є перехід на конструктор.
            setRuleFlags(flags);
            setLegacyText(false);
            setPendingFlags(null);
            setRulesOpen(false);
          }}
        />
      )}
    </div>
  );
}
