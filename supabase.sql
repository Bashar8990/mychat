-- Run this in Supabase SQL Editor
-- Profiles (extends auth.users or standalone for simple username auth)
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  avatar_url text,
  role text not null default 'member' check (role in ('admin','member')),
  created_at timestamp with time zone default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  is_group boolean not null default false,
  group_name text,
  created_at timestamp with time zone default now()
);

create table if not exists conversation_participants (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade not null,
  sender_id uuid references profiles(id) on delete cascade not null,
  content text not null,
  is_read boolean default false,
  created_at timestamp with time zone default now()
);

-- Enable Realtime and apply the secure RLS migration below.
-- The guarded publication statement appears at the end of this file.
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table conversation_participants enable row level security;

-- Seed: create family group + admin user (password: 123456 hashed with simple crypt, replace in app)
-- For now create admin via app, not SQL

-- ============================================================
-- Secure migration (run after the base schema)
-- The application now uses Supabase Auth. Do not put passwords in profiles.
-- For the existing family accounts, create Auth users first, then link their
-- auth UUIDs to profiles.auth_user_id once.
-- ============================================================

alter table profiles add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'password_hash'
  ) then
    alter table profiles alter column password_hash drop not null;
  end if;
end $$;
create unique index if not exists profiles_auth_user_id_key on profiles(auth_user_id) where auth_user_id is not null;

alter table conversations add column if not exists direct_key text;
create unique index if not exists conversations_direct_key_key on conversations(direct_key) where direct_key is not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (auth_user_id, username, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(coalesce(new.email, new.id::text), '@', 1)),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(coalesce(new.email, new.id::text), '@', 1)),
    'member'
  )
  on conflict (username) do update
    set auth_user_id = excluded.auth_user_id,
        display_name = excluded.display_name;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Passwords are now owned by Supabase Auth and must not remain in profiles.
alter table profiles drop column if exists password_hash;

alter table profiles enable row level security;
alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table messages enable row level security;

drop policy if exists "allow all" on profiles;
drop policy if exists "allow all" on conversations;
drop policy if exists "allow all" on conversation_participants;
drop policy if exists "allow all" on messages;
drop policy if exists "profiles_select_authenticated" on profiles;
drop policy if exists "profiles_update_self" on profiles;
drop policy if exists "conversations_select_member" on conversations;
drop policy if exists "conversations_insert_authenticated" on conversations;
drop policy if exists "participants_select_member" on conversation_participants;
drop policy if exists "participants_insert_member" on conversation_participants;
drop policy if exists "messages_select_member" on messages;
drop policy if exists "messages_insert_member" on messages;

create policy "profiles_select_authenticated" on profiles
  for select to authenticated using (true);
create policy "profiles_update_self" on profiles
  for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create or replace function public.is_profile_owner(target_profile_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from profiles p
    where p.id = target_profile_id and p.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_conversation_member(target_conversation_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from conversation_participants cp
    join profiles p on p.id = cp.user_id
    where cp.conversation_id = target_conversation_id and p.auth_user_id = auth.uid()
  );
$$;

revoke all on function public.is_profile_owner(uuid) from public;
revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_profile_owner(uuid) to authenticated;
grant execute on function public.is_conversation_member(uuid) to authenticated;

create policy "conversations_select_member" on conversations
  for select to authenticated using (public.is_conversation_member(id));
create policy "conversations_insert_authenticated" on conversations
  for insert to authenticated with check (true);

create policy "participants_select_member" on conversation_participants
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "participants_insert_member" on conversation_participants
  for insert to authenticated with check (
    public.is_profile_owner(user_id) or public.is_conversation_member(conversation_id)
  );

create policy "messages_select_member" on messages
  for select to authenticated using (public.is_conversation_member(conversation_id));
create policy "messages_insert_member" on messages
  for insert to authenticated with check (
    public.is_profile_owner(sender_id) and public.is_conversation_member(conversation_id)
  );

do $$
begin
  alter publication supabase_realtime add table messages;
exception when duplicate_object then null;
end $$;
