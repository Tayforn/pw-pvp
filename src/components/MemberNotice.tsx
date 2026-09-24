// =========================================================
// Заглушка для розділів, доступних лише тим, хто увійшов через Discord
// (сервер клану). Гостю — пояснення, кнопка входу й те, що можна без неї.
// =========================================================

import { routeUrl } from '../app/useRoute';

export default function MemberNotice({ onLogin, compact }: { onLogin: () => void; compact?: boolean }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: compact ? '20px 16px' : '32px 20px', maxWidth: 520, margin: compact ? '0 auto 18px' : '24px auto' }}>
      <h3 style={{ marginTop: 0 }}>{compact ? 'Учасники й сітка — для своїх' : 'Розділ для своїх'}</h3>
      <p className="hint" style={{ margin: '0 auto 18px', maxWidth: 400 }}>
        {compact
          ? 'Склади, учасників і сітку поточного турніру бачать ті, хто увійшов через Discord з сервера клану.'
          : 'Цей розділ бачать ті, хто увійшов через Discord з сервера клану.'}
      </p>
      <button type="button" className="btn btn-primary" onClick={onLogin}>
        Увійти через Discord
      </button>
      <p className="hint" style={{ margin: '16px 0 0', fontSize: 12 }}>
        Без входу можна{' '}
        <a className="link" href={routeUrl({ name: 'register' })} data-goto="register">подати заявку</a>
        {' '}і переглянути{' '}
        <a className="link" href={routeUrl({ name: 'tournaments' })} data-goto="tournaments">минулі турніри</a>.
      </p>
    </div>
  );
}
