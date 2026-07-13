import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

/** Одноразовий клієнт БЕЗ збереження сесії — потрібен, щоб адмін міг
 * створити новий Auth-акаунт (signUp) для ГМ-а, не "підмінивши" власну
 * залогинену сесію в основному `supabase` (auth.signUp на тому самому
 * клієнті переключив би поточну вкладку на щойно створений акаунт). */
export function createEphemeralClient() {
  return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
