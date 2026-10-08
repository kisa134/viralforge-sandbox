# Запуск живой аналитики Likky × ViralForge (GO LIVE)

Обновлено: 08.10.2026. Кабинет: https://kisa134.github.io/viralforge-sandbox/analytics/ · Инструкция: https://kisa134.github.io/viralforge-sandbox/guide/

## Что уже работает (сделано за вас)

| Что | Статус |
|---|---|
| База Supabase `viralforge-analytics` (ref `wdvwinmsdkortvchkgxe`, us-east-1) | ✅ создана, схема и миграции применены (`supabase/migrations/`) |
| Защита данных (RLS) | ✅ все таблицы закрыты: публичный ключ **ничего не читает и не пишет**. Доступ только у вошедших пользователей, чей email есть в таблице `admins`. Security Advisor: 0 замечаний |
| Каталог | ✅ бренд Likky (Shopify) + 5 товаров с ценами + по офферу на товар. **COGS пустые** — заполните в «Настройках» |
| Функция `r` (короткие ссылки, считает клики) | ✅ работает: `https://wdvwinmsdkortvchkgxe.supabase.co/functions/v1/r?s=<код>` → пишет клик → 302 на Shopify-ссылку со скидкой (+`ref=<код>`). Проверено тестовой ссылкой, тестовые строки удалены |
| Функция `shopify-orders-webhook` | ✅ задеплоена, проверяет подпись Shopify (HMAC). **Пока секрет не задан — отвечает 401 на всё** (так и задумано) |
| Кабинет: переключатель **Демо / Мои CSV / База** | ✅ «Демо» — пример; «Мои CSV» — ваши данные в браузере без входа; «База» — живой режим, вход по ссылке на email |

## Что нужно сделать вам (≈ 20 минут)

### 1. Дать себе доступ (обязательно, 1 минута)

Supabase → проект **viralforge-analytics** → **SQL Editor** → вставьте и нажмите Run (email — тот, с которого будете входить):

```sql
insert into public.admins (email) values (lower('ВАШ_EMAIL@example.com'));
-- ещё один админ: insert into public.admins (email) values (lower('partner@example.com'));
-- убрать: delete from public.admins where email = lower('…');
```

Без этого вход по ссылке сработает, но кабинет в режиме «База» будет пустым (RLS ничего не покажет).

### 2. Адрес сайта для входа по ссылке (обязательно, 1 минута)

Supabase → **Authentication → URL Configuration**:
- **Site URL:** `https://kisa134.github.io/viralforge-sandbox/`
- **Redirect URLs** → Add: `https://kisa134.github.io/viralforge-sandbox/**`

Без этого ссылка из письма уведёт на `localhost`.
Отключать регистрацию не обязательно: посторонний может получить ссылку для входа, но ничего не увидит (его нет в `admins`). Бесплатная почта Supabase шлёт лишь несколько писем в час; для команды подключите свой SMTP (Authentication → Emails → SMTP Settings).

### 3. Промокоды в Shopify (обязательно для атрибуции)

Для каждого креатора кабинет показывает код вида `LIKKY-НИК`. Тот же код нужно создать в Shopify:
**Shopify Admin → Discounts → Create discount → Amount off products / order → Discount code = `LIKKY-НИК`** (размер скидки для покупателя — на ваше усмотрение: [X]%). Без кода в Shopify ссылка `likky.store/discount/LIKKY-НИК` не применит скидку и заказ не привяжется по промокоду (останется привязка по `ref`/`utm_content`).

### 4. Вебхук заказов Shopify → Supabase (≈ 5 минут)

1. **Shopify Admin → Settings → Notifications → Webhooks** (внизу страницы) → **Create webhook**, создать 5 штук, формат **JSON**, версия API — последняя:
   - `Order creation` → URL: `https://wdvwinmsdkortvchkgxe.supabase.co/functions/v1/shopify-orders-webhook`
   - `Order payment` → тот же URL
   - `Order update` → тот же URL
   - `Order cancellation` → тот же URL
   - `Refund create` → тот же URL
2. Под списком вебхуков Shopify пишет: «Your webhooks will be signed with **<длинный ключ>**». Скопируйте этот ключ.
3. Supabase → **Edge Functions → Secrets** (или Project Settings → Edge Functions) → Add secret:
   - `SHOPIFY_WEBHOOK_SECRET` = ключ из п. 2
   - (рекомендуется) `HASH_SALT` = любая длинная случайная строка — соль для хэшей IP/UA/email
   Через CLI то же самое: `supabase secrets set SHOPIFY_WEBHOOK_SECRET=… HASH_SALT=… --project-ref wdvwinmsdkortvchkgxe`
4. В Shopify у вебхука `Order creation` нажмите **Send test notification** → в Supabase → Edge Functions → `shopify-orders-webhook` → Logs должен быть ответ 200. Тестовый заказ Shopify попадёт в таблицу `order` — удалите его SQL-запросом (см. ниже), если мешает.

> Если вы создаёте вебхук через **приложение** (Settings → Apps → Develop apps), ключ подписи = **API secret key** этого приложения — его и кладите в `SHOPIFY_WEBHOOK_SECRET`.

Что делает функция: сохраняет заказ (сумма в центах, статус, хэш покупателя, landing_site, коды скидок, позиции), привязывает к креатору — сначала по **промокоду** (`LIKKY-НИК`), иначе по `ref`/`utm_content` из ссылки; создаёт начисление по правилу из «Настроек» (фикс $ / % от заказа / % от маржи) со статусом «удержание» на `hold_days` (по умолчанию 14). Возврат/отмена → начисление аннулируется, а если уже выплачено — создаётся отрицательная строка CLAWBACK. Если сумма за продажу не задана («задай сумму») или для «% от маржи» нет COGS — заказ привязывается, а начисление ждёт (событие `commission_needs_amount`).

### 5. Задать деньги (в кабинете, 2 минуты)

Кабинет → **База** → войти → **Настройки**: правило выплаты и сумму (поле «задай сумму»), удержание (14 дн), окно атрибуции (7 дн), COGS по каждому товару. Это записывается в `app_settings` / `product` и сразу используется вебхуком.

### 6. Пиксели (рекомендуется, 10 минут)

- **Meta (Instagram):** Shopify Admin → Sales channels → **Facebook & Instagram** → Data sharing → Maximum (Pixel + Conversions API).
- **TikTok:** установить приложение **TikTok** в Shopify → Data sharing → Maximum.
- Это не нужно для начислений креаторам (они идут по промокоду/ссылке), но нужно для рекламы и для сверки воронки.

### 7. Ежедневное подтверждение удержаний (по желанию)

Кабинет сам показывает начисления с прошедшим удержанием как «к выплате». Чтобы статус менялся и в базе, включите расписание: Supabase → Database → Extensions → `pg_cron` → SQL Editor:

```sql
select cron.schedule('approve-matured', '0 5 * * *', $$select public.approve_matured_commissions()$$);
```

## Как пользоваться каждый день

1. **Креаторы** → «Добавить» → ник, контакт, соцсети → код `LIKKY-НИК` (создайте его в Shopify, п. 3).
2. **Ссылки** → креатор + товар + платформа → «Сгенерировать» → в режиме «База» получаете короткую ссылку `…/functions/v1/r?s=ник-1` (считает клики) + полную Shopify-ссылку, QR и текст для DM.
3. Заказы приходят сами (вебхук). Вкладки **Воронка / Креаторы / Выплаты** обновляются при открытии.
4. Пятница: **Выплаты** → «К выплате» → перевели деньги → «Отметить выплачено».

## Режимы данных

| Режим | Где данные | Вход | Для чего |
|---|---|---|---|
| **Демо** | генерируются в браузере | нет | посмотреть, как всё устроено. Цифры выдуманы |
| **Мои CSV** | localStorage этого браузера | нет | работать без базы: креаторы, ссылки, загрузка CSV заказов Shopify (Orders → Export), выплаты, бэкап JSON |
| **База** | Supabase | ссылка на email + email в `admins` | живой режим: клики через `r`, заказы через вебхук, общие данные для всех админов |

Данные «Мои CSV» и «База» не смешиваются. Перенос из CSV в базу пока вручную (создать тех же креаторов в режиме «База» — промокоды совпадут).

## Полезные SQL (Supabase → SQL Editor)

```sql
-- последние клики
select clicked_at at time zone 'Asia/Dubai' as dubai, token, is_bot, referer from click order by clicked_at desc limit 50;
-- заказы и кому привязаны
select o.name, o.ordered_at at time zone 'Asia/Dubai' as dubai, o.total_cents/100.0 as total, o.discount_codes, cv.method, c.display_name
from "order" o left join conversion cv on cv.order_id = o.id left join creator c on c.id = cv.creator_id order by o.ordered_at desc limit 50;
-- события вебхука (ошибки атрибуции, «задай сумму»)
select occurred_at, name, props from events where source = 'shopify:webhook' order by occurred_at desc limit 50;
-- удалить тестовый заказ Shopify (подставьте external_id)
-- delete from commission where idempotency_key = 'cpa:EXTERNAL_ID';
-- delete from conversion where order_id = (select id from "order" where external_id = 'EXTERNAL_ID');
-- delete from attribution_touch where order_id = (select id from "order" where external_id = 'EXTERNAL_ID');
-- delete from "order" where external_id = 'EXTERNAL_ID';
```

## Техническое

- Миграции: `supabase/migrations/20261008090000_analytics_schema.sql` (таблицы/вьюхи), `…090100_rls_auth.sql` (admins, `private.is_admin()`, RLS «admin_all» на всех таблицах, `security_invoker` на вьюхах, отзыв прав у `anon`), `…090200_seed_likky.sql` (бренд/товары/офферы).
- Функции: `supabase/functions/r`, `supabase/functions/shopify-orders-webhook` (обе `verify_jwt = false`: `r` публичная, вебхук защищён HMAC). Деплой из репо: `supabase functions deploy r --no-verify-jwt` и `supabase functions deploy shopify-orders-webhook --no-verify-jwt`.
- Сайт: GitHub Pages собирается с секретами репо `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY` (публичный publishable-ключ — его видно в браузере, это нормально: без строки в `admins` он ничего не даёт).
- Клики ботов/превью (Telegram, WhatsApp, curl и т.п.) пишутся с `is_bot = true` и не считаются в воронке.
