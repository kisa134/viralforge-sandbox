import type { ReactNode } from "react";

/** Tiny Markdown subset renderer (build-time, server component). Supports:
 *  #/##/### headings, paragraphs, "- " lists, "> " quotes, "---", **bold**, *italic*, `code`,
 *  and highlights [placeholders] so they are easy to spot. */

export function inline(text: string, keyBase = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${keyBase}-${n++}`;
    if (t.startsWith("**")) out.push(<b key={k}>{inline(t.slice(2, -2), k)}</b>);
    else if (t.startsWith("`")) out.push(<code key={k}>{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) out.push(<mark key={k} className="ph">{t}</mark>);
    else out.push(<i key={k}>{inline(t.slice(1, -1), k)}</i>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export type Block =
  | { t: "h1" | "h2" | "h3" | "p"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "quote"; lines: string[] }
  | { t: "hr" };

export function parse(md: string): Block[] {
  const lines = md.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^---+\s*$/.test(l)) { blocks.push({ t: "hr" }); i++; continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { blocks.push({ t: (["h1", "h2", "h3"] as const)[h[1].length - 1], text: h[2] }); i++; continue; }
    if (l.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) { items.push(lines[i].slice(2)); i++; }
      blocks.push({ t: "ul", items });
      continue;
    }
    if (l.startsWith(">")) {
      const q: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) { q.push(lines[i].replace(/^>\s?/, "")); i++; }
      blocks.push({ t: "quote", lines: q.filter((x) => x.trim()) });
      continue;
    }
    const p: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|- |>|---)/.test(lines[i])) { p.push(lines[i]); i++; }
    blocks.push({ t: "p", text: p.join(" ") });
  }
  return blocks;
}

export function renderBlocks(blocks: Block[], keyBase = "b"): ReactNode[] {
  return blocks.map((b, idx) => {
    const k = `${keyBase}-${idx}`;
    switch (b.t) {
      case "h1": return <h2 key={k}>{inline(b.text, k)}</h2>;
      case "h2": return <h3 key={k}>{inline(b.text, k)}</h3>;
      case "h3": return <h4 key={k}>{inline(b.text, k)}</h4>;
      case "p": return <p key={k}>{inline(b.text, k)}</p>;
      case "hr": return <hr key={k} />;
      case "ul": return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}-${j}`)}</li>)}</ul>;
      case "quote": return <blockquote key={k}>{b.lines.map((ln, j) => <p key={j}>{inline(ln, `${k}-${j}`)}</p>)}</blockquote>;
    }
  });
}

/** Split blocks into sections by a heading level (e.g. "h2" → one card per "## ..."). */
export function sections(blocks: Block[], level: "h2" | "h3") {
  const intro: Block[] = [];
  const out: { title: string; body: Block[] }[] = [];
  for (const b of blocks) {
    if (b.t === level) out.push({ title: b.text, body: [] });
    else if (out.length) out[out.length - 1].body.push(b);
    else intro.push(b);
  }
  return { intro, sections: out.map((s) => ({ ...s, body: s.body.filter((x) => x.t !== "hr") })) };
}
