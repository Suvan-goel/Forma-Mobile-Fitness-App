# PRD: Supabase Integration for Forma Mobile

**Document Version:** 1.0
**Date:** February 6, 2026
**Author:** Product Management
**Status:** Draft - Pending Approval

---

## 1. Executive Summary

### 1.1 Overview
This PRD defines the plan to integrate Supabase as Forma Mobile's production backend, replacing the existing mock API layer with real database operations, authentication, and file storage. The integration follows an **MVP-first, iterate** approach: Auth + Workouts ship first, remaining services follow incrementally.

### 1.2 Current State
Forma Mobile has a fully functional mock service layer (`src/services/`) with 7 service modules, 7 custom hooks, and typed interfaces that already mirror a backend API shape. The app uses:
- `API_CONFIG.useMock = true` in `client.ts` to route all calls through mock data
- `ApiResponse<T>` wrapper for consistent data shapes
- Simulated network delay (300ms) for realistic UX testing

### 1.3 Target State
- **Supabase Project** provisioned with PostgreSQL database, Auth, and Storage
- **Google + Apple OAuth** for user authentication (no email/password)
- **Feature-flag toggle** to swap mock/real per-service incrementally
- **Row Level Security (RLS)** so each user only accesses their own data
- **Supabase Storage** for exercise demonstration media
- **Seed script** for reference data (exercises, muscle groups, rewards catalog)
- **No offline support** for MVP (requires internet connection)
- **AI Trainer remains mock** (template-based responses, no Supabase integration yet)

### 1.4 Success Criteria

| Criterion | Metric |
|-----------|--------|
| User can sign in with Google or Apple | Auth flow completes, session persists across app restarts |
| Workouts persist across sessions | Saved workout appears in Logbook after app restart |
| All existing screens render correctly | No visual regressions vs. mock data |
| Mock fallback works | Setting `useMock: true` for any service reverts to mock data |
| RLS enforced | User A cannot read/write User B's data |
| Exercise media loads from Storage | Exercise images render from Supabase Storage URLs |
| Seed data populates cleanly | Running seed script creates all reference data without errors |

---

## 2. Scope

### 2.1 In Scope

| Category | Details |
|----------|---------|
| **Supabase setup** | New project creation, environment config, `.env` management |
| **Authentication** | Google OAuth + Apple Sign-In via Supabase Auth |
| **Database schema** | Tables for users, workouts, exercises, analytics, rewards |
| **RLS policies** | Per-user data isolation on all tables |
| **Service migration** | Replace mock implementations in 6 of 7 services (all except Trainer) |
| **Storage** | Supabase Storage bucket for exercise media |
| **Seed script** | SQL/JS script for reference data (exercises, muscle groups, rewards) |
| **Auth UI** | Welcome screen update with Google/Apple sign-in buttons |
| **Session management** | Auth context, protected routes, token refresh |

### 2.2 Out of Scope

| Category | Rationale |
|----------|-----------|
| AI Trainer Supabase integration | Stays as mock template responses for now |
| Offline support / AsyncStorage caching | MVP requires internet; defer to future iteration |
| Real-time subscriptions | Not needed for MVP; workout data writes on save only |
| Push notifications | Separate feature, not part of backend migration |
| Admin panel / dashboard | Out of scope for mobile app PRD |
| Edge Functions | No server-side compute needed for MVP |
| CI/CD pipeline changes | Deployment is manual for now |

---

## 3. Architecture

### 3.1 High-Level Architecture

```
+-------------------+       +--------------------+       +------------------+
|   React Native    |       |   Service Layer    |       |    Supabase      |
|   Screens/Hooks   | ----> |   (feature flag)   | ----> |   (PostgreSQL)   |
|                   |       |                    |       |   (Auth)         |
|                   |       |  useMock? ----+    |       |   (Storage)      |
|                   |       |      |        |    |       |                  |
|                   |       |    false     true   |       |                  |
|                   |       |      |        |    |       |                  |
|                   |       |  supabase   mock   |       |                  |
+-------------------+       +--------------------+       +------------------+
```

### 3.2 Service Layer Changes

The existing `client.ts` will be updated to initialize a Supabase client. Each service file will gain a real implementation branch alongside its existing mock branch:

```
src/services/
├── api/
│   ├── client.ts              # Supabase client init + feature flags
│   ├── types.ts               # Existing types (minor additions)
│   ├── workouts.service.ts    # Add Supabase queries
│   ├── exercises.service.ts   # Add Supabase queries
│   ├── analytics.service.ts   # Add Supabase queries
│   ├── rewards.service.ts     # Add Supabase queries
│   ├── insights.service.ts    # Add Supabase queries
│   ├── user.service.ts        # Add Supabase queries
│   └── trainer.service.ts     # STAYS MOCK (no changes)
├── mock/                      # Unchanged - kept as fallback
│   ├── delay.ts
│   └── data/*.mock.ts
└── supabase/                  # NEW - Supabase-specific code
    ├── client.ts              # createClient(), session management
    ├── auth.ts                # OAuth helpers (Google, Apple)
    └── storage.ts             # Storage bucket helpers
```

### 3.3 New: Auth Context

```
src/contexts/
├── AuthContext.tsx             # NEW - Supabase auth state
├── CurrentWorkoutContext.tsx   # Existing - no changes
└── ScrollContext.tsx           # Existing - no changes
```

### 3.4 Feature Flag Strategy

`client.ts` will support per-service flags to allow incremental migration:

```typescript
export const API_CONFIG = {
  // Global fallback
  useMock: false,

  // Per-service overrides (true = mock, false = supabase)
  services: {
    workouts: false,   // migrated
    exercises: false,   // migrated
    analytics: false,   // migrated
    rewards: false,     // migrated
    insights: false,    // migrated
    user: false,        // migrated
    trainer: true,      // STAYS MOCK
  },

  mockDelayMs: 300,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
} as const;
```

---

## 4. Database Schema

### 4.1 Entity Relationship Diagram

```
users (Supabase Auth)
  |
  ├── profiles (1:1)
  |     └── display_name, avatar_url
  |
  ├── workout_sessions (1:many)
  |     └── workout_exercises (1:many)
  |           └── workout_sets (1:many)
  |
  ├── user_analytics (1:many)
  |     └── metric_type, value, recorded_at
  |
  ├── user_rewards (1:many)
  |     └── reward_id, redeemed_at, points_spent
  |
  └── user_stats (1:1)
        └── form_score, consistency_score, total_points
```

### 4.2 Table Definitions

#### `profiles`
Extends Supabase Auth's `auth.users` with app-specific fields.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, FK → auth.users.id | Matches Supabase Auth user ID |
| `display_name` | `text` | NOT NULL | From OAuth provider or user-set |
| `avatar_url` | `text` | NULLABLE | From OAuth provider |
| `created_at` | `timestamptz` | DEFAULT now() | |
| `updated_at` | `timestamptz` | DEFAULT now() | |

#### `exercises` (reference table - no RLS needed for reads)
Static exercise catalog, populated by seed script.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `name` | `text` | NOT NULL, UNIQUE | e.g. "Barbell Bench Press" |
| `muscle_group` | `text` | NOT NULL | FK to muscle_groups.name |
| `category` | `text` | NOT NULL | e.g. "Chest", "Back" |
| `image_url` | `text` | NULLABLE | Supabase Storage URL |
| `created_at` | `timestamptz` | DEFAULT now() | |

#### `muscle_groups` (reference table)

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `name` | `text` | NOT NULL, UNIQUE | e.g. "Chest" |
| `icon` | `text` | NOT NULL | Emoji or icon identifier |

#### `workout_sessions`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → profiles.id | RLS: own data only |
| `name` | `text` | NOT NULL | e.g. "Push Day - Strength" |
| `date` | `date` | NOT NULL | |
| `duration_seconds` | `integer` | NOT NULL | Stored as seconds for calculations |
| `total_sets` | `integer` | NOT NULL, DEFAULT 0 | Denormalized for list views |
| `total_reps` | `integer` | NOT NULL, DEFAULT 0 | Denormalized for list views |
| `form_score` | `real` | NOT NULL, DEFAULT 0 | Average across all sets |
| `category` | `text` | NULLABLE | e.g. "Strength", "Hypertrophy" |
| `created_at` | `timestamptz` | DEFAULT now() | |

#### `workout_exercises`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `workout_session_id` | `uuid` | NOT NULL, FK → workout_sessions.id, ON DELETE CASCADE | |
| `exercise_name` | `text` | NOT NULL | Denormalized for query simplicity |
| `order_index` | `integer` | NOT NULL, DEFAULT 0 | Preserve exercise ordering |
| `created_at` | `timestamptz` | DEFAULT now() | |

#### `workout_sets`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `workout_exercise_id` | `uuid` | NOT NULL, FK → workout_exercises.id, ON DELETE CASCADE | |
| `set_number` | `integer` | NOT NULL | 1-indexed |
| `reps` | `integer` | NOT NULL | |
| `weight` | `real` | NOT NULL, DEFAULT 0 | In user's preferred unit (lbs/kg) |
| `form_score` | `real` | NOT NULL, DEFAULT 0 | MediaPipe-calculated score (0-100) |
| `created_at` | `timestamptz` | DEFAULT now() | |

#### `user_analytics`
Stores computed metrics over time for trend tracking.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → profiles.id | |
| `metric_type` | `text` | NOT NULL, CHECK IN ('form', 'consistency', 'strength') | |
| `value` | `real` | NOT NULL | Score 0-100 |
| `recorded_at` | `date` | NOT NULL | One entry per metric per day |
| `created_at` | `timestamptz` | DEFAULT now() | |

Unique constraint: `(user_id, metric_type, recorded_at)` - one value per metric per day.

#### `rewards` (reference table)
Static rewards catalog, populated by seed script.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `title` | `text` | NOT NULL | |
| `description` | `text` | NOT NULL | |
| `points_required` | `integer` | NOT NULL | |
| `icon_name` | `text` | NOT NULL | Lucide icon name |
| `color` | `text` | NOT NULL | Hex color string |
| `category` | `text` | NOT NULL | e.g. "supplements", "gym" |

#### `user_rewards`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | `uuid` | PK, DEFAULT gen_random_uuid() | |
| `user_id` | `uuid` | NOT NULL, FK → profiles.id | |
| `reward_id` | `uuid` | NOT NULL, FK → rewards.id | |
| `points_spent` | `integer` | NOT NULL | Points at time of redemption |
| `redeemed_at` | `timestamptz` | DEFAULT now() | |

#### `user_stats`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `user_id` | `uuid` | PK, FK → profiles.id | 1:1 with user |
| `form_score` | `real` | NOT NULL, DEFAULT 0 | Current form score |
| `consistency_score` | `real` | NOT NULL, DEFAULT 0 | Current consistency score |
| `total_points` | `integer` | NOT NULL, DEFAULT 0 | Available reward points |
| `updated_at` | `timestamptz` | DEFAULT now() | |

### 4.3 Row Level Security Policies

All user-owned tables enforce strict per-user isolation:

```sql
-- Pattern applied to: workout_sessions, user_analytics, user_rewards, user_stats
ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only read their own workouts"
  ON workout_sessions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only insert their own workouts"
  ON workout_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can only update their own workouts"
  ON workout_sessions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can only delete their own workouts"
  ON workout_sessions FOR DELETE
  USING (auth.uid() = user_id);
```

For child tables (`workout_exercises`, `workout_sets`), RLS is enforced through the parent:

```sql
-- workout_exercises: access if you own the parent workout_session
CREATE POLICY "Users can access their own workout exercises"
  ON workout_exercises FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM workout_sessions
      WHERE workout_sessions.id = workout_exercises.workout_session_id
      AND workout_sessions.user_id = auth.uid()
    )
  );
```

Reference tables (`exercises`, `muscle_groups`, `rewards`) allow public reads:

```sql
CREATE POLICY "Anyone can read exercises"
  ON exercises FOR SELECT
  USING (true);
```

### 4.4 Database Functions

#### Auto-create profile on signup
```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', 'User'),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  INSERT INTO public.user_stats (user_id)
  VALUES (NEW.id);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

#### Compute workout aggregates on save
```sql
CREATE OR REPLACE FUNCTION public.update_workout_aggregates()
RETURNS trigger AS $$
BEGIN
  UPDATE workout_sessions SET
    total_sets = (
      SELECT COUNT(*) FROM workout_sets ws
      JOIN workout_exercises we ON ws.workout_exercise_id = we.id
      WHERE we.workout_session_id = NEW.workout_session_id
    ),
    total_reps = (
      SELECT COALESCE(SUM(ws.reps), 0) FROM workout_sets ws
      JOIN workout_exercises we ON ws.workout_exercise_id = we.id
      WHERE we.workout_session_id = NEW.workout_session_id
    ),
    form_score = (
      SELECT COALESCE(AVG(ws.form_score), 0) FROM workout_sets ws
      JOIN workout_exercises we ON ws.workout_exercise_id = we.id
      WHERE we.workout_session_id = NEW.workout_session_id
    )
  WHERE id = (
    SELECT workout_session_id FROM workout_exercises
    WHERE id = NEW.workout_exercise_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_set_inserted
  AFTER INSERT ON workout_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_workout_aggregates();
```

---

## 5. Authentication

### 5.1 Flow

```
WelcomeScreen
  ├── [Sign in with Google] → Supabase Auth (Google OAuth)
  └── [Sign in with Apple]  → Supabase Auth (Apple OAuth)
          │
          ▼
    Supabase returns session (access_token + refresh_token)
          │
          ▼
    AuthContext stores session
          │
          ▼
    Trigger: handle_new_user() creates profile + user_stats
          │
          ▼
    Navigate to MainTabs (Logbook)
```

### 5.2 AuthContext Design

```typescript
// src/contexts/AuthContext.tsx
interface AuthContextValue {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
}
```

Key behaviors:
- On app launch, check for existing session via `supabase.auth.getSession()`
- Listen for auth state changes via `supabase.auth.onAuthStateChange()`
- Auto-refresh tokens (handled by supabase-js)
- On sign-out, clear local state and navigate to WelcomeScreen

### 5.3 Protected Routes

The `RootNavigator` will conditionally render:
- **No session**: Show `WelcomeScreen` (with sign-in buttons)
- **Active session**: Show `MainTabs` (existing tab navigation)

No changes to the tab navigation structure itself.

### 5.4 OAuth Provider Setup

#### Google OAuth
1. Create OAuth credentials in Google Cloud Console
2. Configure redirect URL in Supabase Dashboard → Auth → Providers → Google
3. Add `com.forma.app` as authorized origin for Android
4. Add `com.forma.dev.allahham.12345.app` as authorized origin for iOS

#### Apple Sign-In
1. Configure App ID with Sign in with Apple capability in Apple Developer Portal
2. Create a Services ID for Supabase redirect
3. Generate a client secret (key file from Apple)
4. Configure in Supabase Dashboard → Auth → Providers → Apple

### 5.5 Deep Link Configuration

OAuth redirects require deep linking. Expo config:

```json
// app.json
{
  "expo": {
    "scheme": "forma",
    "ios": {
      "associatedDomains": ["applinks:<supabase-project>.supabase.co"]
    },
    "android": {
      "intentFilters": [{
        "action": "VIEW",
        "data": [{ "scheme": "forma" }],
        "category": ["BROWSABLE", "DEFAULT"]
      }]
    }
  }
}
```

---

## 6. Storage

### 6.1 Bucket Configuration

| Bucket | Access | Purpose |
|--------|--------|---------|
| `exercise-media` | Public read | Exercise demonstration images |

### 6.2 Exercise Media

Exercise images will be uploaded via seed script or admin tool (not by end users):

```
exercise-media/
├── chest/
│   ├── barbell-bench-press.jpg
│   ├── incline-dumbbell-press.jpg
│   └── ...
├── back/
│   ├── deadlift.jpg
│   └── ...
└── ...
```

The `exercises.image_url` column stores the public Supabase Storage URL.

### 6.3 Storage RLS

```sql
-- Public read for exercise media (no auth required)
CREATE POLICY "Public read access for exercise media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'exercise-media');
```

---

## 7. Service Migration Plan

### 7.1 Migration Pattern

Each service follows the same pattern. The `if (useMock)` branch stays as-is; a new `else` branch calls Supabase:

```typescript
// Example: workouts.service.ts
async getAll(): Promise<ApiResponse<WorkoutSession[]>> {
  if (API_CONFIG.services.workouts) {
    // Existing mock implementation (unchanged)
    await mockDelay(API_CONFIG.mockDelayMs);
    return { data: mockWorkoutSessions, success: true };
  }

  // NEW: Supabase implementation
  const { data, error } = await supabase
    .from('workout_sessions')
    .select('*')
    .order('date', { ascending: false });

  if (error) throw error;

  return {
    data: mapWorkoutRows(data),
    success: true,
  };
},
```

### 7.2 Service-by-Service Migration

#### `user.service.ts` - MVP Sprint 1
| Method | Mock | Supabase |
|--------|------|----------|
| `getCurrentUser()` | Returns hardcoded user | `supabase.auth.getUser()` + `profiles` table query |
| `updateUser(updates)` | Merges with mock | `supabase.from('profiles').update(updates)` |

**New method needed:**
| Method | Purpose |
|--------|---------|
| `deleteAccount()` | Delete user and all associated data (cascade) |

#### `workouts.service.ts` - MVP Sprint 1
| Method | Mock | Supabase |
|--------|------|----------|
| `getAll()` | Returns mock array | `supabase.from('workout_sessions').select('*')` |
| `getById(id)` | Looks up mock object | `supabase.from('workout_sessions').select('*, workout_exercises(*, workout_sets(*))').eq('id', id)` |
| `getRecent(limit)` | Slices mock array | `.select('*').order('date', { ascending: false }).limit(limit)` |

**New methods needed:**
| Method | Purpose |
|--------|---------|
| `create(workout)` | Insert workout_session + exercises + sets (transaction) |
| `delete(id)` | Delete workout and all child records (cascade) |

The `create()` method will be called from `SaveWorkoutScreen` when the user saves a completed workout. It receives data from `CurrentWorkoutContext`:

```typescript
async create(workout: {
  name: string;
  date: Date;
  durationSeconds: number;
  category?: string;
  exercises: {
    name: string;
    sets: { reps: number; weight: number; formScore: number }[];
  }[];
}): Promise<ApiResponse<WorkoutSession>>
```

#### `exercises.service.ts` - Sprint 2
| Method | Mock | Supabase |
|--------|------|----------|
| `getMuscleGroups()` | Returns mock array | `supabase.from('muscle_groups').select('*')` |
| `getAll()` | Returns mock array | `supabase.from('exercises').select('*')` |
| `getByMuscleGroup(group)` | Filters mock array | `.select('*').eq('muscle_group', group)` |

No new methods needed. Read-only reference data.

#### `analytics.service.ts` - Sprint 2
| Method | Mock | Supabase |
|--------|------|----------|
| `getAnalytics(timeRange)` | Generates from base data | Query `user_analytics` table with date range filter |
| `getMetricByTimeRange(metric, range)` | Generates from base data | `.select('*').eq('metric_type', metric).gte('recorded_at', startDate)` |
| `getWeeklyBarData()` | Returns mock array | Aggregate `workout_sessions` by day of week |

**New method needed:**
| Method | Purpose |
|--------|---------|
| `recordMetric(type, value)` | Insert daily analytics snapshot (called after workout save) |

#### `rewards.service.ts` - Sprint 3
| Method | Mock | Supabase |
|--------|------|----------|
| `getRewards()` | Returns mock array | `supabase.from('rewards').select('*')` |
| `getUserStats()` | Returns mock stats | `supabase.from('user_stats').select('*').single()` |
| `redeemReward(id)` | Mock success | Insert into `user_rewards`, deduct from `user_stats.total_points` |

#### `insights.service.ts` - Sprint 3
| Method | Mock | Supabase |
|--------|------|----------|
| `getInsights(metric)` | Returns mock strings | Compute from `user_analytics` data (could be DB function or client-side) |
| `getAllInsights()` | Returns mock object | Aggregate all metrics |

Insights are **derived data** - they can be computed client-side from analytics data or via a Supabase database function. For MVP, compute client-side.

#### `trainer.service.ts` - NO CHANGES
Stays entirely mock. No Supabase integration. The existing template-based AI responses continue to work as-is.

---

## 8. New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@supabase/supabase-js` | ^2.x | Supabase client SDK |
| `@react-native-async-storage/async-storage` | ^2.x | Required by supabase-js for session persistence |
| `react-native-url-polyfill` | ^2.x | URL polyfill for React Native (required by supabase-js) |
| `expo-auth-session` | ~6.x | OAuth session handling for Google/Apple |
| `expo-web-browser` | ~14.x | In-app browser for OAuth redirect flow |
| `expo-crypto` | ~14.x | Crypto utilities for PKCE flow |

Install via:
```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill expo-auth-session expo-web-browser expo-crypto
```

---

## 9. Environment Configuration

### 9.1 Environment Variables

Create `.env` (gitignored) and `.env.example` (committed):

```env
# .env.example
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

The `EXPO_PUBLIC_` prefix makes these available in the Expo runtime via `process.env`.

### 9.2 Supabase Client Initialization

```typescript
// src/services/supabase/client.ts
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

---

## 10. Type Changes

### 10.1 Additions to `types.ts`

```typescript
// Auth-related types
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  provider: 'google' | 'apple';
}

// Extend WorkoutSession with user ownership
export interface WorkoutSession {
  // ... existing fields ...
  userId: string;  // NEW
}

// New type for workout creation
export interface CreateWorkoutPayload {
  name: string;
  date: Date;
  durationSeconds: number;
  category?: string;
  exercises: {
    name: string;
    orderIndex: number;
    sets: {
      setNumber: number;
      reps: number;
      weight: number;
      formScore: number;
    }[];
  }[];
}
```

### 10.2 Row Mapping

Database rows use `snake_case`; TypeScript uses `camelCase`. Each service will have a mapper function:

```typescript
function mapWorkoutRow(row: any): WorkoutSession {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    date: formatDate(row.date),
    fullDate: new Date(row.date),
    duration: formatDuration(row.duration_seconds),
    totalSets: row.total_sets,
    totalReps: row.total_reps,
    formScore: row.form_score,
    category: row.category,
  };
}
```

---

## 11. Seed Script

### 11.1 Purpose
Populate reference tables with initial data so the app is usable immediately after setup.

### 11.2 Seeded Tables

| Table | Record Count | Source |
|-------|-------------|--------|
| `muscle_groups` | ~10 | From `exercises.mock.ts` mockMuscleGroups |
| `exercises` | ~20+ | From `exercises.mock.ts` mockExercises |
| `rewards` | ~15+ | From `rewards.mock.ts` mockRewards |

### 11.3 Location

```
scripts/
├── seed.sql              # SQL seed script for Supabase SQL Editor
└── seed.ts               # Alternative: Node.js script using supabase-js
```

The seed script will be idempotent (uses `INSERT ... ON CONFLICT DO NOTHING`) so it can be re-run safely.

---

## 12. UI Changes

### 12.1 WelcomeScreen Updates

The existing `WelcomeScreen` will be updated with:
- "Sign in with Google" button (Google branding guidelines)
- "Sign in with Apple" button (Apple HIG compliant, required for App Store)
- Loading state during OAuth flow
- Error handling for failed auth attempts

### 12.2 Settings Screen Updates

Add to existing SettingsScreen:
- User profile display (name, email, avatar from OAuth)
- Sign Out button
- Delete Account option

### 12.3 SaveWorkoutScreen Updates

Currently uses `CurrentWorkoutContext` with in-memory storage. Will be updated to:
1. Call `workoutsService.create()` on save
2. Show loading spinner during save
3. Handle save errors with retry
4. Clear `CurrentWorkoutContext` on successful save
5. Navigate back to Logbook (which will now show persisted data)

---

## 13. Implementation Phases

### Phase 1: Foundation (Sprint 1 - MVP)

**Goal:** Users can sign in and save/view workouts.

| Task | Priority | Files |
|------|----------|-------|
| Create Supabase project | P0 | Dashboard |
| Configure Google + Apple OAuth providers | P0 | Dashboard |
| Run database migration (create all tables, RLS, triggers) | P0 | `scripts/migration.sql` |
| Install dependencies | P0 | `package.json` |
| Create `.env` with Supabase credentials | P0 | `.env` |
| Implement `src/services/supabase/client.ts` | P0 | New file |
| Implement `src/services/supabase/auth.ts` | P0 | New file |
| Create `AuthContext.tsx` | P0 | New file |
| Update `WelcomeScreen` with OAuth buttons | P0 | Existing file |
| Update `RootNavigator` with auth guard | P0 | Existing file |
| Migrate `user.service.ts` | P0 | Existing file |
| Migrate `workouts.service.ts` (read + write) | P0 | Existing file |
| Update `SaveWorkoutScreen` to call `workoutsService.create()` | P0 | Existing file |
| Update `client.ts` with per-service feature flags | P0 | Existing file |
| Run seed script (exercises, muscle groups, rewards) | P1 | `scripts/seed.sql` |
| Add deep link config to `app.json` | P1 | Existing file |

**Exit criteria:** User can sign in with Google/Apple, record a workout with MediaPipe, save it, and see it in Logbook after app restart.

### Phase 2: Data Services (Sprint 2)

**Goal:** Exercises load from database, analytics are tracked.

| Task | Priority | Files |
|------|----------|-------|
| Migrate `exercises.service.ts` | P0 | Existing file |
| Migrate `analytics.service.ts` | P0 | Existing file |
| Implement `recordMetric()` in analytics service | P1 | Existing file |
| Upload exercise media to Storage bucket | P1 | Supabase Dashboard |
| Implement `src/services/supabase/storage.ts` | P1 | New file |
| Update `exercises.mock.ts` image references to Storage URLs | P1 | Existing file |

**Exit criteria:** Exercise picker loads from Supabase, analytics screen shows real user data.

### Phase 3: Rewards & Polish (Sprint 3)

**Goal:** Full feature parity with mock layer (except Trainer).

| Task | Priority | Files |
|------|----------|-------|
| Migrate `rewards.service.ts` | P0 | Existing file |
| Migrate `insights.service.ts` | P0 | Existing file |
| Implement points system (earn on workout save, spend on redeem) | P1 | `rewards.service.ts` |
| Add Settings screen sign-out + account deletion | P1 | Existing file |
| Set all feature flags to `false` (Supabase) except trainer | P1 | `client.ts` |
| End-to-end testing across all screens | P0 | Manual |
| Remove unused mock delay from hot paths | P2 | Various |

**Exit criteria:** All screens except Trainer pull from Supabase. Mock layer preserved as fallback.

---

## 14. Testing Strategy

### 14.1 Manual Testing Checklist

#### Authentication
- [ ] Google Sign-In works on iOS
- [ ] Google Sign-In works on Android
- [ ] Apple Sign-In works on iOS
- [ ] New user gets profile + user_stats auto-created
- [ ] Returning user session restores automatically
- [ ] Sign out clears session and navigates to Welcome
- [ ] Invalid/expired token refreshes automatically

#### Workouts
- [ ] Save workout writes to Supabase (check Dashboard)
- [ ] Logbook shows persisted workouts after app restart
- [ ] Workout details screen loads exercises and sets
- [ ] Deleting a workout cascades to exercises and sets
- [ ] User A cannot see User B's workouts (RLS)

#### Exercises & Analytics
- [ ] Exercise picker loads from `exercises` table
- [ ] Exercise images load from Storage
- [ ] Analytics screen shows data from `user_analytics`
- [ ] Time range filters work correctly

#### Rewards
- [ ] Rewards catalog loads from `rewards` table
- [ ] User stats show correct points
- [ ] Redeeming a reward deducts points

#### Feature Flags
- [ ] Setting `services.workouts: true` falls back to mock data
- [ ] Setting `services.workouts: false` uses Supabase
- [ ] Mixed mode works (some services mock, some real)

### 14.2 RLS Verification

Create two test accounts and verify:
1. User A saves a workout
2. User B's Logbook does NOT show User A's workout
3. Direct Supabase query with User B's token returns empty for User A's data

---

## 15. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| OAuth redirect fails on device | Auth completely blocked | Medium | Test on physical devices early; have fallback URL scheme |
| Supabase cold starts slow on free tier | Poor UX on first load | Low | Accept for MVP; upgrade tier if needed |
| RLS misconfiguration exposes data | Security breach | Low | Test RLS with multiple accounts before launch |
| `react-native-url-polyfill` conflicts with existing deps | Build failure | Low | Test in isolation first; polyfill is well-maintained |
| AsyncStorage conflicts with Expo managed workflow | Session persistence breaks | Low | Use `npx expo install` for compatible version |
| Schema changes break mock layer | Mock fallback stops working | Medium | Keep mock types in sync; run both modes in CI |

---

## 16. Future Iterations (Post-MVP)

| Feature | Description | Depends On |
|---------|-------------|------------|
| AI Trainer with LLM | Replace mock responses with real AI via Edge Functions or external API | Supabase Edge Functions or external API key |
| Offline support | Cache data locally with AsyncStorage, sync on reconnect | AsyncStorage already installed for auth |
| Real-time workout sharing | Live workout feed using Supabase Realtime | Supabase Realtime channels |
| Social features | Follow users, share workouts, leaderboards | Schema extension, relaxed RLS |
| Workout templates | Save and reuse workout structures | New `workout_templates` table |
| Push notifications | Workout reminders, streak alerts | Expo Notifications + Supabase webhooks |
| User avatars upload | Let users upload custom profile pictures | New Storage bucket with user RLS |

---

## 17. Appendix

### A. Current Mock Service Interface Summary

| Service | Methods | Mock Status |
|---------|---------|-------------|
| `workoutsService` | `getAll()`, `getById(id)`, `getRecent(limit)` | Complete |
| `userService` | `getCurrentUser()`, `updateUser(updates)` | Complete |
| `exercisesService` | `getMuscleGroups()`, `getAll()`, `getByMuscleGroup(group)` | Complete |
| `analyticsService` | `getAnalytics(range)`, `getMetricByTimeRange(metric, range)`, `getWeeklyBarData()` | Complete |
| `rewardsService` | `getRewards()`, `getUserStats()`, `redeemReward(id)` | Complete |
| `trainerService` | `getProgress()`, `getRecommendations()`, `getAIResponse(msg)` | Complete (stays mock) |
| `insightsService` | `getInsights(metric)`, `getAllInsights()` | Complete |

### B. File Change Summary

| Category | Files | Action |
|----------|-------|--------|
| New files | `src/services/supabase/client.ts`, `src/services/supabase/auth.ts`, `src/services/supabase/storage.ts`, `src/contexts/AuthContext.tsx`, `scripts/migration.sql`, `scripts/seed.sql`, `.env`, `.env.example` | Create |
| Modified files | `src/services/api/client.ts`, `src/services/api/types.ts`, all 6 service files (except trainer), `src/screens/WelcomeScreen.tsx`, `src/screens/SaveWorkoutScreen.tsx`, `src/screens/SettingsScreen.tsx`, `src/app/RootNavigator.tsx`, `app.json`, `package.json`, `.gitignore` | Edit |
| Unchanged files | `src/services/api/trainer.service.ts`, all `src/services/mock/**` files, all other screens, all components, all hooks, all utils | No changes |

### C. Decision Log

| Decision | Rationale |
|----------|-----------|
| Social OAuth only (no email/password) | Reduces auth complexity, better UX, fewer password-related support issues |
| Google + Apple providers | Apple required for App Store; Google is most popular on Android |
| Feature-flag per service | Enables incremental migration, easy rollback per feature |
| Strict RLS on all user tables | Security by default; users must never see each other's data |
| Denormalized aggregates on workout_sessions | Avoids expensive JOINs on list views; updated via trigger |
| Exercise media in Storage (not in DB) | Better performance, CDN-backed delivery, standard pattern |
| No offline support for MVP | Significantly reduces complexity; can layer on later with AsyncStorage already installed |
| Trainer stays mock | AI integration is a separate initiative; mock responses are sufficient for MVP |
| Save on completion (not real-time) | Simpler architecture, fewer writes, matches current UX (user taps "Save") |
| snake_case in DB, camelCase in TS | PostgreSQL convention in DB; TypeScript convention in app; mapper functions bridge the gap |

---

*End of Document*
