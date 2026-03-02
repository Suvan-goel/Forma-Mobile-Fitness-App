-- Redemptions table: tracks which badges a user has redeemed
-- Run this in the Supabase SQL Editor (idempotent)

create table if not exists user_redemptions (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  badge_id    text not null,
  redeemed_at timestamptz default now(),
  unique (user_id, badge_id)
);

alter table user_redemptions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'user_redemptions' and policyname = 'Users can view own redemptions'
  ) then
    create policy "Users can view own redemptions"
      on user_redemptions for select
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'user_redemptions' and policyname = 'Users can insert own redemptions'
  ) then
    create policy "Users can insert own redemptions"
      on user_redemptions for insert
      with check (auth.uid() = user_id);
  end if;
end $$;
