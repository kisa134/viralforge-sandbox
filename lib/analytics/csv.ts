// In-browser CSV parsing (comma or semicolon, quoted fields). Nothing leaves the browser.
export type Row = Record<string, string>;

export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let q = false;
  const src = text.replace(/^\uFEFF/, "");
  const first = src.split("\n")[0];
  const delim = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { cur.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      cur.push(field); field = "";
      if (cur.some((c) => c.trim() !== "")) rows.push(cur);
      cur = [];
    } else field += ch;
  }
  cur.push(field);
  if (cur.some((c) => c.trim() !== "")) rows.push(cur);
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
}

// Same column names as Shopify Admin → Orders → Export (subset is enough)
export const ORDERS_TEMPLATE =
  // Shopify "Orders → Export" columns + optional `creator` (nick) / `ref` (post code) columns added by the founder.
  "Name,Created at,Financial Status,Subtotal,Discount Amount,Total,Refunded Amount,Lineitem quantity,Lineitem name,Lineitem price,Lineitem sku,creator,ref\n" +
  "#1001,2026-10-08 14:20:00 +0400,paid,49.95,0,49.95,0,1,Dragon Night Lamp By Likky,49.95,,mira,\n" +
  "#1002,2026-10-08 16:05:00 +0400,paid,79.95,0,79.95,0,1,Fire Dragon Halloween Lamp By Likky,79.95,,,mira-1\n" +
  "#1003,2026-10-08 18:40:00 +0400,paid,49.95,0,49.95,0,1,Bat Halloween Lamp By Likky,49.95,,,\n";
export const POSTS_TEMPLATE =
  "post_id,post_url,platform,creator,posted_at,views,likes,comments,shares,saves,keyword_comments,dm_sent,clicks,formula\n" +
  "mira-1,https://www.instagram.com/reel/XXXX,IG,mira,2026-10-07,12000,600,80,40,,25,20,14,Maker don't-scroll\n";
