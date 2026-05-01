-- Follow-up hardening that targets the live function names regardless of
-- exact argument signature. Run this in the Supabase Dashboard SQL Editor if
-- anonymous probes still show app RPCs or avatar listing as callable.

begin;

create schema if not exists extensions;

alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as function_identity, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'auto_follow_both',
        'auto_unfollow_both',
        'get_friend_suggestions',
        'get_leaderboard',
        'handle_new_user',
        'update_workout_aggregates'
      )
  loop
    execute format('revoke execute on function %s from public', fn.function_identity);
    execute format('revoke execute on function %s from anon', fn.function_identity);

    if fn.proname in (
      'auto_follow_both',
      'auto_unfollow_both',
      'get_friend_suggestions',
      'get_leaderboard'
    ) then
      execute format('grant execute on function %s to authenticated', fn.function_identity);
    else
      execute format('revoke execute on function %s from authenticated', fn.function_identity);
    end if;

    execute format(
      'alter function %s set search_path = public, extensions, pg_temp',
      fn.function_identity
    );
  end loop;
end $$;

-- Drop avatar SELECT policies that mention the avatars bucket, whatever their
-- current policy name is. This avoids depending on "Public avatar read".
do $$
declare
  pol record;
begin
  for pol in
    select policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('SELECT', 'ALL')
      and coalesce(qual, '') ilike '%avatars%'
  loop
    execute format('drop policy if exists %I on storage.objects', pol.policyname);
  end loop;
end $$;

drop policy if exists "Users can upload own avatars" on storage.objects;
drop policy if exists "Users can update own avatars" on storage.objects;
drop policy if exists "Users can read own avatar metadata" on storage.objects;

create policy "Users can upload own avatars"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can update own avatars"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can read own avatar metadata"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

update storage.buckets
set
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
  file_size_limit = 5242880
where id = 'avatars';

do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_trgm'
      and n.nspname = 'public'
  ) then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
