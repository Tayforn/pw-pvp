// =========================================================
// Стан авторизації адміна: сесія Supabase Auth + перевірка allow-list
// таблиці `admins` (RLS-функції is_admin()/is_superadmin() дзеркалять цю ж
// перевірку на стороні бази — цей хук лише для UI-стану).
//
// role: 'superadmin' бачить і керує всіма турнірами; 'gm' — лише своїми
// (created_by = його user_id), і його турніри приховані з публічних сторінок
// (див. data/tournaments.ts fetchPublicTournaments vs fetchAdminTournaments).
// =========================================================

import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export type AdminRole = 'superadmin' | 'gm';

interface AuthState {
  session: Session | null;
  isAdmin: boolean;
  role: AdminRole | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function checkAdmin(s: Session | null) {
      if (!s) {
        if (!cancelled) {
          setIsAdmin(false);
          setRole(null);
        }
        return;
      }
      const { data } = await supabase.from('admins').select('role').eq('user_id', s.user.id).maybeSingle();
      if (!cancelled) {
        setIsAdmin(!!data);
        setRole((data as { role: AdminRole } | null)?.role ?? null);
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      checkAdmin(data.session).finally(() => !cancelled && setLoading(false));
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(true);
      checkAdmin(s).finally(() => !cancelled && setLoading(false));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, isAdmin, role, loading };
}
