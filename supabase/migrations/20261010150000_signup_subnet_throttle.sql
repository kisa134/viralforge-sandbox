-- Per-subnet signup throttle (IPv4 /24, IPv6 /48) in addition to per-IP: catches rotating-IP pools.
alter table public.signup_attempt add column if not exists net_hash text;
create index if not exists signup_attempt_net_time on public.signup_attempt (net_hash, created_at desc);
