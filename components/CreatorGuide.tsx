import fs from "fs";
import Link from "next/link";
import path from "path";
import { inline, parse, renderBlocks, sections } from "@/lib/miniMd";

function load(name: string) {
  return fs.readFileSync(path.join(process.cwd(), "content", "creators", name), "utf8");
}

/** Server component: renders content/creators/INSTRUCTION.md + FAQ.md at build time. */
export function CreatorGuide() {
  const instr = sections(parse(load("INSTRUCTION.md")), "h2");
  const faq = sections(parse(load("FAQ.md")), "h3");
  const introBody = instr.intro.filter((b) => b.t !== "h1" && b.t !== "hr");
  const faqIntro = faq.intro.filter((b) => b.t !== "h1");
  return (
    <div className="an-shell guide creator-guide">
      <header className="topbar an-topbar">
        <div className="logo-dot" aria-hidden />
        <div>
          <h1>Инструкция для креатора</h1>
          <div className="sub">Likky · зарабатывай на коротких роликах</div>
        </div>
        <div className="hdr-links">
          <Link className="hdr-btn accent" href="/partner/">🔑 Кабинет</Link>
          <a className="hdr-btn" href="#steps">📋 Шаги</a>
          <a className="hdr-btn" href="#faq">❓ FAQ</a>
        </div>
      </header>
      <main className="an-main guide-main">
        <section className="an-card cg-hero">
          {renderBlocks(introBody, "intro")}
          <Link className="guide-cta" href="/partner/">🔑 Войти в кабинет партнёра →</Link>
          <p className="dim" style={{ marginTop: 8, fontSize: 12.5 }}>Там твои ссылки, клики, продажи и выплаты. Вход по email, без пароля.</p>
        </section>
        <div id="steps" />
        {instr.sections.map((s, i) => (
          <section className="an-card cg-step" key={i}>
            <h3>{inline(s.title, `t${i}`)}</h3>
            {renderBlocks(s.body, `s${i}`)}
          </section>
        ))}
        <section className="an-card" id="faq">
          <h3>❓ Частые вопросы</h3>
          {renderBlocks(faqIntro, "fi")}
          <div className="cg-faq">
            {faq.sections.map((q, i) => (
              <details key={i}>
                <summary>{inline(q.title, `q${i}`)}</summary>
                <div className="cg-a">{renderBlocks(q.body, `a${i}`)}</div>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="an-footer">Likky · likky.store · Не нашёл ответ — пиши нам, ответим.</footer>
    </div>
  );
}
