-- Replace signed-in callable SECURITY DEFINER social RPCs with safer patterns.
--
-- - auto_follow_both / auto_unfollow_both become private implementation details:
--   a trigger keeps mutual follows in sync when friendships are accepted/deleted.
-- - get_friend_suggestions / get_leaderboard become SECURITY INVOKER RPCs, so
--   Postgres RLS policies decide which rows each signed-in user can see.

begin;

create schema if not exists private;

create or replace function private.sync_friendship_follows()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.status = 'accepted'
      and old.status is distinct from new.status
    then
      insert into public.follows (follower_id, following_id)
      values
        (new.requester_id, new.addressee_id),
        (new.addressee_id, new.requester_id)
      on conflict (follower_id, following_id) do nothing;
    elsif old.status = 'accepted'
      and new.status is distinct from 'accepted'
    then
      delete from public.follows
      where (
        follower_id = old.requester_id
        and following_id = old.addressee_id
      ) or (
        follower_id = old.addressee_id
        and following_id = old.requester_id
      );
    end if;

    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status = 'accepted' then
      delete from public.follows
      where (
        follower_id = old.requester_id
        and following_id = old.addressee_id
      ) or (
        follower_id = old.addressee_id
        and following_id = old.requester_id
      );
    end if;

    return old;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function private.sync_friendship_follows() from public, anon, authenticated;

drop trigger if exists sync_friendship_follows on public.friendships;

create trigger sync_friendship_follows
after update of status or delete on public.friendships
for each row
execute function private.sync_friendship_follows();

-- Existing app builds may still contain calls to these RPCs. Revoke direct
-- client access so Security Advisor no longer reports them; the trigger above
-- now performs the same follow synchronization.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as function_identity
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('auto_follow_both', 'auto_unfollow_both')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.function_identity);
  end loop;
end $$;

create or replace function public.get_friend_suggestions(
  p_user_id uuid,
  p_limit integer default 10
)
returns table(
  user_id uuid,
  display_name text,
  avatar_url text,
  mutual_count bigint
)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_user_id is distinct from current_user_id then
    raise exception 'Cannot request friend suggestions for another user' using errcode = '42501';
  end if;

  return query
    with my_friends as (
      select
        case
          when f.requester_id = current_user_id then f.addressee_id
          else f.requester_id
        end as friend_id
      from public.friendships f
      where f.status = 'accepted'
        and (
          f.requester_id = current_user_id
          or f.addressee_id = current_user_id
        )
    ),
    excluded_users as (
      select current_user_id as other_id
      union
      select
        case
          when f.requester_id = current_user_id then f.addressee_id
          else f.requester_id
        end as other_id
      from public.friendships f
      where f.requester_id = current_user_id
        or f.addressee_id = current_user_id
    ),
    friends_of_friends as (
      select
        case
          when f.requester_id = mf.friend_id then f.addressee_id
          else f.requester_id
        end as fof_id,
        mf.friend_id as via_friend
      from public.friendships f
      join my_friends mf
        on f.requester_id = mf.friend_id
        or f.addressee_id = mf.friend_id
      where f.status = 'accepted'
        and (
          case
            when f.requester_id = mf.friend_id then f.addressee_id
            else f.requester_id
          end
        ) <> current_user_id
    ),
    suggestions as (
      select
        fof.fof_id as uid,
        count(distinct fof.via_friend)::bigint as mutual_cnt
      from friends_of_friends fof
      where not exists (
        select 1
        from excluded_users eu
        where eu.other_id = fof.fof_id
      )
      group by fof.fof_id
    ),
    candidate_results as (
      select
        s.uid as user_id,
        p.display_name,
        p.avatar_url,
        s.mutual_cnt as mutual_count,
        0 as source_priority,
        s.mutual_cnt::double precision as sort_score
      from suggestions s
      join public.profiles p on p.id = s.uid
      where coalesce(p.privacy_level, 'friends') <> 'private'

      union all

      select
        p.id as user_id,
        p.display_name,
        p.avatar_url,
        0::bigint as mutual_count,
        1 as source_priority,
        random() as sort_score
      from public.profiles p
      where p.id <> current_user_id
        and not exists (
          select 1
          from excluded_users eu
          where eu.other_id = p.id
        )
        and not exists (
          select 1
          from suggestions s
          where s.uid = p.id
        )
        and coalesce(p.privacy_level, 'friends') <> 'private'
    )
    select
      cr.user_id,
      cr.display_name,
      cr.avatar_url,
      cr.mutual_count
    from candidate_results cr
    order by cr.source_priority asc, cr.sort_score desc
    limit least(greatest(coalesce(p_limit, 10), 1), 50);
end;
$$;

create or replace function public.get_leaderboard(
  p_metric text,
  p_time_start timestamp with time zone,
  p_limit integer default 50
)
returns table(
  user_id uuid,
  display_name text,
  avatar_url text,
  score numeric,
  rank bigint
)
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  bounded_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_metric not in ('form_score', 'weekly_volume', 'streak') then
    return;
  end if;

  if p_metric = 'form_score' then
    return query
      select
        p.id as user_id,
        p.display_name,
        p.avatar_url,
        round(avg(ws.form_score), 1) as score,
        row_number() over (order by avg(ws.form_score) desc) as rank
      from public.profiles p
      join public.workout_sessions ws on ws.user_id = p.id
      where ws.date >= p_time_start
        and coalesce(p.privacy_level, 'friends') <> 'private'
      group by p.id, p.display_name, p.avatar_url
      order by score desc
      limit bounded_limit;
  elsif p_metric = 'weekly_volume' then
    return query
      select
        p.id as user_id,
        p.display_name,
        p.avatar_url,
        sum(ws.total_reps)::numeric as score,
        row_number() over (order by sum(ws.total_reps) desc) as rank
      from public.profiles p
      join public.workout_sessions ws on ws.user_id = p.id
      where ws.date >= p_time_start
        and coalesce(p.privacy_level, 'friends') <> 'private'
      group by p.id, p.display_name, p.avatar_url
      order by score desc
      limit bounded_limit;
  else
    return query
      with user_days as (
        select
          ws.user_id,
          (ws.date at time zone 'UTC')::date as workout_day
        from public.workout_sessions ws
        join public.profiles p on p.id = ws.user_id
        where coalesce(p.privacy_level, 'friends') <> 'private'
        group by ws.user_id, (ws.date at time zone 'UTC')::date
      ),
      with_prev as (
        select
          user_id,
          workout_day,
          workout_day - (
            row_number() over (
              partition by user_id
              order by workout_day
            )
          )::int as grp
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
      best_active as (
        select
          user_id,
          max(streak_len) as best_streak
        from streaks
        where streak_end >= (current_date - 1)
        group by user_id
      )
      select
        p.id as user_id,
        p.display_name,
        p.avatar_url,
        ba.best_streak::numeric as score,
        row_number() over (order by ba.best_streak desc) as rank
      from best_active ba
      join public.profiles p on p.id = ba.user_id
      order by score desc
      limit bounded_limit;
  end if;
end;
$$;

grant execute on function public.get_friend_suggestions(uuid, integer) to authenticated;
grant execute on function public.get_leaderboard(text, timestamp with time zone, integer) to authenticated;

notify pgrst, 'reload schema';

commit;
