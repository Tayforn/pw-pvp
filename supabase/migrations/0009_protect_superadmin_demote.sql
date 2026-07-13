-- Суперадмін не повинен мати змогу понизити (чи будь-як змінити роль)
-- іншого суперадміна — щоб не можна було обійти захист від видалення
-- (0008) через "спершу пониження до ГМ, потім видалення".

create or replace function admin_set_role(target_user_id uuid, new_role text) returns void
language plpgsql security definer set search_path = public as $$
declare target_role text;
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
  select role into target_role from admins where user_id = target_user_id;
  if target_role = 'superadmin' then
    raise exception 'Не можна змінити роль іншого суперадміна.';
  end if;
  update admins set role = new_role where user_id = target_user_id;
end;
$$;
