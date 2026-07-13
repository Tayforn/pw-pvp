-- Суперадмін не повинен мати змогу видалити іншого суперадміна (лише ГМ-ів).
-- Захист на рівні бази — незалежно від того, чи прибрана кнопка в UI.

create or replace function admin_remove_admin(target_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not is_superadmin() then
    raise exception 'Лише суперадмін може видаляти адмінів.';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'Не можна видалити власний акаунт звідси.';
  end if;
  select role into target_role from admins where user_id = target_user_id;
  if target_role = 'superadmin' then
    raise exception 'Суперадмін не може видалити іншого суперадміна.';
  end if;
  delete from admins where user_id = target_user_id;
end;
$$;
