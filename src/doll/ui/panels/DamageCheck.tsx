// =========================================================
// ЛЯЛЬКА — перевірка урону по мобу-супернику (порт блоку Хелпера). Згорнута
// за замовчуванням: це не частина скору, а інструмент «скільки я вдарю».
// Суперника редагує модалка каркаса (openOpponent); тут — його коротка
// картка, скіли класу і лог. Лог живе в контексті редактора як обʼєкти
// (DmgLogEntry), а не HTML-рядки Хелпера. Рахується активна конфігурація
// разом з увімкненими станами — так само, як у Хелпері.
// =========================================================

import { useMemo, useState, type SyntheticEvent } from 'react';
import { XZ } from '../../core/constants';
import { computeSkillDamage, DEFAULT_OPP, oppMagReductionPerc, oppReductionPerc } from '../../core/damage';
import { getSkills, hasRefData } from '../../core/refdata';
import type { DmgLogEntry, OppMob, SkillDef } from '../../core/types';
import { buffIconStyle } from '../../data/assets';
import { useEditor } from '../EditorContext';
import { calcFor, fmt, type CfgCalc } from './summaryGroups';
import '../doll-panels.css';

/** Вміння класу з довідника (без безіменних службових записів), як у Хелпері. */
export function classSkills(cls: string): SkillDef[] {
  return (getSkills()?.[String(XZ[cls] || 1)] || []).filter((sk) => sk.name);
}

/** Порядковий номер нового запису — за найбільшим у логу (ключ рядка в списку). */
export function nextLogId(log: DmgLogEntry[]): number {
  return log.reduce((m, e) => Math.max(m, e.id), 0) + 1;
}

/** Запис логу для скіла — чиста функція (урон ядра по супернику). */
export function logEntry(calc: CfgCalc, opp: OppMob, sk: SkillDef, id: number): DmgLogEntry {
  const d = computeSkillDamage(calc.summary.char, opp, sk, calc.build.level, calc.t, calc.ib);
  return { id, mob: opp.name || 'Суперник', skill: sk.name, an: sk.an, d };
}

// Суперник — уподобання браузера, а не частина документа, тож його можна
// налаштувати й на чужому персонажі (readOnly стосується лише документа).
function OpponentBrief({ opp, level, onEdit, onReset }: { opp: OppMob; level: number; onEdit(): void; onReset(): void }) {
  // % зрізання — від рівня персонажа, як у формулі урону.
  const physRed = oppReductionPerc(opp, 'phys', level);
  const magRed = oppMagReductionPerc(opp, level);
  const magAvg = (opp.lw + opp.mo + opp.dn + opp.vt + opp.sp) / 5;
  return (
    <div className="doll-dmg-opp">
      <div className="doll-dmg-opp-title">
        <b>{opp.name || 'Суперник'}</b>
        <span className="doll-pn-note">ур. {fmt(opp.level)}</span>
      </div>
      <div className="doll-dmg-opp-nums">
        <span>
          здоровʼя <b>{fmt(opp.hp)}</b>
        </span>
        <span>
          фіз. захист <b>{fmt(opp.physDef)}</b> <i>(−{physRed.toFixed(1)}%)</i>
        </span>
        <span>
          маг. захист (сер.) <b>{fmt(magAvg)}</b> <i>(−{magRed.toFixed(1)}%)</i>
        </span>
      </div>
      <div className="doll-dmg-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onEdit}>
          Налаштувати суперника
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onReset}>
          Скинути суперника
        </button>
      </div>
    </div>
  );
}

export interface DamageBodyProps {
  calc: CfgCalc;
  opponent: OppMob;
  log: DmgLogEntry[]; // новіші зверху
  onHit(sk: SkillDef): void;
  onClear(): void;
  onEditOpp(): void;
  onResetOpp(): void;
}

/** Вміст розгорнутої панелі — без контексту (для тестів). */
export function DamageBody({ calc, opponent, log, onHit, onClear, onEditOpp, onResetOpp }: DamageBodyProps) {
  const ready = hasRefData();
  const skills = ready ? classSkills(calc.build.cls) : [];
  return (
    <div className="doll-dmg-body">
      <OpponentBrief opp={opponent} level={calc.build.level} onEdit={onEditOpp} onReset={onResetOpp} />
      <h4 className="doll-pn-sub">
        Скіли класу <span className="doll-pn-note">натисни — урон додасться в лог</span>
      </h4>
      {!ready ? (
        <p className="doll-pn-note">Завантаження скілів…</p>
      ) : skills.length === 0 ? (
        <p className="doll-pn-note">Для цього класу даних скілів немає.</p>
      ) : (
        <div className="doll-skill-grid">
          {skills.map((sk) => (
            <button type="button" className="doll-skill" key={sk.id} title={sk.name} onClick={() => onHit(sk)}>
              <span className="doll-skill-ic" style={buffIconStyle(sk.an)} />
              <span className="doll-skill-cap">{sk.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="doll-dmg-loghead">
        <h4 className="doll-pn-sub">Лог урону</h4>
        {log.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
            Очистити
          </button>
        )}
      </div>
      {log.length ? (
        <ul className="doll-dmg-log" aria-live="polite">
          {log.map((e) => (
            <li className="doll-dmg-line" key={e.id}>
              <span className="doll-dmg-ic" style={buffIconStyle(e.an)} />
              <span className="doll-dmg-txt">
                <b>{e.mob}</b> отримує від «{e.skill}» <span className="doll-dmg-v">{fmt(e.d.min)}–{fmt(e.d.max)}</span> урону, крит{' '}
                <span className="doll-dmg-v">
                  {fmt(e.d.critMin)}–{fmt(e.d.critMax)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="doll-pn-note doll-dmg-empty">Натисни на скіл — урон зʼявиться тут.</p>
      )}
    </div>
  );
}

/** Панель «Перевірка урону»: згорнута за замовчуванням; defaultOpen — для тестів і прямих посилань. */
export function DamageCheck({ defaultOpen = false }: { defaultOpen?: boolean } = {}) {
  const api = useEditor();
  const [open, setOpen] = useState(defaultOpen);
  const calc = useMemo(() => calcFor(api.model, api.activeCfg), [api.model, api.activeCfg]);
  // Лог у контексті вже новіші-зверху (pushDmg додає на початок).
  const hit = (sk: SkillDef) => api.pushDmg(logEntry(calc, api.opponent, sk, nextLogId(api.dmgLog)));

  return (
    <section className={'card doll-pn doll-dmg' + (open ? ' is-open' : '')} aria-label="Перевірка урону">
      <details open={open} onToggle={(e: SyntheticEvent<HTMLDetailsElement>) => setOpen(e.currentTarget.open)}>
        <summary>
          <h3>Перевірка урону</h3>
          <span className="doll-pn-tag mute">у скор не входить</span>
          <span className="doll-pn-note">урон скілів по налаштованому суперникові</span>
        </summary>
        {open && (
          <DamageBody
            calc={calc}
            opponent={api.opponent}
            log={api.dmgLog}
            onHit={hit}
            onClear={api.clearDmg}
            onEditOpp={api.openOpponent}
            onResetOpp={() => api.setOpponent({ ...DEFAULT_OPP })}
          />
        )}
      </details>
    </section>
  );
}

export default DamageCheck;
