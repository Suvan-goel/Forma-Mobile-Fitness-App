-- ============================================================
-- Forma Mobile — Seed Data (idempotent)
-- Run this in the Supabase SQL Editor AFTER migration.sql
-- ============================================================

-- ── Muscle Groups ─────────────────────────────────────────────
insert into muscle_groups (id, name, icon) values
  ('all',       'All',       ''),
  ('chest',     'Chest',     ''),
  ('back',      'Back',      ''),
  ('shoulders', 'Shoulders', ''),
  ('biceps',    'Biceps',    ''),
  ('triceps',   'Triceps',   ''),
  ('legs',      'Legs',      ''),
  ('core',      'Core',      '')
on conflict (id) do nothing;

-- ── Exercises ─────────────────────────────────────────────────
insert into exercises (name, muscle_group, category) values
  -- Chest
  ('Barbell Bench Press',                   'chest',     'Weightlifting'),
  ('Incline Dumbbell Press',                'chest',     'Weightlifting'),
  ('Dumbbell Chest Fly (flat or incline)',   'chest',     'Weightlifting'),
  ('Weighted Dips (chest-leaning)',          'chest',     'Weightlifting'),
  ('Cable Fly (mid–low or high–low)',        'chest',     'Weightlifting'),
  ('Push-Up',                               'chest',     'Calisthenics'),
  ('Push-Ups (standard / deficit / weighted)', 'chest',  'Weightlifting'),
  ('Incline Barbell Bench Press',           'chest',     'Weightlifting'),
  -- Back
  ('Deadlift',                              'back',      'Weightlifting'),
  ('Pull-Ups / Weighted Pull-Ups',          'back',      'Weightlifting'),
  ('Barbell Row',                           'back',      'Weightlifting'),
  ('Lat Pulldown',                          'back',      'Weightlifting'),
  ('Seated Cable Row',                      'back',      'Weightlifting'),
  -- Shoulders
  ('Overhead Barbell Press',                'shoulders', 'Weightlifting'),
  ('Dumbbell Shoulder Press',               'shoulders', 'Weightlifting'),
  ('Lateral Raises',                        'shoulders', 'Weightlifting'),
  ('Rear Delt Fly (dumbbell or cable)',      'shoulders', 'Weightlifting'),
  -- Biceps
  ('Barbell Curl',                          'biceps',    'Weightlifting'),
  ('Incline Dumbbell Curl',                 'biceps',    'Weightlifting'),
  ('Hammer Curl',                           'biceps',    'Weightlifting'),
  ('Preacher Curl',                         'biceps',    'Weightlifting'),
  ('Cable Curl',                            'biceps',    'Weightlifting'),
  -- Triceps
  ('Close-Grip Bench Press',                'triceps',   'Weightlifting'),
  ('Skull Crushers (EZ-bar)',               'triceps',   'Weightlifting'),
  ('Cable Pushdowns',                       'triceps',   'Weightlifting'),
  ('Overhead Triceps Extension',            'triceps',   'Weightlifting'),
  ('Weighted Dips',                         'triceps',   'Weightlifting'),
  ('Diamond Push-Ups',                      'triceps',   'Weightlifting'),
  -- Legs
  ('Back Squat',                            'legs',      'Weightlifting'),
  ('Romanian Deadlift',                     'legs',      'Weightlifting'),
  ('Leg Press',                             'legs',      'Weightlifting'),
  ('Walking Lunges',                        'legs',      'Weightlifting'),
  ('Leg Curl (machine)',                    'legs',      'Weightlifting'),
  -- Core
  ('Hanging Leg Raises',                    'core',      'Weightlifting'),
  ('Cable Crunches',                        'core',      'Weightlifting'),
  ('Ab Wheel Rollouts',                     'core',      'Weightlifting'),
  ('Russian Twists (weighted)',             'core',      'Weightlifting'),
  ('Planks (weighted)',                     'core',      'Weightlifting')
on conflict (name) do nothing;

-- ── Rewards ───────────────────────────────────────────────────
insert into rewards (title, description, points_required, icon_name, color, category) values
  ('Free Protein Shake',      'Redeem at any partner gym',         200,  'Pill',        '#20d760', 'Supplements'),
  ('Healthy Meal Voucher',    '$15 off at partner restaurants',    350,  'Utensils',    '#F59E0B', 'Meals'),
  ('Gym Day Pass',            'Free day pass at partner gyms',     500,  'Dumbbell',    '#20d760', 'Gym'),
  ('Resistance Bands Set',    'Premium exercise bands',            750,  'ShoppingBag', '#8B5CF6', 'Accessories'),
  ('Monthly Supplement Box',  'Curated supplements for your goals', 1000, 'Pill',       '#EC4899', 'Supplements'),
  ('Weekly Meal Prep',        '7 healthy meals delivered',         1500, 'Utensils',    '#F59E0B', 'Meals'),
  ('Monthly Gym Membership',  'Full access to partner gyms',       2500, 'Dumbbell',    '#20d760', 'Gym'),
  ('Premium Gym Bag',         'High-quality training bag',         3000, 'ShoppingBag', '#8B5CF6', 'Accessories')
on conflict do nothing;
