// =========================================================
// Турнір + заявки + сітка з живим оновленням (realtime-підписка й
// перечитування при поверненні на вкладку). Спільне для сторінки турніру
// й окремої сторінки сітки за посиланням «Поділитися».
// =========================================================

import { useCallback, useEffect, useState } from 'react';
import type { BracketMatch, Registration, Tournament } from '../data/types';
import { fetchRegistrations, fetchTournament, subscribeToTournamentChanges } from '../data/tournaments';
import { fetchBracket } from '../data/bracket';

export interface TournamentLive {
  /** undefined — ще вантажиться, null — немає такого турніру. */
  tournament: Tournament | null | undefined;
  registrations: Registration[];
  bracket: BracketMatch[];
  updatedAt: Date | null;
  refreshing: boolean;
  reload: () => void;
}

export function useTournamentLive(id: string): TournamentLive {
  const [tournament, setTournament] = useState<Tournament | null | undefined>(undefined);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [bracket, setBracket] = useState<BracketMatch[]>([]);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setRefreshing(true);
      try {
        const [t, regs, matches] = await Promise.all([fetchTournament(id), fetchRegistrations(id), fetchBracket(id)]);
        if (!alive) return;
        setTournament(t);
        setRegistrations(regs);
        setBracket(matches);
        setUpdatedAt(new Date());
      } finally {
        if (alive) setRefreshing(false);
      }
    };
    load().catch(() => { /* помилка мережі — лишаємо те, що є */ });
    // Телефон заснув → realtime-вебсокет упав, події за цей час втрачено;
    // при поверненні на вкладку перечитуємо все.
    const onWake = () => { if (document.visibilityState === 'visible') load().catch(() => {}); };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    const unsubscribe = subscribeToTournamentChanges(() => { load().catch(() => {}); });
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
      unsubscribe();
    };
  }, [id, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  return { tournament, registrations, bracket, updatedAt, refreshing, reload };
}
