# Supabase — налаштування (спільне для pw-events і pw-pvp)

Один Supabase-проєкт обслуговує обидва сайти. Кроки:

1. Зареєструватись на [supabase.com](https://supabase.com) (безкоштовно, картка не потрібна для Free-плану) і створити новий проєкт (наприклад, назва `pw-hub`).
2. У проєкті: **SQL Editor → New query**, вставити вміст `migrations/0001_init.sql` цієї теки, натиснути **Run**.
3. **Project Settings → API** — скопіювати `Project URL` і `anon public` ключ. Вони підуть в `.env` обох сайтів (pw-events і pw-pvp):
   ```
   VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
4. Створити свій адмін-акаунт:
   - **Authentication → Users → Add user** (email + пароль) — найпростіше зробити прямо в дашборді.
   - Потім в SQL Editor виконати (підставивши свій email):
     ```sql
     insert into admins (user_id, email)
     select id, email from auth.users where email = 'you@example.com';
     ```
5. Готово — той самий email/пароль дає доступ до `/admin` і в pw-events, і в pw-pvp (окремі логін-форми, той самий акаунт).

**Важливо:** безкоштовний проєкт автоматично паузиться після ~7 днів без запитів до API. Якщо сайти мають мало трафіку, раз на тиждень заходьте в дашборд і натискайте "Restore project" (або погляньте на сайт — будь-який запит рахується як активність, і при живому трафіку пауза, ймовірно, не настане).
