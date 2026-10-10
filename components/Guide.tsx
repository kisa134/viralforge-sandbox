"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Track = "founder" | "creator";

export function Guide() {
  const [track, setTrack] = useState<Track>("founder");
  useEffect(() => { if (window.location.hash === "#creator") setTrack("creator"); }, []);
  return (
    <div className="an-shell guide">
      <header className="topbar an-topbar">
        <div className="logo-dot" aria-hidden />
        <div>
          <h1>Как это работает</h1>
          <div className="sub">ViralForge × Likky · инструкция</div>
        </div>
        <div className="hdr-links">
          <Link className="hdr-btn" href="/">💬 Чат</Link>
          <Link className="hdr-btn accent" href="/analytics">📊 Аналитика</Link>
        </div>
      </header>
      <nav className="an-tabs">
        <button className={`an-tab ${track === "founder" ? "on" : ""}`} onClick={() => setTrack("founder")}>👑 Для основателя</button>
        <button className={`an-tab ${track === "creator" ? "on" : ""}`} onClick={() => setTrack("creator")}>🎬 Для креатора</button>
      </nav>
      <main className="an-main guide-main">
        {track === "founder" && (
        <section className="an-card">
          <h3>Что настоящее, а что демо</h3>
          <ul>
            <li><b>Чат</b> (главная страница) — песочница: оффер, клипы, ссылка и баланс там ненастоящие.</li>
            <li><b>Аналитика → «Демо»</b> — сгенерированные цифры для показа логики. Это не продажи Likky.</li>
            <li><b>Аналитика → «Мои CSV»</b> — реальные: креаторы, ссылки и заказы, которые вы ввели или загрузили из CSV Shopify. Хранятся <b>только в этом браузере</b>, вход не нужен. Делайте бэкап JSON на вкладке «Заказы / импорт».</li>
            <li><b>Аналитика → «База»</b> — живой режим (Supabase): вход по ссылке на email, короткие ссылки считают клики, заказы из Shopify приходят сами по вебхуку. База уже подключена; чтобы видеть данные, добавьте свой email в <code>admins</code> и настройте вебхук — <code>docs/GO_LIVE.md</code>.</li>
          </ul>
        </section>
        )}

        {track === "founder" ? (
          <>
            <section className="an-card">
              <h3>1. Первый запуск (5 минут)</h3>
              <ol>
                <li>Откройте <Link href="/analytics">Аналитику</Link> → переключатель «Данные» → <b>База</b> (войти по email; email должен быть в <code>admins</code>) или <b>Мои CSV</b> (без входа, всё в браузере).</li>
                <li>Вкладка <b>Настройки</b>: выберите правило выплаты (фикс $ за продажу / % от заказа / % от маржи) и <b>задайте сумму</b>. Пока сумма пустая, начисления показываются как «задай сумму». Удержание по умолчанию 14 дней, окно атрибуции 7 дней.</li>
                <li>Там же впишите <b>себестоимость (COGS)</b> по каждому SKU — без неё не считается маржа.</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>2. Креатор</h3>
              <ol>
                <li>Вкладка <b>Креаторы</b> → «Добавить креатора»: ник, контакт (Telegram), аккаунты IG / TikTok / YouTube, при желании своё правило выплаты.</li>
                <li>Кодов скидок в Shopify <b>не нужно</b>. Креатор узнаётся по метке в его ссылках (<code>ref</code> = код поста, <code>utm_campaign</code> = ник). Внутренний ID вида <code>LIKKY-MIRA</code> создаётся сам — это просто идентификатор.</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>3. Ссылка на каждый пост</h3>
              <ol>
                <li>Вкладка <b>Ссылки</b>: выберите креатора, товар, платформу → «Сгенерировать ссылку».</li>
                <li>Получится ссылка прямо на товар: <code>https://likky.store/products/…?ref=mira-1&amp;utm_source=instagram&amp;utm_medium=creator&amp;utm_campaign=mira&amp;utm_content=mira-1</code>. Shopify запоминает адрес первого захода (<code>landing_site</code>) в заказе — по <code>ref</code> заказ привяжется к креатору.</li>
                <li>В режиме «База» дополнительно есть короткая ссылка <code>…/functions/v1/r?s=mira-1</code>: она считает клики и перекидывает на ту же страницу товара.</li>
                <li>Скопируйте ссылку, кодовое слово и текст для DM и отправьте креатору. Есть QR-код.</li>
                <li>Когда креатор опубликует пост, вставьте ссылку на пост в поле «пост опубликован» — так просмотры свяжутся с продажами.</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>4. Заказы из Shopify → начисления</h3>
              <ol>
                <li><b>Режим «База»</b> (рекомендуется): после настройки вебхука (<code>docs/GO_LIVE.md</code>) заказы приходят сами и привязываются по <code>ref</code> из ссылки. Если метки нет (покупатель пришёл не по ссылке или ушёл и вернулся позже) — заказ без креатора; выберите креатора вручную на вкладке <b>Заказы / импорт</b>.</li>
                <li><b>Режим «Мои CSV»</b>: Shopify Admin → <b>Orders → Export</b> → CSV → вкладка <b>Заказы / импорт</b>. В этом экспорте Shopify <b>нет источника заказа</b>, поэтому привязка: колонка <code>creator</code> (ник) или <code>ref</code> (код поста), если вы её дописали (см. «Шаблон»), иначе — выберите креатора вручную в таблице «Последние заказы». Повторный импорт не создаёт дублей и сохраняет ручную привязку.</li>
                <li>Начисление = ваше правило выплаты. Первые 14 дней оно «на удержании» (на случай возврата), потом становится «к выплате».</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>5. Выплаты по пятницам</h3>
              <ol>
                <li>Вкладка <b>Выплаты</b>: по каждому креатору видно «к выплате», «на удержании» и заказы без суммы.</li>
                <li>Переведите деньги креатору (карта / USDT — как договорились) и нажмите <b>«Отметить выплачено»</b>. Ошиблись — «Отменить» в истории.</li>
                <li>Возврат заказа до выплаты автоматически обнуляет начисление (при следующем импорте CSV).</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>6. Что ещё сделать в Shopify</h3>
              <ul>
                <li><b>Пиксели Meta и TikTok</b>: на likky.store сейчас не найдено ни одного. Shopify → Apps → «Facebook &amp; Instagram» и «TikTok» → подключить аккаунты рекламы. Нужны для ретаргетинга и сверки.</li>
                <li>Вебхуки Shopify (создание/оплата/изменение/отмена заказа, возврат) на <code>https://wdvwinmsdkortvchkgxe.supabase.co/functions/v1/shopify-orders-webhook</code> + секрет подписи в Supabase — заказы будут приходить в «Базу» сами, без CSV (пошагово в <code>docs/GO_LIVE.md</code>).</li>
              </ul>
            </section>
            <section className="an-card">
              <h3>7. Бэкап</h3>
              <p>Данные «Мои CSV» лежат только в этом браузере (данные «Базы» хранятся в Supabase). Вкладка <b>Заказы / импорт → «Скачать бэкап JSON»</b> раз в неделю; на другом компьютере — «Загрузить бэкап».</p>
            </section>
          </>
        ) : (
          <>
            <section className="an-card">
              <h3>Как ты зарабатываешь</h3>
              <p>У тебя свой аккаунт (Reels / TikTok / Shorts — можно новый). Ты выкладываешь 1–2 наших ролика в день. Мы даём фото товаров, готовое ТЗ по трендам и <b>твою личную ссылку</b>. За каждую продажу по ссылке — <b>15% от суммы заказа</b>. За ролики и просмотры не платим, только за продажи.</p>
              <Link className="guide-cta" href="/guide/creator">📋 Открыть инструкцию и FAQ для креатора →</Link>
              <p className="dim" style={{ marginTop: 8, fontSize: 12.5 }}>Эту страницу можно сразу отправлять креаторам: <code>/guide/creator</code>.</p>
            </section>
          </>
        )}
      </main>
      <footer className="an-footer">Вопросы — пишите основателю в Telegram. Тех. документация: <code>docs/ANALYTICS_SYSTEM.md</code>, <code>docs/GO_LIVE.md</code>.</footer>
    </div>
  );
}
