// =========================================================
// pw-pvp: керування ГМ/адмінами (лише суперадмін — RPC самі це
// перевіряють на стороні бази, це друга лінія захисту, не єдина).
// =========================================================

import { createEphemeralClient, supabase } from '../app/supabaseClient';
import type { AdminRole } from '../app/useAuth';

export interface AdminRow {
  userId: string;
  email: string;
  role: AdminRole;
  createdAt: string;
}

interface AdminDbRow { user_id: string; email: string; role: AdminRole; created_at: string }

export async function fetchAdmins(): Promise<AdminRow[]> {
  const { data, error } = await supabase.from('admins').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data as AdminDbRow[]).map((r) => ({ userId: r.user_id, email: r.email, role: r.role, createdAt: r.created_at }));
}

/** Підвищує вже існуючий Supabase Auth-акаунт (за email) до ГМ — використовується
 * як запасний варіант, якщо акаунт з таким email уже є (напр. створений раніше
 * через Dashboard, чи createGmAccount виявив, що він уже існував). */
export async function addGm(email: string): Promise<void> {
  const { error } = await supabase.rpc('admin_add_gm', { target_email: email.trim() });
  if (error) throw error;
}

function randomPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.getRandomValues(new Uint32Array(14));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Створює НОВИЙ Supabase Auth-акаунт (email + згенерований пароль) через
 * auth.signUp — працює лише з anon-ключем, service-role не потрібен. Робить
 * це на ЕФЕМЕРНОМУ клієнті (createEphemeralClient), щоб не підмінити сесію
 * поточного суперадміна. Одразу після — підвищує цей акаунт до ГМ через RPC
 * (на основному, залогиненому клієнті). Повертає згенерований пароль, щоб
 * суперадмін передав його ГМ-у (Supabase міг ще й надіслати лист-підтвердження
 * на пошту — залежить від налаштувань проєкту "Confirm email").
 *
 * Якщо акаунт з таким email уже існує, Supabase (з міркувань анти-enumeration)
 * не завжди повертає явну помилку — це визначається по `identities: []` у
 * відповіді. У такому разі пароль НЕ змінюється, просто видається роль ГМ. */
export async function createGmAccount(email: string): Promise<{ password: string | null; alreadyExisted: boolean }> {
  const trimmed = email.trim();
  const password = randomPassword();
  const ephemeral = createEphemeralClient();
  const { data, error } = await ephemeral.auth.signUp({ email: trimmed, password });

  const alreadyExisted = !!error && /already registered|already exists/i.test(error.message) ? true : !!data?.user && data.user.identities?.length === 0;

  if (error && !alreadyExisted) {
    // 429 тут майже завжди — ліміт Supabase на відправку email-листів
    // підтвердження (вбудований тестовий SMTP дуже обмежений: кілька листів
    // на годину). Найпростіший постійний фікс — вимкнути "Confirm email" в
    // Dashboard → Authentication → Providers → Email (для внутрішньої
    // адмінки, де ГМ-ів і так вручну перевіряє суперадмін, підтвердження
    // пошти зайве) — тоді signUp узагалі не шле лист і ліміт не чіпається.
    if (error.status === 429 || /rate limit/i.test(error.message)) {
      throw new Error(
        'Забагато спроб реєстрації за короткий час (ліміт Supabase на відправку листів-підтверджень). ' +
          'Почекай кілька хвилин і спробуй ще раз, або вимкни "Confirm email" в Dashboard → Authentication → Providers → Email — тоді ліміт узагалі не чіпатиметься.',
      );
    }
    if (error.status === 400) {
      throw new Error(`Supabase не прийняв цей email (${trimmed}) — перевір, що адреса реальна й без друкарських помилок. Оригінальна помилка: ${error.message}`);
    }
    throw error;
  }

  await addGm(trimmed);
  return { password: alreadyExisted ? null : password, alreadyExisted };
}

export async function setAdminRole(userId: string, role: AdminRole): Promise<void> {
  const { error } = await supabase.rpc('admin_set_role', { target_user_id: userId, new_role: role });
  if (error) throw error;
}

/** Видаляє права адміна — НЕ видаляє сам акаунт і НЕ зачіпає його турніри
 * (created_by лишається, суперадмін і надалі бачить/керує ними). */
export async function removeAdmin(userId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_remove_admin', { target_user_id: userId });
  if (error) throw error;
}
