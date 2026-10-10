-- Edge functions read webhook signing key / hash salt from Supabase Vault (values are inserted out-of-band, never in git).
create or replace function public.get_app_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  where ds.name = p_name
    and p_name in ('shopify_webhook_secret', 'hash_salt')
  limit 1;
$$;
revoke all on function public.get_app_secret(text) from public, anon, authenticated;
grant execute on function public.get_app_secret(text) to service_role;
comment on function public.get_app_secret(text) is 'service_role only: returns whitelisted Vault secrets for edge functions';
