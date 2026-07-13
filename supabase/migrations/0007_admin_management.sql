-- Керування адмінами (ГМ) прямо з адмінки, без SQL Editor щоразу.
--
-- ВАЖЛИВО: сама умова "видалення ГМ-а не видаляє його турніри" вже
-- виконується конструкцією схеми — tournaments.created_by посилається на
-- auth.users(id), а НЕ на admins(user_id). Видалення рядка з admins лише
-- забирає права адміна; сам auth-акаунт і всі турніри з created_by на нього
-- лишаються недоторканими, і суперадмін (is_superadmin() ігнорує created_by)
-- і надалі бачить і керує ними в адмінці.
--
-- Обмеження: новий ГМ повинен спершу мати Supabase Auth-акаунт (Dashboard →
-- Authentication → Users → Add user) — без service-role ключа (який ніколи
-- не можна класти в клієнтський код) створити auth-користувача з клієнта
-- неможливо. Ця функція лише "підвищує" вже існуючий акаунт до ГМ.

create or replace function admin_add_gm(target_email text) returns void
language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  if not is_superadmin() then
    raise exception 'Лише суперадмін може додавати ГМ-ів.';
  end if;
  select id into target_id from auth.users where email = target_email;
  if target_id is null then
    raise exception 'Немає Supabase Auth-акаунта з email %. Створи його спершу: Dashboard -> Authentication -> Users -> Add user.', target_email;
  end if;
  insert into admins (user_id, email, role) values (target_id, target_email, 'gm')
    on conflict (user_id) do update set role = 'gm', email = excluded.email;
end;
$$;

create or replace function admin_set_role(target_user_id uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then
    raise exception 'Лише суперадмін може змінювати ролі.';
  end if;
  if new_role not in ('superadmin', 'gm') then
    raise exception 'Невідома роль: %', new_role;
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Не можна змінити роль власного акаунта звідси.';
  end if;
  update admins set role = new_role where user_id = target_user_id;
end;
$$;

create or replace function admin_remove_admin(target_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_superadmin() then
    raise exception 'Лише суперадмін може видаляти адмінів.';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Не можна видалити власний акаунт звідси.';
  end if;
  delete from admins where user_id = target_user_id;
end;
$$;
