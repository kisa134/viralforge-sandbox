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
        <section className="an-card">
          <h3>Что настоящее, а что демо</h3>
          <ul>
            <li><b>Чат</b> (главная страница) — песочница: оффер, клипы, ссылка и баланс там ненастоящие.</li>
            <li><b>Аналитика → «Демо»</b> — сгенерированные цифры для показа логики. Это не продажи Likky.</li>
            <li><b>Аналитика → «Мои CSV»</b> — реальные: креаторы, промокоды, ссылки и заказы, которые вы ввели или загрузили из CSV Shopify. Хранятся <b>только в этом браузере</b>, вход не нужен. Делайте бэкап JSON на вкладке «Импорт».</li>
            <li><b>Аналитика → «База»</b> — живой режим (Supabase): вход по ссылке на email, короткие ссылки считают клики, заказы из Shopify приходят сами по вебхуку. База уже подключена; чтобы видеть данные, добавьте свой email в <code>admins</code> и настройте вебхук — <code>docs/GO_LIVE.md</code>.</li>
          </ul>
        </section>

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
              <h3>2. Креатор и его промокод</h3>
              <ol>
                <li>Вкладка <b>Креаторы</b> → «Добавить креатора»: ник, контакт (Telegram), аккаунты IG / TikTok / YouTube, при желании своё правило выплаты.</li>
                <li>Промокод создаётся автоматически: <code>LIKKY-НИК</code> (например <code>LIKKY-MIRA</code>).</li>
                <li><b>В Shopify создайте такой же код скидки</b>: Admin → Discounts → Create discount → Amount off products/order → Discount code = <code>LIKKY-MIRA</code>. Размер скидки решаете вы (например 10% или бесплатная доставка). Без этого кода в Shopify ссылка откроет магазин, но код не применится и заказ не привяжется к креатору.</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>3. Ссылка на каждый пост</h3>
              <ol>
                <li>Вкладка <b>Ссылки</b>: выберите креатора, товар, платформу → «Сгенерировать ссылку».</li>
                <li>Получится ссылка вида <code>https://likky.store/discount/LIKKY-MIRA?redirect=/products/…&amp;utm_source=instagram&amp;utm_medium=creator&amp;utm_campaign=mira&amp;utm_content=mira-1</code>. Она сразу применяет промокод креатора и ведёт на товар.</li>
                <li>Скопируйте ссылку, кодовое слово и текст для DM и отправьте креатору. Есть QR-код.</li>
                <li>Когда креатор опубликует пост, вставьте ссылку на пост в поле «пост опубликован» — так просмотры свяжутся с продажами.</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>4. Заказы из Shopify → начисления</h3>
              <ol>
                <li>Shopify Admin → <b>Orders → Export</b> → «All orders» или нужный период → <b>CSV for Excel, Numbers…</b> → файл придёт на почту / скачается.</li>
                <li>Аналитика → вкладка <b>Импорт</b> → «Заказы Shopify CSV» → выберите файл. Повторный импорт того же файла не создаёт дублей.</li>
                <li>Заказ привязывается к креатору по колонке <b>Discount Code</b> (= промокод креатора). Если промокода нет — заказ считается органикой.</li>
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
                <li>Коды скидок для каждого креатора (п. 2).</li>
                <li><b>Пиксели Meta и TikTok</b>: на likky.store сейчас не найдено ни одного. Shopify → Apps → «Facebook &amp; Instagram» и «TikTok» → подключить аккаунты рекламы. Нужны для ретаргетинга и сверки.</li>
                <li>Вебхуки Shopify (создание/оплата/изменение/отмена заказа, возврат) на <code>https://wdvwinmsdkortvchkgxe.supabase.co/functions/v1/shopify-orders-webhook</code> + секрет подписи в Supabase — заказы будут приходить в «Базу» сами, без CSV (пошагово в <code>docs/GO_LIVE.md</code>).</li>
              </ul>
            </section>
            <section className="an-card">
              <h3>7. Бэкап</h3>
              <p>Данные «Мои CSV» лежат только в этом браузере (данные «Базы» хранятся в Supabase). Вкладка <b>Импорт → «Скачать бэкап JSON»</b> раз в неделю; на другом компьютере — «Загрузить бэкап».</p>
            </section>
          </>
        ) : (
          <>
            <section className="an-card">
              <h3>Как ты зарабатываешь</h3>
              <p>Ты снимаешь короткие вертикальные ролики про товары Likky и выкладываешь у себя (Reels / TikTok / Shorts). Мы платим <b>за каждую продажу</b> по твоему промокоду или ссылке. За просмотры и лайки не платим — только за продажи, зато без потолка.</p>
            </section>
            <section className="an-card">
              <h3>Шаги</h3>
              <ol className="guide-steps">
                <li><b>Оффер.</b> Получаешь товар (например Dragon Night Lamp) и условия: сколько платим за продажу.</li>
                <li><b>ТЗ.</b> Мы присылаем бриф: хук в первую секунду, что показать, текст на экране, длина 8–15 сек, <b>кодовое слово</b> (например DRAGON) и что нельзя обещать.</li>
                <li><b>Съёмка.</b> Вертикально 9:16, свет включается не с первого кадра: сначала темно → щелчок → тёплое свечение. Без чужих водяных знаков.</li>
                <li><b>Пост.</b> Публикуешь с подписью «Пиши DRAGON в комментах — пришлю ссылку» и пометкой #ad / «реклама».</li>
                <li><b>Ссылка.</b> Тем, кто написал кодовое слово, отправляешь в личку <b>свою</b> ссылку. Она сама применяет твой промокод <code>LIKKY-ТВОЙНИК</code>. Промокод можно писать и в описании.</li>
                <li><b>Ссылку на пост</b> присылаешь нам — так мы видим, какие ролики продают.</li>
                <li><b>Продажи.</b> Каждый заказ с твоим промокодом засчитывается тебе. 14 дней — удержание на случай возврата.</li>
                <li><b>Выплата.</b> Раз в неделю (по пятницам) — сумма за заказы, у которых прошло удержание. Способ (карта / USDT) — как договоримся.</li>
              </ol>
            </section>
            <section className="an-card">
              <h3>Шаблон сообщения в личку</h3>
              <pre className="guide-pre">{`Привет! Держи ссылку на лампу 🐉
<твоя ссылка>
Промокод LIKKY-ТВОЙНИК уже применится сам. #ad`}</pre>
            </section>
            <section className="an-card">
              <h3>Нельзя</h3>
              <ul>
                <li>Покупать по своему же промокоду или просить друзей «для статистики» — такие заказы аннулируются.</li>
                <li>Обещать то, чего нет у товара (огонь из пасти, «лечит сон» и т.п.).</li>
                <li>Спамить кодовым словом под чужими постами.</li>
              </ul>
            </section>
          </>
        )}
      </main>
      <footer className="an-footer">Вопросы — пишите основателю в Telegram. Тех. документация: <code>docs/ANALYTICS_SYSTEM.md</code>, <code>docs/GO_LIVE.md</code>.</footer>
    </div>
  );
}
