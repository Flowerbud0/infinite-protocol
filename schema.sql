-- 《无限协议》v0.3 云存档基础表
-- 在 Supabase Dashboard 的 SQL Editor 中完整执行一次。

create table if not exists public.player_saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  save_data jsonb not null default '{}'::jsonb,
  revision bigint not null default 1,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_saves_object check (jsonb_typeof(save_data) = 'object'),
  constraint player_saves_size check (octet_length(save_data::text) <= 500000),
  constraint player_saves_device_size check (device_id is null or length(device_id) <= 100)
);

alter table public.player_saves enable row level security;

revoke all on table public.player_saves from anon;
grant select, insert, update on table public.player_saves to authenticated;

do $$
begin
  create policy "players_read_own_save"
    on public.player_saves for select
    to authenticated
    using ((select auth.uid()) = user_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "players_create_own_save"
    on public.player_saves for insert
    to authenticated
    with check ((select auth.uid()) = user_id);
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "players_update_own_save"
    on public.player_saves for update
    to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);
exception when duplicate_object then null;
end $$;

create or replace function public.advance_player_save_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.user_id := old.user_id;
  new.revision := old.revision + 1;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists player_save_revision on public.player_saves;
create trigger player_save_revision
before update on public.player_saves
for each row execute function public.advance_player_save_revision();

-- 后续挂机系统可调用这个函数取得可信的服务器时间。
create or replace function public.get_server_time()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select now();
$$;

revoke all on function public.get_server_time() from public;
grant execute on function public.get_server_time() to authenticated;
