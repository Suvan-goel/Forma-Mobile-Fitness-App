# Demo Account Seeding — for Advertising Screenshots

This doc explains how to create a dummy Supabase user populated with realistic
workout data so the **Logbook** and **Analysis** screens look full and polished
in marketing screenshots.

---

## 1. Data flow — what feeds the Logbook + Analysis screens

### Auth → user identity
- `AuthContext` (`src/backend/contexts/AuthContext.tsx`) reads from `supabase.auth`.
  Sign-in is Google/Apple only — there is no email/password flow shipping in the app.
- A Postgres trigger `handle_new_user()` (`scripts/migration.sql:235`) auto-creates
  a row in `profiles` + `user_stats` whenever a row lands in `auth.users`.
  Creating the auth user is enough — the app-side profile appears for free.

### Per-service mock flags (`src/backend/services/api/client.ts`)

| Service     | Real Supabase? | Used by                       |
|-------------|----------------|-------------------------------|
| `workouts`  | ✅ real        | Logbook, recent workouts      |
| `user`      | ✅ real        | Profile header                |
| `analytics` | ✅ real        | Analysis page (charts + summary) |
| `social`    | ✅ real        | Friends feed                  |
| `exercises` / `insights` / `templates` (some) | mock | Library / Insights cards |

For **Logbook + Analytics screenshots**, the data must live in real Supabase
tables — flipping mock flags does not help (the relevant ones are already real).

### Tables the Logbook + Analysis pages actually read
Defined in `scripts/migration.sql`:

- `workout_sessions` — one row per workout (`name`, `date`, `duration_seconds`, `category`, aggregates)
- `workout_exercises` — child of session (`name`, `order_index`)
- `workout_sets` — child of exercise (`set_number`, `reps`, `weight`, `form_score`)

A trigger `update_workout_aggregates` (`scripts/migration.sql:265`) recomputes
`total_sets`, `total_reps`, `form_score` on the parent session **automatically**
when sets are inserted — you do not need to set those on `workout_sessions` yourself.

`analyticsService.getAnalytics()` (`src/backend/services/api/analytics.service.ts`)
reads the same three tables — there is no separate analytics-fact table. So if
the workout data is there, the charts populate themselves.

`user_analytics` exists in the schema but the service does **not** read from
it — ignore it.

---

## 2. Create the dummy account

### Step 1 — Make the auth user

The cleanest path is to use the Supabase Dashboard so the `handle_new_user`
trigger fires:

1. Supabase Dashboard → **Authentication → Users → Add user → Create new user**.
2. Email: `demo@forma.app` (or whatever) — check **"Auto Confirm User"**.
3. (Optional) Edit user metadata to set `full_name` and `avatar_url` so the
   profile picks them up:
   ```json
   { "full_name": "Alex Morgan", "avatar_url": "https://i.pravatar.cc/300?img=12" }
   ```
4. Copy the new user's UUID.

Since the app only ships Google/Apple sign-in, to actually **log in as this
user on the device** you have two options:
- **(Easiest for screenshots)** Supabase Dashboard → **Generate magic link**
  for that user → paste it into the device → Supabase signs you in.
- Add a one-off email/password sign-in in `src/backend/services/supabase/auth.ts`
  gated behind `__DEV__` and remove it before shipping.

After creation, verify the `profiles` row exists:
```sql
select id, email, display_name from profiles where email = 'demo@forma.app';
```

If `display_name` is empty, populate it:
```sql
update profiles
set display_name = 'Alex Morgan',
    first_name   = 'Alex',
    last_name    = 'Morgan',
    avatar_url   = 'https://i.pravatar.cc/300?img=12'
where email = 'demo@forma.app';
```

### Step 2 — Seed workouts (the only data Logbook/Analysis need)

Run this in the Supabase SQL editor. Replace `v_user_id` at the top with the
UUID from step 1. It creates ~30 workouts spread over the last 6 months so
every analytics time range (1w / 4w / 3m / 6m / year) has data, with a current
streak and a clear upward form-score trend.

```sql
do $$
declare
  v_user_id uuid := '<<PASTE-USER-UUID-HERE>>';
  v_session_id uuid;
  v_ex_id uuid;
  i int;
  j int;
  v_date timestamptz;
  v_form numeric(5,2);
  v_dur int;
  v_weight numeric;
  v_reps int;
  -- 30 workouts: i=0 is today, i=29 is ~6 months ago
  workouts text[][] := array[
    array['Push Day',  'Push'],
    array['Pull Day',  'Pull'],
    array['Leg Day',   'Legs'],
    array['Upper Body','Upper'],
    array['Full Body', 'Full Body'],
    array['Chest & Triceps','Push']
  ];
  exercises_for text[][];
begin
  -- Wipe any prior demo data for this user (idempotent re-runs)
  delete from workout_sessions where user_id = v_user_id;

  for i in 0..29 loop
    -- Spread sessions: ~5 per month, slight variation in spacing
    v_date := now() - ((i * 6 + (i % 3)) || ' days')::interval - ((i % 5) || ' hours')::interval;
    -- Form trend: ~78 six months ago → ~96 today (+ small jitter)
    v_form := 78 + ((30 - i) * 0.6) + ((i % 4) - 2);
    v_form := least(98, greatest(72, v_form));
    v_dur := 1800 + (i % 5) * 300;  -- 30–55 min

    insert into workout_sessions (id, user_id, name, date, duration_seconds, category)
    values (
      uuid_generate_v4(),
      v_user_id,
      workouts[(i % 6) + 1][1],
      v_date,
      v_dur,
      workouts[(i % 6) + 1][2]
    )
    returning id into v_session_id;

    -- Pick 3-4 exercises per session based on category
    exercises_for := case (i % 6) + 1
      when 1 then array[array['Barbell Bench Press','60'], array['Overhead Barbell Press','40'], array['Cable Pushdowns','25']]
      when 2 then array[array['Deadlift','100'], array['Barbell Row','60'], array['Barbell Curl','25']]
      when 3 then array[array['Back Squat','80'], array['Romanian Deadlift','70'], array['Walking Lunges','20']]
      when 4 then array[array['Incline Dumbbell Press','22'], array['Pull-Ups / Weighted Pull-Ups','10'], array['Lateral Raises','10']]
      when 5 then array[array['Back Squat','80'], array['Barbell Bench Press','60'], array['Barbell Row','60'], array['Planks (weighted)','10']]
      else        array[array['Barbell Bench Press','62'], array['Dumbbell Chest Fly (flat or incline)','15'], array['Skull Crushers (EZ-bar)','25']]
    end;

    for j in 1..array_length(exercises_for, 1) loop
      insert into workout_exercises (id, session_id, name, order_index)
      values (uuid_generate_v4(), v_session_id, exercises_for[j][1], j - 1)
      returning id into v_ex_id;

      -- Progressive overload: weight grows ~15% over the 6 months
      v_weight := (exercises_for[j][2])::numeric * (0.85 + ((30 - i) * 0.005));
      v_reps   := 8 + (j % 3);

      -- 3 sets per exercise; this triggers update_workout_aggregates
      insert into workout_sets (exercise_id, set_number, reps, weight, form_score) values
        (v_ex_id, 1, v_reps,     round(v_weight, 1),       round(v_form + 1, 2)),
        (v_ex_id, 2, v_reps - 1, round(v_weight * 1.04,1), round(v_form, 2)),
        (v_ex_id, 3, v_reps - 2, round(v_weight * 1.08,1), round(v_form - 2, 2));
    end loop;
  end loop;
end $$;
```

### Step 3 — (Optional) polish for other screens

These do not affect Logbook/Analysis but help if you also screenshot
Profile/Rewards/Friends:

```sql
-- Bump user_stats so the profile header reads nicely
update user_stats
set total_workouts    = 30,
    total_reps        = 2400,
    form_score        = 94.5,
    consistency_score = 88.0
where user_id = '<<UUID>>';

-- Privacy set so the user appears in social/leaderboard
update profiles set privacy_level = 'public' where id = '<<UUID>>';

-- Redeem a couple of rewards (optional, for the Rewards tab)
insert into user_rewards (user_id, reward_id)
select '<<UUID>>', id from rewards order by points_required limit 2
on conflict do nothing;
```

### Verifying it worked

```sql
select count(*) sessions,
       sum(total_sets) sets,
       sum(total_reps) reps,
       round(avg(form_score),1) avg_form
from workout_sessions where user_id = '<<UUID>>';
-- Expect ~30 sessions, ~270 sets, several thousand reps, avg form in mid-80s to low-90s.
```

Then sign in as the demo user on the device — Logbook should list ~30 sessions,
and Analysis should render form trending up, weekly bars, a streak, and a clear
PB list with no extra app changes needed.

---

## 3. Cleanup

To remove the demo data later (keeps the auth user, deletes their workouts):

```sql
delete from workout_sessions where user_id = '<<UUID>>';
```

To fully remove the user, delete them from **Authentication → Users** in the
Supabase Dashboard — the `on delete cascade` chain will clear `profiles`,
`user_stats`, `workout_sessions`, `workout_exercises`, `workout_sets`,
`user_rewards`, and `user_analytics` automatically.
