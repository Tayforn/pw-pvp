// =========================================================
// id своїх збережених персонажів (вхід через Discord) — щоб знайти свої заявки
// персонажами, подані з будь-якого пристрою («Мої заявки», банер на сторінці
// турніру). Список питаємо в бекенда (/api/pvp/characters) один раз на
// завантаження сторінки; невдача — порожньо (лишаються заявки з цього браузера)
// і наступний виклик спробує знову.
// =========================================================

import { useEffect, useState } from 'react';
import { listCharacters } from '../doll/api/characters';

let idsPromise: Promise<string[]> | null = null;

export function loadMyCharacterIds(): Promise<string[]> {
  idsPromise ??= listCharacters()
    .then((r) => r.characters.map((c) => c.id))
    .catch(() => {
      idsPromise = null;
      return [];
    });
  return idsPromise;
}

/** id своїх персонажів; [] — не увійшов (enabled = false); null — ще вантажиться. */
export function useMyCharacterIds(enabled: boolean): string[] | null {
  const [ids, setIds] = useState<string[] | null>(enabled ? null : []);
  useEffect(() => {
    if (!enabled) {
      setIds([]);
      return;
    }
    let alive = true;
    setIds(null);
    loadMyCharacterIds().then((x) => { if (alive) setIds(x); });
    return () => { alive = false; };
  }, [enabled]);
  return ids;
}
