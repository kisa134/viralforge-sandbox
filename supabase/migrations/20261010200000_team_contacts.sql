-- Team contacts shown to partners (cabinet + creator guide). Public read of active rows; admins manage. Starts empty.
create table if not exists public.team_contacts (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('telegram','whatsapp','email','phone','instagram','other')),
  label       text check (label is null or char_length(label) <= 60),
  value       text not null check (char_length(btrim(value)) between 1 and 200),
  url         text check (url is null or char_length(url) <= 300),
  sort        integer not null default 0,
  is_primary  boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists team_contacts_order_idx on public.team_contacts (active, is_primary desc, sort, id);

-- Auto-build url for telegram/whatsapp/email/phone/instagram; keep the single primary.
create or replace function private.team_contacts_bi() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare v text := btrim(new.value);
begin
  new.value := v;
  new.label := nullif(btrim(coalesce(new.label, '')), '');
  new.updated_at := now();
  new.url := case new.kind
    when 'telegram'  then 'https://t.me/' || regexp_replace(regexp_replace(v, '^(https?://)?(t\.me|telegram\.me)/', '', 'i'), '^@', '')
    when 'whatsapp'  then 'https://wa.me/' || regexp_replace(v, '\D', '', 'g')
    when 'email'     then 'mailto:' || v
    when 'phone'     then 'tel:' || regexp_replace(v, '[^\d+]', '', 'g')
    when 'instagram' then 'https://instagram.com/' || regexp_replace(regexp_replace(v, '^(https?://)?(www\.)?instagram\.com/', '', 'i'), '^@', '')
    else case when new.url ~* '^https?://' then new.url when v ~* '^https?://' then v else null end
  end;
  if new.is_primary then
    update public.team_contacts set is_primary = false where is_primary and id is distinct from new.id;
  end if;
  return new;
end $$;
revoke all on function private.team_contacts_bi() from public, anon, authenticated;
drop trigger if exists team_contacts_bi on public.team_contacts;
create trigger team_contacts_bi before insert or update on public.team_contacts
  for each row execute function private.team_contacts_bi();

alter table public.team_contacts enable row level security;
drop policy if exists team_contacts_public_read on public.team_contacts;
drop policy if exists team_contacts_auth_read on public.team_contacts;
drop policy if exists team_contacts_admin_insert on public.team_contacts;
drop policy if exists team_contacts_admin_update on public.team_contacts;
drop policy if exists team_contacts_admin_delete on public.team_contacts;
create policy team_contacts_public_read on public.team_contacts for select to anon using (active);
create policy team_contacts_auth_read on public.team_contacts for select to authenticated using (active or (select private.is_admin()));
create policy team_contacts_admin_insert on public.team_contacts for insert to authenticated with check ((select private.is_admin()));
create policy team_contacts_admin_update on public.team_contacts for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy team_contacts_admin_delete on public.team_contacts for delete to authenticated using ((select private.is_admin()));

revoke all on public.team_contacts from anon, authenticated;
grant select on public.team_contacts to anon;
grant select, insert, update, delete on public.team_contacts to authenticated;
