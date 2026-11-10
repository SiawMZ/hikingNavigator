-- Run once in the Supabase SQL editor to count pilot events.
-- The website may only ADD rows; it cannot read them back. You read the
-- numbers yourself in the Supabase dashboard (Table editor, or the query below).

create table if not exists public.events (
  id bigint generated always as identity primary key,
  anon_id uuid not null,
  event text not null check (event in ('open', 'start', 'junction1', 'offroute', 'finish', 'gpx', 'offline')),
  trail_id text check (trail_id ~ '^[a-z0-9-]{1,64}$'),
  src text not null check (char_length(src) <= 16),
  lang text not null check (lang in ('en', 'ms')),
  at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;

create policy "anyone can add events" on public.events
  for insert to anon
  with check (true);

-- Weekly summary for the stop/go numbers: scans, people who started,
-- people who got past the first junction, and people who came back.
-- select
--   count(distinct anon_id) filter (where src = 'qr' and event = 'open') as qr_visitors,
--   count(distinct anon_id) filter (where event = 'start') as started,
--   count(distinct anon_id) filter (where event = 'junction1') as past_first_junction,
--   count(distinct anon_id) filter (where event = 'offroute') as got_alerted
-- from public.events
-- where at > now() - interval '28 days';
