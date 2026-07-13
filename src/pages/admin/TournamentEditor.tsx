// =========================================================
// Адмінка: модалка створення/редагування турніру — назва, дата,
// серія, статус, правила, призи, тип сітки.
// =========================================================

import { useState } from 'react';
import { errorMessage } from '../../app/errorMessage';
import type { BracketType, Tournament, TournamentSeries, TournamentStatus } from '../../data/types';
import { STATUS_LABELS } from '../../data/types';
import { createTournament, updateTournament, type TournamentInput } from '../../data/tournaments';
import { standardRulesFor, standardRulesLabel } from '../../data/standardRules';

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
  const [seriesId, setSeriesId] = useState(initial?.seriesId ?? '');
  const [status, setStatus] = useState<TournamentStatus>(initial?.status ?? 'draft');
  const [rulesMd, setRulesMd] = useState(initial?.rulesMd ?? '');
  const [prizesMd, setPrizesMd] = useState(initial?.prizesMd ?? '');
  const [bracketType, setBracketType] = useState<BracketType>(initial?.bracketType ?? 'single_elim');
  const [thirdPlaceMatch, setThirdPlaceMatch] = useState(initial?.thirdPlaceMatch ?? false);
  const [teamMode, setTeamMode] = useState(!!initial?.teamSize);
  const [teamSize, setTeamSize] = useState(initial?.teamSize ?? 5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    const input: TournamentInput = {
      seriesId: seriesId || null,
      name: name.trim(),
      eventDate,
      status,
      rulesMd,
      prizesMd,
      bracketType,
      teamSize: teamMode ? teamSize : null,
      thirdPlaceMatch,
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
            {isSuperadmin && (
              <label className="field">
                <span>Серія (регулярний турнір)</span>
                <select value={seriesId} onChange={(e) => setSeriesId(e.target.value)}>
                  <option value="">— одноразовий —</option>
                  {series.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </label>
            )}
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
          <label className="checkbox-row">
            <input type="checkbox" checked={teamMode} onChange={(e) => setTeamMode(e.target.checked)} />
            Командний турнір
          </label>
          {teamMode && (
            <label className="field" style={{ maxWidth: 200 }}>
              <span>Кількість людей в команді</span>
              <input
                type="number"
                min={2}
                max={20}
                value={teamSize}
                onChange={(e) => setTeamSize(Math.max(2, parseInt(e.target.value, 10) || 2))}
              />
            </label>
          )}
          <label className="field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Правила</span>
              {(() => {
                const effectiveTeamSize = teamMode ? teamSize : null;
                const preset = standardRulesFor(effectiveTeamSize);
                if (!preset) return null;
                return (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (rulesMd.trim() && !confirm('Замінити поточний текст правил стандартними?')) return;
                      setRulesMd(preset);
                    }}
                  >
                    Вставити стандартні правила ({standardRulesLabel(effectiveTeamSize)})
                  </button>
                );
              })()}
            </div>
            <textarea rows={4} value={rulesMd} onChange={(e) => setRulesMd(e.target.value)} />
          </label>
          <label className="field">
            <span>Призи</span>
            <textarea rows={3} value={prizesMd} onChange={(e) => setPrizesMd(e.target.value)} />
          </label>
          {err && <p className="form-err">{err}</p>}
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Скасувати</button>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>Зберегти</button>
        </div>
      </div>
    </div>
  );
}
