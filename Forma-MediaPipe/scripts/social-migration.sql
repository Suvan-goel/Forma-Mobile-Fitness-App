-- ============================================================
-- Forma Mobile — Social Feature Migration
-- Run this in the Supabase SQL Editor
--
-- Idempotent: safe to run multiple times.
-- Assumes tables (friendships, activity_events, user_badges,
-- user_points_cache) and profiles.privacy_level already exist.
-- ============================================================

-- ============================================================
-- 1. ENABLE RLS ON SOCIAL TABLES (idempotent)
-- ============================================================

alter table friendships      enable row level security;
alter table activity_events  enable row level security;
alter table user_badges      enable row level security;
alter table user_points_cache enable row level security;

-- ============================================================
-- 2. RLS POLICIES
-- ============================================================

-- ── profiles ────────────────────────────────────────────────
-- All authenticated users can read profiles (needed for search,
-- friend names in activity feed, avatars, etc.)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'profiles'
      and policyname = 'Authenticated users can view profiles'
  ) then
    create policy "Authenticated users can view profiles"
      on profiles for select
      using (auth.role() = 'authenticated');
  end if;
end $$;

-- ── workout_sessions ────────────────────────────────────────
-- Friends can view each other's sessions (needed for friend
-- profile and comparison features)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'workout_sessions'
      and policyname = 'Friends can view friend sessions'
  ) then
    create policy "Friends can view friend sessions"
      on workout_sessions for select
      using (
        exists (
          select 1 from friendships f
          where f.status = 'accepted'
            and (
              (f.requester_id = auth.uid() and f.addressee_id = workout_sessions.user_id)
              or (f.addressee_id = auth.uid() and f.requester_id = workout_sessions.user_id)
            )
        )
      );
  end if;
end $$;

-- ── friendships ─────────────────────────────────────────────
-- Users can view friendships where they are a party
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'friendships'
      and policyname = 'Users can view own friendships'
  ) then
    create policy "Users can view own friendships"
      on friendships for select
      using (auth.uid() = requester_id or auth.uid() = addressee_id);
  end if;
end $$;

-- Users can send friend requests (insert as requester)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'friendships'
      and policyname = 'Users can send friend requests'
  ) then
    create policy "Users can send friend requests"
      on friendships for insert
      with check (auth.uid() = requester_id);
  end if;
end $$;

-- Users can respond to requests addressed to them
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'friendships'
      and policyname = 'Users can respond to friend requests'
  ) then
    create policy "Users can respond to friend requests"
      on friendships for update
      using (auth.uid() = addressee_id or auth.uid() = requester_id);
  end if;
end $$;

-- Users can remove friendships they are part of
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'friendships'
      and policyname = 'Users can remove friendships'
  ) then
    create policy "Users can remove friendships"
      on friendships for delete
      using (auth.uid() = requester_id or auth.uid() = addressee_id);
  end if;
end $$;

-- ── activity_events ─────────────────────────────────────────
-- Users can view own events + events from non-private accepted friends
drop policy if exists "Users can view own and friend activity" on activity_events;
create policy "Users can view own and friend activity"
  on activity_events for select
  using (
    user_id = auth.uid()
    or (
      -- Friend must have accepted friendship AND not be private
      exists (
        select 1 from friendships f
        where f.status = 'accepted'
          and (
            (f.requester_id = auth.uid() and f.addressee_id = activity_events.user_id)
            or (f.addressee_id = auth.uid() and f.requester_id = activity_events.user_id)
          )
      )
      and not exists (
        select 1 from profiles p
        where p.id = activity_events.user_id
          and p.privacy_level = 'private'
      )
    )
  );

-- Users can insert their own activity events
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'activity_events'
      and policyname = 'Users can insert own activity events'
  ) then
    create policy "Users can insert own activity events"
      on activity_events for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ── user_badges ─────────────────────────────────────────────
-- Authenticated users can read all badges (needed for friend profiles)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'user_badges'
      and policyname = 'Authenticated users can view badges'
  ) then
    create policy "Authenticated users can view badges"
      on user_badges for select
      using (auth.role() = 'authenticated');
  end if;
end $$;

-- Users can insert own badges
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'user_badges'
      and policyname = 'Users can insert own badges'
  ) then
    create policy "Users can insert own badges"
      on user_badges for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

-- ── user_points_cache ───────────────────────────────────────
-- Authenticated users can read all (needed for friend comparison)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'user_points_cache'
      and policyname = 'Authenticated users can view points'
  ) then
    create policy "Authenticated users can view points"
      on user_points_cache for select
      using (auth.role() = 'authenticated');
  end if;
end $$;

-- Users can upsert own points cache
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'user_points_cache'
      and policyname = 'Users can upsert own points'
  ) then
    create policy "Users can upsert own points"
      on user_points_cache for insert
      with check (auth.uid() = user_id);
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'user_points_cache'
      and policyname = 'Users can update own points'
  ) then
    create policy "Users can update own points"
      on user_points_cache for update
      using (auth.uid() = user_id);
  end if;
end $$;

-- ============================================================
-- 3. RPC FUNCTIONS
-- ============================================================

-- ── get_leaderboard ─────────────────────────────────────────
-- Ranks users by form_score, weekly_volume (total reps), or streak.
-- Excludes users with privacy_level = 'private'.

create or replace function get_leaderboard(
  p_metric   text,
  p_time_start timestamptz,
  p_limit    integer default 50
)
returns table (
  user_id      uuid,
  display_name text,
  avatar_url   text,
  score        numeric,
  rank         bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_metric = 'form_score' then
    return query
      select
        p.id as user_id,
        p.display_name,
        p.avatar_url,
        round(avg(ws.form_score), 1) as score,
        row_number() over (order by avg(ws.form_score) desc) as rank
      from profiles p
      join workout_sessions ws on ws.user_id = p.id
      where ws.date >= p_time_start
        and coalesce(p.privacy_level, 'friends') != 'private'
      group by p.id, p.display_name, p.avatar_url
      order by score desc
      limit p_limit;

  elsif p_metric = 'weekly_volume' then
    return query
      select
        p.id as user_id,
        p.display_name,
        p.avatar_url,
        sum(ws.total_reps)::numeric as score,
        row_number() over (order by sum(ws.total_reps) desc) as rank
      from profiles p
      join workout_sessions ws on ws.user_id = p.id
      where ws.date >= p_time_start
        and coalesce(p.privacy_level, 'friends') != 'private'
      group by p.id, p.display_name, p.avatar_url
      order by score desc
      limit p_limit;

  elsif p_metric = 'streak' then
    -- For streak, compute consecutive days ending today/yesterday
    -- per user, then rank them
    return query
      with user_days as (
        select
          ws.user_id,
          (ws.date at time zone 'UTC')::date as workout_day
        from workout_sessions ws
        join profiles p on p.id = ws.user_id
        where coalesce(p.privacy_level, 'friends') != 'private'
        group by ws.user_id, (ws.date at time zone 'UTC')::date
      ),
      with_prev as (
        select
          user_id,
          workout_day,
          workout_day - (row_number() over (
            partition by user_id order by workout_day
          ))::int as grp
        from user_days
      ),
      streaks as (
        select
          user_id,
          max(workout_day) as streak_end,
          count(*) as streak_len
        from with_prev
        group by user_id, grp
      ),
      active_streaks as (
        select
          user_id,
          streak_len
        from streaks
        where streak_end >= (current_date - 1)
      ),
      best_active as (
        select
          user_id,
          max(streak_len) as best_streak
        from active_streaks
        group by user_id
      )
      select
        p.id as user_id,
        p.display_name,
        p.avatar_url,
        ba.best_streak::numeric as score,
        row_number() over (order by ba.best_streak desc) as rank
      from best_active ba
      join profiles p on p.id = ba.user_id
      order by score desc
      limit p_limit;

  else
    -- Unknown metric, return empty
    return;
  end if;
end;
$$;

-- ── get_friend_suggestions ──────────────────────────────────
-- Returns friends-of-friends ranked by mutual friend count.
-- Falls back to random active non-private users if no
-- friends-of-friends are found.

create or replace function get_friend_suggestions(
  p_user_id uuid,
  p_limit   integer default 10
)
returns table (
  user_id      uuid,
  display_name text,
  avatar_url   text,
  mutual_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    with my_friends as (
      select
        case
          when requester_id = p_user_id then addressee_id
          else requester_id
        end as friend_id
      from friendships
      where status = 'accepted'
        and (requester_id = p_user_id or addressee_id = p_user_id)
    ),
    -- All users I have any relationship with (to exclude from suggestions)
    excluded_users as (
      select
        case
          when requester_id = p_user_id then addressee_id
          else requester_id
        end as other_id
      from friendships
      where requester_id = p_user_id or addressee_id = p_user_id
    ),
    friends_of_friends as (
      select
        case
          when f.requester_id = mf.friend_id then f.addressee_id
          else f.requester_id
        end as fof_id,
        mf.friend_id as via_friend
      from friendships f
      join my_friends mf
        on (f.requester_id = mf.friend_id or f.addressee_id = mf.friend_id)
      where f.status = 'accepted'
        and case
              when f.requester_id = mf.friend_id then f.addressee_id
              else f.requester_id
            end != p_user_id
    ),
    suggestions as (
      select
        fof.fof_id as uid,
        count(distinct fof.via_friend) as mutual_cnt
      from friends_of_friends fof
      where fof.fof_id not in (select other_id from excluded_users)
      group by fof.fof_id
    ),
    -- Friends-of-friends suggestions
    fof_results as (
      select
        s.uid as user_id,
        p.display_name,
        p.avatar_url,
        s.mutual_cnt as mutual_count
      from suggestions s
      join profiles p on p.id = s.uid
      where coalesce(p.privacy_level, 'friends') != 'private'
      order by s.mutual_cnt desc
      limit p_limit
    )
    -- Return FoF results if any exist
    select * from fof_results

    union all

    -- Fallback: random active users (only if FoF returned nothing)
    select
      p.id as user_id,
      p.display_name,
      p.avatar_url,
      0::bigint as mutual_count
    from profiles p
    where not exists (select 1 from fof_results)
      and p.id != p_user_id
      and p.id not in (select other_id from excluded_users)
      and coalesce(p.privacy_level, 'friends') != 'private'
    order by random()
    limit p_limit;
end;
$$;
