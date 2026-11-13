-- Accounts and sync for Quire. Run once in the Supabase SQL editor, or with
-- `supabase db push`. Every table is protected by row-level security: a
-- signed-in user can read and write only their own rows, and the anon key
-- (which ships in the app) can read nothing.

-- The passcode lock record, wrapped by the passcode, plus a sealed check value
-- that only the account's data key opens. The server never sees either key.
create table if not exists public.sync_keys (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  lock jsonb not null,
  "check" jsonb not null,
  updated_at timestamptz not null default now()
);

create sequence if not exists public.entries_revision_seq;

-- One row per entry. `payload` is the entry sealed on the device (AES-GCM,
-- bound to the entry id). `deleted` rows are tombstones with no payload.
create table if not exists public.entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id text not null,
  client_updated_at text not null,
  deleted boolean not null default false,
  payload jsonb,
  revision bigint not null default nextval('public.entries_revision_seq'),
  primary key (user_id, entry_id)
);

create index if not exists entries_user_revision_idx on public.entries (user_id, revision);

alter table public.sync_keys enable row level security;
alter table public.entries enable row level security;

create policy "sync keys: read own" on public.sync_keys for select to authenticated using (auth.uid() = user_id);
create policy "sync keys: insert own" on public.sync_keys for insert to authenticated with check (auth.uid() = user_id);
create policy "sync keys: update own" on public.sync_keys for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "entries: read own" on public.entries for select to authenticated using (auth.uid() = user_id);
create policy "entries: insert own" on public.entries for insert to authenticated with check (auth.uid() = user_id);
create policy "entries: update own" on public.entries for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The anon role gets nothing, even though PostgREST exposes the public schema.
revoke all on public.sync_keys from anon;
revoke all on public.entries from anon;
grant select, insert, update on public.sync_keys to authenticated;
grant select, insert, update on public.entries to authenticated;
grant usage on sequence public.entries_revision_seq to authenticated;

-- Last-writer-wins upsert. A row is written only when its client_updated_at is
-- at least as new as the stored one, so an older device cannot overwrite a
-- newer edit. Returns the rows it accepted; the client treats any row it sent
-- and did not get back as refused. Runs as the caller (security invoker), so
-- RLS still applies.
create or replace function public.push_entries(rows jsonb)
returns table (entry_id text, revision bigint, client_updated_at text, deleted boolean)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  insert into public.entries as e (user_id, entry_id, client_updated_at, deleted, payload, revision)
  select auth.uid(), r->>'entry_id', r->>'client_updated_at', coalesce((r->>'deleted')::boolean, false), r->'payload',
         nextval('public.entries_revision_seq')
  from jsonb_array_elements(rows) as r
  on conflict (user_id, entry_id) do update
    set client_updated_at = excluded.client_updated_at,
        deleted = excluded.deleted,
        payload = excluded.payload,
        revision = excluded.revision
    where e.client_updated_at <= excluded.client_updated_at
  returning e.entry_id, e.revision, e.client_updated_at, e.deleted;
end;
$$;

revoke all on function public.push_entries(jsonb) from anon;
grant execute on function public.push_entries(jsonb) to authenticated;
