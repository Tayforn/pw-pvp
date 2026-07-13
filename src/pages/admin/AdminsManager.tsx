// =========================================================
// Адмінка: керування ГМ/адмінами — лише для суперадміна.
// =========================================================

import { useEffect, useState } from 'react';
import { errorMessage, reportError } from '../../app/errorMessage';
import type { AdminRow } from '../../data/admins';
import { createGmAccount, fetchAdmins, removeAdmin, setAdminRole } from '../../data/admins';
import { deleteTournamentsByOwner } from '../../data/tournaments';

const ROLE_LABEL = { superadmin: 'Суперадмін', gm: 'ГМ' } as const;

export default function AdminsManager({ currentUserId }: { currentUserId: string }) {
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ email: string; password: string | null; alreadyExisted: boolean } | null>(null);

  const reload = () => fetchAdmins().then(setAdmins);
  useEffect(() => {
    reload();
  }, []);

  const add = async () => {
    if (!email.trim()) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const { password, alreadyExisted } = await createGmAccount(email);
      setResult({ email: email.trim(), password, alreadyExisted });
      setEmail('');
      reload();
    } catch (e) {
      setErr(errorMessage(e, 'Не вдалося створити ГМ-а.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3>Адміни / ГМ</h3>
      <p className="hint" style={{ marginTop: -8, marginBottom: 14 }}>
        ГМ бачить і керує лише своїми турнірами; вони не показуються на публічних сторінках — лише за прямим посиланням.
        Видалення ГМ-а не видаляє його турніри.
      </p>

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        {admins.map((a) => (
          <div key={a.userId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            <span>{a.email}</span>
            <span className={'badge ' + (a.role === 'superadmin' ? 'warn' : 'mute')} style={{ marginLeft: 'auto' }}>{ROLE_LABEL[a.role]}</span>
            {a.userId === currentUserId ? (
              <span className="hint" style={{ margin: 0 }}>(ти)</span>
            ) : (
              <>
                {a.role !== 'superadmin' && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAdminRole(a.userId, 'superadmin').then(reload).catch(reportError)}
                  >
                    Підвищити до суперадміна
                  </button>
                )}
                {a.role !== 'superadmin' && (
                  <button
                    type="button"
                    className="btn btn-bad btn-sm"
                    onClick={() => confirm(`Видалити права адміна для «${a.email}»? Його турніри залишаться.`) && removeAdmin(a.userId).then(reload).catch(reportError)}
                  >
                    Видалити
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-bad btn-sm"
                  onClick={() =>
                    confirm(`Видалити ВСІ турніри «${a.email}» (разом із заявками й сітками)? Це незворотньо.`) &&
                    deleteTournamentsByOwner(a.userId).catch(reportError)
                  }
                >
                  Очистити турніри
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="card field-row" style={{ alignItems: 'flex-end' }}>
        <label className="field">
          <span>Логін нового ГМ-а (у форматі email)</span>
          <input type="email" value={email} placeholder="напр. pukpuk@gm.local — не обов'язково реальна пошта" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <button type="button" className="btn btn-primary" disabled={busy || !email.trim()} onClick={add}>
          {busy ? 'Створення…' : '+ Створити ГМ-а'}
        </button>
      </div>
      <p className="hint">
        Акаунт створюється тут же — окремо в Supabase заходити не треба. Це просто логін у форматі email (Supabase
        технічно завжди працює через це поле) — реальна поштова скринька не потрібна, підійде й вигаданий домен
        (напр. <code>gm.local</code>). Але щоб це працювало, у Dashboard → Authentication → Providers → Email мають
        бути: 1) увімкнена реєстрація, 2) вимкнене "Confirm email" (інакше вигаданий домен ніколи не підтвердиться).
      </p>
      {err && <p className="form-err">{err}</p>}

      {result && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--accent)' }}>
          {result.alreadyExisted ? (
            <p style={{ margin: 0 }}>
              Акаунт <b>{result.email}</b> уже існував — просто видано роль ГМ, пароль лишився його попереднім (той, яким він і раніше логинився).
            </p>
          ) : (
            <>
              <p style={{ margin: '0 0 8px' }}>
                Акаунт <b>{result.email}</b> створено. Передай ГМ-у ці дані для входу (пароль показується лише зараз, більше ніде не збережений):
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 15, padding: '6px 10px' }}>{result.password}</code>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard?.writeText(result.password ?? '')}>
                  Копіювати
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
