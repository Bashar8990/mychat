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

-- Enable Realtime for messages
alter publication supabase_realtime add table messages;

-- RLS (disable for now for family app, enable later if needed)
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;

create policy "allow all" on profiles for all using (true) with check (true);
create policy "allow all" on conversations for all using (true) with check (true);
create policy "allow all" on messages for all using (true) with check (true);
create policy "allow all" on conversation_participants for all using (true) with check (true);
alter table conversation_participants enable row level security;

-- Seed: create family group + admin user (password: 123456 hashed with simple crypt, replace in app)
-- For now create admin via app, not SQL
