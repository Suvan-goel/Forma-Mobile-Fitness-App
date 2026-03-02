-- ============================================================
-- Forma Mobile — Activity Reactions Migration
-- Run this in the Supabase SQL Editor
--
-- Idempotent: safe to run multiple times.
-- Requires: activity_events table to exist.
-- ============================================================

-- ============================================================
-- 1. CREATE TABLE
-- ============================================================

create table if not exists activity_reactions (
  id          uuid default gen_random_uuid() primary key,
  event_id    uuid not null references activity_events(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('like', 'muscle', 'fire', 'clap')),
  created_at  timestamptz default now(),
  -- One reaction per user per event
  unique (event_id, user_id)
);

-- Index for fast lookups when fetching reactions for a batch of events
create index if not exists idx_activity_reactions_event
  on activity_reactions(event_id);

-- ============================================================
-- 2. ENABLE RLS
-- ============================================================

alter table activity_reactions enable row level security;

-- ============================================================
-- 3. RLS POLICIES
-- ============================================================

-- All authenticated users can read reactions
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'activity_reactions'
      and policyname = 'Authenticated users can view reactions'
  ) then
    create policy "Authenticated users can view reactions"
      on activity_reactions for select
      using (auth.role() = 'authenticated');
  end if;
end $$;

-- Users can insert their own reactions
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'activity_reactions'
      and policyname = 'Users can insert own reactions'
  ) then
    create policy "Users can insert own reactions"
      on activity_reactions for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

-- Users can update their own reactions (for swapping reaction type)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'activity_reactions'
      and policyname = 'Users can update own reactions'
  ) then
    create policy "Users can update own reactions"
      on activity_reactions for update
      using (auth.uid() = user_id);
  end if;
end $$;

-- Users can delete their own reactions
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'activity_reactions'
      and policyname = 'Users can delete own reactions'
  ) then
    create policy "Users can delete own reactions"
      on activity_reactions for delete
      using (auth.uid() = user_id);
  end if;
end $$;
