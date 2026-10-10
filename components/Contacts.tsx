"use client";

import { useEffect, useState } from "react";
import { contactText, fetchPublicContacts, KIND_ICON, KIND_LABEL, NO_CONTACTS, type TeamContact } from "@/lib/contacts";

export function useTeamContacts() {
  const [list, setList] = useState<TeamContact[] | null>(null);
  useEffect(() => { let on = true; fetchPublicContacts().then((l) => { if (on) setList(l); }); return () => { on = false; }; }, []);
  return list;
}

function ContactLink({ c, withKind = true }: { c: TeamContact; withKind?: boolean }) {
  const text = `${withKind && c.kind !== "other" ? KIND_LABEL[c.kind] + " " : ""}${contactText(c)}`;
  return c.url ? <a className="tc-link" href={c.url} target={c.url.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{text}</a> : <span className="tc-link">{text}</span>;
}

/** Inline: «Telegram @x (по выплатам), WhatsApp +971…» or «контакты скоро появятся». */
export function ContactsInline({ max = 3 }: { max?: number }) {
  const list = useTeamContacts();
  if (list === null) return <span className="tc-dim">…</span>;
  if (!list.length) return <span className="tc-dim">{NO_CONTACTS}</span>;
  const shown = list.slice(0, max);
  return (
    <span className="tc-inline">
      {shown.map((c, i) => (
        <span key={c.id}>{i > 0 && (i === shown.length - 1 ? " или " : ", ")}<ContactLink c={c} />{c.label ? <span className="tc-dim"> ({c.label})</span> : null}</span>
      ))}
    </span>
  );
}

/** Block list for footers / contact cards. */
export function ContactsList({ title = "Связаться с нами" }: { title?: string }) {
  const list = useTeamContacts();
  return (
    <div className="tc-box">
      <div className="tc-title">{title}</div>
      {list === null ? <div className="tc-dim">…</div> : !list.length ? <div className="tc-dim">{NO_CONTACTS[0].toUpperCase() + NO_CONTACTS.slice(1)}</div> : (
        <ul className="tc-list">
          {list.map((c) => (
            <li key={c.id}>{KIND_ICON[c.kind]} {c.label ? <b>{c.label}: </b> : null}<ContactLink c={c} />{c.is_primary && list.length > 1 ? <span className="tc-dim"> · основной</span> : null}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
