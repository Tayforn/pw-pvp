// =========================================================
// Discord-сесія спільна для піддоменів thunderpw.fun (cookie на
// .thunderpw.fun, бекенд ладдера за /api). Тут потрібне лише ім'я — щоб
// підставити нік у заявку. Не залогінений → null, і нічого не змінюється.
// =========================================================

import { useEffect, useState } from 'react';

export interface DiscordMe {
  playerId: string;
  nickname: string;
  avatarUrl: string | null;
}

export function useDiscordMe(): { me: DiscordMe | null; loading: boolean } {
  const [me, setMe] = useState<DiscordMe | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch('/api/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (alive) setMe(data as DiscordMe | null); })
      .catch(() => { if (alive) setMe(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return { me, loading };
}
