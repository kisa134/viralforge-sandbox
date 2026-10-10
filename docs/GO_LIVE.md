# Запуск живой аналитики Likky × ViralForge (GO LIVE)

Обновлено: 08.10.2026 (атрибуция только по ссылкам — коды скидок Shopify не используются). Кабинет: https://kisa134.github.io/viralforge-sandbox/analytics/ · Инструкция: https://kisa134.github.io/viralforge-sandbox/guide/

## Что уже работает (сделано за вас)

| Что | Статус |
|---|---|
| База Supabase `viralforge-analytics` (ref `wdvwinmsdkortvchkgxe`, us-east-1) | ✅ создана, схема и миграции применены (`supabase/migrations/`) |
| Защита данных (RLS) | ✅ все таблицы закрыты: публичный ключ **ничего не читает и не пишет**. Доступ только у вошедших пользователей, чей email есть в таблице `admins`. Security Advisor: 0 замечаний |
| Каталог | ✅ бренд Likky (Shopify) + 5 товаров с ценами + по офферу на товар. **COGS пустые** — заполните в «Настройках» |
| Функция `r` (короткие ссылки, считает клики) | ✅ работает: `https://wdvwinmsdkortvchkgxe.supabase.co/functions/v1/r?s=<код>` → пишет клик → 302 прямо на страницу товара. Публичная короткая форма: `https://go.likky.store/<код>` (репо `kisa134/likky-go`, GitHub Pages, CNAME `go` → `kisa134.github.io` в DNS Shopify) `likky.store/products/<handle>?ref=<код>&utm_…`. Проверено тестовой ссылкой, тестовые строки удалены |
| Функция `shopify-orders-webhook` | ✅ задеплоена, проверяет подпись Shopify (HMAC). Привязка заказа — по `ref` из ссылки креатора. **Пока секрет не задан — отвечает 401 на всё** (так и задумано) |
| Ручная привязка | ✅ заказ без метки можно привязать к креатору в кабинете (функция БД `attribute_order_manual`, только для админов) |
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
**Регистрацию не отключайте** — через неё партнёры сами заводят кабинет на `/partner/`. Посторонний, войдя, увидит только пустой кабинет партнёра (свои ссылки и статистику), а не данные магазина: в `admins` его нет. Бесплатная почта Supabase шлёт лишь несколько писем в час; для команды подключите свой SMTP (Authentication → Emails → SMTP Settings).

### 3. Вебхук заказов Shopify → Supabase (≈ 5 минут)

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
  ✅ 2026-10-10: ключ и соль лежат в **Supabase Vault** (`shopify_webhook_secret`, `hash_salt`); функции читают env, иначе Vault через RPC `get_app_secret` (только service_role). Вебхук Order creation проверен: верная подпись → 200 + заказ/атрибуция/комиссия, неверная → 401.
4. В Shopify у вебхука `Order creation` нажмите **Send test notification** → в Supabase → Edge Functions → `shopify-orders-webhook` → Logs должен быть ответ 200. Тестовый заказ Shopify попадёт в таблицу `order` — удалите его SQL-запросом (см. ниже), если мешает.

> Если вы создаёте вебхук через **приложение** (Settings → Apps → Develop apps), ключ подписи = **API secret key** этого приложения — его и кладите в `SHOPIFY_WEBHOOK_SECRET`.

Что делает функция: сохраняет заказ (сумма в центах, статус, хэш покупателя, `landing_site`, `landing_site_ref`, атрибуты корзины, позиции) и привязывает к креатору **по ссылке**:
1. `ref` (код поста) из `landing_site` (адрес первого захода в магазин), `landing_site_ref`, атрибутов корзины/заказа (`_vf_ref`, `ref`) или `referring_site` → ссылка → креатор;
2. иначе `utm_content` / `utm_campaign` (ник креатора) из тех же мест;
3. иначе кодовое слово или ник креатора в атрибутах заказа (`_vf_keyword`, `creator`);
4. код скидки — только запасной вариант, если в заказе вдруг окажется код вида `LIKKY-НИК` (заводить их не нужно);
5. ничего нет → заказ «без креатора» (событие `order_unattributed`); привяжите вручную: кабинет → «База» → **Заказы / импорт** → выбрать креатора.

Начисление считается по правилу из «Настроек» (фикс $ / % от заказа / % от маржи) со статусом «удержание» на `hold_days` (по умолчанию 14). Возврат/отмена → начисление аннулируется, а если уже выплачено — создаётся отрицательная строка CLAWBACK. Если сумма не задана («задай сумму») или для «% от маржи» нет COGS — заказ привязывается, а начисление ждёт (событие `commission_needs_amount`).

> Ограничение: `landing_site` — это первая страница **того визита, в котором оформлен заказ**. Если покупатель пришёл по ссылке, ушёл и вернулся через день напрямую, метки в заказе не будет. Это закрывает сниппет из п. 6 (метка сохраняется в браузере на 7 дней и кладётся в атрибуты корзины).

### 4. Задать деньги (в кабинете, 2 минуты)

Кабинет → **База** → войти → **Настройки**: правило выплаты и сумму (поле «задай сумму»), удержание (14 дн), окно атрибуции (7 дн), COGS по каждому товару. Это записывается в `app_settings` / `product` и сразу используется вебхуком.

### 5. Пиксели (рекомендуется, 10 минут)

- **Meta (Instagram):** Shopify Admin → Sales channels → **Facebook & Instagram** → Data sharing → Maximum (Pixel + Conversions API).
- **TikTok:** установить приложение **TikTok** в Shopify → Data sharing → Maximum.
- Это не нужно для начислений креаторам (они идут по ссылке), но нужно для рекламы и для сверки воронки.

### 6. Сохранять `ref` в корзину (рекомендуется; нужен доступ к теме Shopify)

Мы не можем править тему без админ-доступа, поэтому это — готовый сниппет для вас или разработчика. Он запоминает метку из ссылки креатора на 7 дней (окно атрибуции) и записывает её в **атрибуты корзины** — Shopify переносит их в заказ (`note_attributes`), и вебхук привяжет заказ, даже если покупатель вернулся позже напрямую. Атрибуты с `_` в начале покупателю на чекауте не показываются.

Shopify Admin → **Online Store → Themes → … → Edit code → `layout/theme.liquid`** → вставить перед `</body>`:

```html
<script>
(function () {
  var KEY = 'vf_ref', DAYS = 7, p = new URLSearchParams(location.search), ref = p.get('ref');
  if (ref && /^[A-Za-z0-9_-]{1,64}$/.test(ref)) {
    localStorage.setItem(KEY, JSON.stringify({ ref: ref, c: p.get('utm_campaign') || '', u: p.get('utm_content') || '', t: Date.now() }));
  }
  var s; try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
  if (!s || Date.now() - s.t > DAYS * 864e5 || sessionStorage.getItem('vf_ref_sent') === s.ref) return;
  fetch('/cart/update.js', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { _vf_ref: s.ref, _vf_utm_campaign: s.c, _vf_utm_content: s.u } })
  }).then(function () { sessionStorage.setItem('vf_ref_sent', s.ref); });
})();
</script>
```

Проверка: откройте `https://likky.store/products/<handle>?ref=test-1`, затем `https://likky.store/cart.js` — в `attributes` должно быть `"_vf_ref": "test-1"`. Последний клик побеждает (новая ссылка перезаписывает метку).

### 7. Ежедневное подтверждение удержаний (по желанию)

Кабинет сам показывает начисления с прошедшим удержанием как «к выплате». Чтобы статус менялся и в базе, включите расписание: Supabase → Database → Extensions → `pg_cron` → SQL Editor:

```sql
select cron.schedule('approve-matured', '0 5 * * *', $$select public.approve_matured_commissions()$$);
```

## Кабинет партнёра `/partner/` и админка `/admin/`

**Почта и SMTP для партнёров больше не нужны.** Партнёр регистрируется на **https://kisa134.github.io/viralforge-sandbox/partner/** → «Регистрация»: логин (3–24, латиница/цифры/_; он же ник в ссылках), пароль (8+), Telegram, аккаунты соцсетей по желанию. Аккаунт создаёт функция `partner-signup` (внутренний адрес `<логин>@partners.likky.invalid`, письма никогда не отправляются; защита: скрытое поле-ловушка, не больше 5 регистраций и 20 попыток в час с одного IP и 10/40 — с одной подсети).

**Одобрение.** Новый партнёр получает статус «заявка»: войти может, но видит только «Заявка на рассмотрении» — товаров нет, ссылки создать нельзя (проверяется в базе), а короткие ссылки неодобренных/заблокированных партнёров ведут на товар **без** метки (продажи им не засчитываются).

**Админка: https://kisa134.github.io/viralforge-sandbox/admin/** (логин + пароль, только для `admins`):
- «Заявки» — логин, Telegram, соцсети, дата → «Одобрить» / «Отклонить»;
- «Партнёры» — блок/разблок, личная ставка ($ за продажу или % от суммы), «Новый пароль» (генерирует и показывает один раз — отправьте партнёру в Telegram), сводка: ссылки, клики, продажи, сумма, начислено, выплачено;
- «Админы» — добавить админа по логину (человек сначала регистрируется на `/partner/`), убрать.

Аккаунт основателя уже создан: логин **`admin`**, пароль задал сам основатель (нигде не хранится; сменить — через Supabase → Authentication → Users). Этим же логином можно войти в `/analytics` → «База» → «Логин и пароль».

Сделать админом существующий логин одной строкой (Supabase → SQL Editor):
```sql
insert into public.admins (login) values ('логин');
```
(Админ по email, как раньше: `insert into public.admins (email) values (lower('you@example.com'));`)

Что ещё по желанию:
1. **Наши контакты.** `/admin/` → «☎️ Контакты»: добавьте Telegram / WhatsApp / почту и т.д. (подпись, порядок, «основной»). Они сразу появляются в кабинете партнёра (заявка, блокировка, «забыл пароль», подвал) и в `/guide/creator`. Пока список пуст — везде написано «контакты скоро появятся».
2. **Отключить email-регистрацию** (чтобы никто не заводил аккаунты в обход формы): Authentication → Sign In / Providers → **Allow new users to sign up = off**. Регистрация партнёров продолжит работать (она идёт через админ-функцию). Даже без этого «обходной» аккаунт попадает в заявки и ничего не видит.
3. **Ставка за продажу** — по умолчанию **15% от маржи**: (сумма товаров после скидок, без доставки и налога − себестоимость CJ с доставкой × кол-во) × 15%, не меньше 0. Сейчас за 1 шт.: Dragon $5.31, Bat $5.12, Cauldron $4.87, Fire Dragon $5.99, Baby costume $4.45. Если у товара нет себестоимости — начисление создаётся со статусом «на проверке» (NEEDS_REVIEW, $0): впишите себестоимость в `/admin/` → «📈 Бизнес» и пересчитайте заказ ручной привязкой. Ставка меняется в `/admin/` → «Партнёры» → «Ставка по умолчанию» (% от маржи / % от заказа / $ фикс) (или «Аналитика → Настройки»), для товара: `update public.offer set payout_rule='CPA_FIXED', payout_value=5 where product_id=(select id from public.product where title='Dragon Night Lamp');`, для партнёра — в `/admin/`. Порядок: партнёр → товар → общая. Партнёр видит «Твоя ставка: 15% от маржи с каждой продажи» и сумму в $ по каждому товару (себестоимость партнёрам не показывается).
4. **Вебхук Shopify** (шаг 3) — без него партнёры видят клики, но не продажи.
5. SMTP / Site URL нужны только если хотите вход по email-ссылке для себя.

## Как пользоваться каждый день

1. **Креаторы** → «Добавить» → ник, контакт, соцсети. В Shopify ничего заводить не нужно.
2. **Ссылки** → креатор + товар + платформа → «Сгенерировать» → ссылка прямо на товар `likky.store/products/<handle>?ref=<ник-N>&utm_…`; в режиме «База» ещё короткая `https://go.likky.store/<ник-N>` (считает клики), QR и текст для DM. Каждому посту — своя ссылка.
3. Заказы приходят сами (вебхук) и привязываются по `ref`. Заказы «без креатора» — вкладка **Заказы / импорт** → выбрать креатора вручную.
4. Пятница: **Выплаты** → «К выплате» → перевели деньги → «Отметить выплачено».

## Режимы данных

| Режим | Где данные | Вход | Для чего |
|---|---|---|---|
| **Демо** | генерируются в браузере | нет | посмотреть, как всё устроено. Цифры выдуманы |
| **Мои CSV** | localStorage этого браузера | нет | работать без базы: креаторы, ссылки, загрузка CSV заказов Shopify (Orders → Export). В экспорте Shopify нет источника заказа → привязка по колонке `creator`/`ref` (если дописали) или вручную в таблице. Выплаты, бэкап JSON |
| **База** | Supabase | ссылка на email + email в `admins` | живой режим: клики через `r`, заказы через вебхук, общие данные для всех админов |

Данные «Мои CSV» и «База» не смешиваются. Перенос из CSV в базу пока вручную (создать тех же креаторов в режиме «База»).

## Полезные SQL (Supabase → SQL Editor)

```sql
-- последние клики
select clicked_at at time zone 'Asia/Dubai' as dubai, token, is_bot, referer from click order by clicked_at desc limit 50;
-- заказы и кому привязаны
select o.name, o.ordered_at at time zone 'Asia/Dubai' as dubai, o.total_cents/100.0 as total, o.ref, o.landing_site, cv.method, c.display_name
from "order" o left join conversion cv on cv.order_id = o.id left join creator c on c.id = cv.creator_id order by o.ordered_at desc limit 50;
-- события вебхука (order_unattributed = заказ без метки, commission_needs_amount = «задай сумму»)
select occurred_at, name, props from events where source = 'shopify:webhook' order by occurred_at desc limit 50;
-- удалить тестовый заказ Shopify (подставьте external_id)
-- delete from commission where idempotency_key = 'cpa:EXTERNAL_ID';
-- delete from conversion where order_id = (select id from "order" where external_id = 'EXTERNAL_ID');
-- delete from attribution_touch where order_id = (select id from "order" where external_id = 'EXTERNAL_ID');
-- delete from "order" where external_id = 'EXTERNAL_ID';
```

## Техническое

- Миграции: `supabase/migrations/20261008090000_analytics_schema.sql` (таблицы/вьюхи), `…090100_rls_auth.sql` (admins, `private.is_admin()`, RLS «admin_all» на всех таблицах, `security_invoker` на вьюхах, отзыв прав у `anon`), `…090200_seed_likky.sql` (бренд/товары/офферы), `…100000_link_only_attribution.sql` (`order.landing_site_ref`, `order.ref`, функция `attribute_order_manual(order, creator)` — ручная привязка/отвязка, только админ). Таблица `promo_code` осталась как внутренний ID креатора `LIKKY-НИК` — в Shopify её коды заводить не нужно.
- Функции: `supabase/functions/r`, `supabase/functions/shopify-orders-webhook` (обе `verify_jwt = false`: `r` публичная, вебхук защищён HMAC). Деплой из репо: `supabase functions deploy r --no-verify-jwt` и `supabase functions deploy shopify-orders-webhook --no-verify-jwt`.
- Сайт: GitHub Pages собирается с секретами репо `NEXT_PUBLIC_SUPABASE_URL` и `NEXT_PUBLIC_SUPABASE_ANON_KEY` (публичный publishable-ключ — его видно в браузере, это нормально: без строки в `admins` он ничего не даёт).
- Клики ботов/превью (Telegram, WhatsApp, curl и т.п.) пишутся с `is_bot = true` и не считаются в воронке.
