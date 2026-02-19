-- ============================================================
-- Forma Mobile — Database Migration (Phase 1)
-- Run this in the Supabase SQL Editor for your project
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- TABLES
-- ============================================================

-- profiles: extends auth.users with display name + avatar
create table if not exists profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  avatar_url   text,
  provider     text not null default 'google',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- user_stats: rolling aggregate stats per user
create table if not exists user_stats (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null references profiles(id) on delete cascade,
  form_score          numeric(5,2) not null default 0,
  consistency_score   numeric(5,2) not null default 0,
  total_workouts      integer not null default 0,
  total_reps          integer not null default 0,
  updated_at          timestamptz not null default now(),
  unique (user_id)
);

-- muscle_groups: reference table (seeded, not user-specific)
create table if not exists muscle_groups (
  id   text primary key,
  name text not null,
  icon text not null default ''
);

-- exercises: reference table (seeded, not user-specific)
create table if not exists exercises (
  id           uuid primary key default uuid_generate_v4(),
  name         text not null unique,
  muscle_group text not null references muscle_groups(id),
  category     text not null default 'Weightlifting'
);

-- workout_sessions: one row per completed workout
create table if not exists workout_sessions (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references profiles(id) on delete cascade,
  name             text not null,
  date             timestamptz not null default now(),
  duration_seconds integer not null default 0,
  total_sets       integer not null default 0,
  total_reps       integer not null default 0,
  form_score       numeric(5,2) not null default 0,
  category         text,
  created_at       timestamptz not null default now()
);

-- workout_exercises: exercises within a session
create table if not exists workout_exercises (
  id          uuid primary key default uuid_generate_v4(),
  session_id  uuid not null references workout_sessions(id) on delete cascade,
  name        text not null,
  order_index integer not null default 0
);

-- workout_sets: individual sets within an exercise
create table if not exists workout_sets (
  id          uuid primary key default uuid_generate_v4(),
  exercise_id uuid not null references workout_exercises(id) on delete cascade,
  set_number  integer not null,
  reps        integer not null default 0,
  weight      numeric(7,2) not null default 0,
  form_score  numeric(5,2) not null default 0
);

-- user_analytics: time-series data points for charts
create table if not exists user_analytics (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  metric     text not null, -- 'form', 'consistency', 'strength'
  value      numeric(7,2) not null,
  recorded_at timestamptz not null default now()
);

-- rewards: reference table (seeded)
create table if not exists rewards (
  id               uuid primary key default uuid_generate_v4(),
  title            text not null,
  description      text not null default '',
  points_required  integer not null,
  icon_name        text not null default 'Star',
  color            text not null default '#8B5CF6',
  category         text not null default 'General'
);

-- user_rewards: which rewards a user has redeemed
create table if not exists user_rewards (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references profiles(id) on delete cascade,
  reward_id   uuid not null references rewards(id),
  redeemed_at timestamptz not null default now(),
  unique (user_id, reward_id)
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table profiles         enable row level security;
alter table user_stats       enable row level security;
alter table workout_sessions enable row level security;
alter table workout_exercises enable row level security;
alter table workout_sets     enable row level security;
alter table user_analytics   enable row level security;
alter table user_rewards     enable row level security;

-- Reference tables: readable by authenticated users, not writable by clients
alter table muscle_groups enable row level security;
alter table exercises     enable row level security;
alter table rewards       enable row level security;

-- profiles: users can read/update their own row
create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);

-- user_stats: users can read/update their own row
create policy "Users can view own stats"
  on user_stats for select using (auth.uid() = user_id);

create policy "Users can update own stats"
  on user_stats for update using (auth.uid() = user_id);

-- workout_sessions: full CRUD for own rows
create policy "Users can view own sessions"
  on workout_sessions for select using (auth.uid() = user_id);

create policy "Users can insert own sessions"
  on workout_sessions for insert with check (auth.uid() = user_id);

create policy "Users can delete own sessions"
  on workout_sessions for delete using (auth.uid() = user_id);

-- workout_exercises: accessible via parent session ownership
create policy "Users can view own exercises"
  on workout_exercises for select
  using (exists (
    select 1 from workout_sessions s
    where s.id = workout_exercises.session_id and s.user_id = auth.uid()
  ));

create policy "Users can insert own exercises"
  on workout_exercises for insert
  with check (exists (
    select 1 from workout_sessions s
    where s.id = workout_exercises.session_id and s.user_id = auth.uid()
  ));

create policy "Users can delete own exercises"
  on workout_exercises for delete
  using (exists (
    select 1 from workout_sessions s
    where s.id = workout_exercises.session_id and s.user_id = auth.uid()
  ));

-- workout_sets: accessible via parent exercise → session ownership
create policy "Users can view own sets"
  on workout_sets for select
  using (exists (
    select 1 from workout_exercises we
    join workout_sessions s on s.id = we.session_id
    where we.id = workout_sets.exercise_id and s.user_id = auth.uid()
  ));

create policy "Users can insert own sets"
  on workout_sets for insert
  with check (exists (
    select 1 from workout_exercises we
    join workout_sessions s on s.id = we.session_id
    where we.id = workout_sets.exercise_id and s.user_id = auth.uid()
  ));

create policy "Users can delete own sets"
  on workout_sets for delete
  using (exists (
    select 1 from workout_exercises we
    join workout_sessions s on s.id = we.session_id
    where we.id = workout_sets.exercise_id and s.user_id = auth.uid()
  ));

-- user_analytics: own rows only
create policy "Users can view own analytics"
  on user_analytics for select using (auth.uid() = user_id);

create policy "Users can insert own analytics"
  on user_analytics for insert with check (auth.uid() = user_id);

-- user_rewards: own rows only
create policy "Users can view own rewards"
  on user_rewards for select using (auth.uid() = user_id);

create policy "Users can insert own rewards"
  on user_rewards for insert with check (auth.uid() = user_id);

-- Reference tables: authenticated read-only
create policy "Authenticated users can read muscle_groups"
  on muscle_groups for select using (auth.role() = 'authenticated');

create policy "Authenticated users can read exercises"
  on exercises for select using (auth.role() = 'authenticated');

create policy "Authenticated users can read rewards"
  on rewards for select using (auth.role() = 'authenticated');

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create profile + user_stats when a new auth user signs up
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into profiles (id, email, display_name, avatar_url, provider)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    coalesce(new.raw_user_meta_data->>'iss', 'google')
  )
  on conflict (id) do nothing;

  insert into user_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Recompute workout_session aggregates after each set insert
create or replace function update_workout_aggregates()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_session_id uuid;
  v_total_sets  integer;
  v_total_reps  integer;
  v_form_score  numeric(5,2);
begin
  -- Find the parent session
  select we.session_id into v_session_id
  from workout_exercises we
  where we.id = new.exercise_id;

  -- Compute aggregates across all sets in the session
  select
    count(ws.id),
    coalesce(sum(ws.reps), 0),
    coalesce(avg(ws.form_score), 0)
  into v_total_sets, v_total_reps, v_form_score
  from workout_sets ws
  join workout_exercises we on we.id = ws.exercise_id
  where we.session_id = v_session_id;

  update workout_sessions
  set
    total_sets = v_total_sets,
    total_reps = v_total_reps,
    form_score = round(v_form_score, 2)
  where id = v_session_id;

  return new;
end;
$$;

drop trigger if exists on_set_inserted on workout_sets;
create trigger on_set_inserted
  after insert on workout_sets
  for each row execute function update_workout_aggregates();
