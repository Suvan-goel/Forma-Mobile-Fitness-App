# PRD: API Scaffold Refactor

**Document Version:** 1.0
**Date:** February 3, 2026
**Author:** Product Management
**Status:** Draft - Pending Approval

---

## 1. Executive Summary

### 1.1 Overview
This PRD defines the refactoring effort to replace all hardcoded data in the Forma Mobile app with a mock service layer that mirrors the future Supabase API structure. The goal is to establish clean separation between UI components and data sources, enabling seamless migration to a production backend.

### 1.2 Problem Statement
The current Forma app contains **100+ hardcoded data points** across 8 screens, including:
- Mock workout sessions and analytics metrics
- Static exercise database (57 exercises)
- Hardcoded rewards, insights, and AI trainer responses
- In-memory storage that doesn't persist across sessions

This makes it impossible to:
- Connect to a real backend without significant code changes
- Test API integration patterns
- Scale the app for real users

### 1.3 Solution
Create a **mock service layer** that:
1. Abstracts all data access behind service functions
2. Returns dummy data with the same structure as future Supabase responses
3. Implements full UX states (loading, error, empty, success)
4. Enables one-line swap to real Supabase client when ready

### 1.4 Success Criteria
- **Clean Separation:** Zero hardcoded data values in UI components
- **Service Interface:** All data flows through `src/services/` modules
- **UX States:** Every data-dependent component handles loading, error, empty, and success states
- **Supabase Ready:** Service functions mirror Supabase client patterns for easy migration

---

## 2. Scope

### 2.1 In Scope
| Category | Items |
|----------|-------|
| Screens | AnalyticsScreen, ChooseExerciseScreen, LogbookScreen, WorkoutDetailsScreen, TrainerScreen, InsightsScreen, RewardsScreen, CameraScreen |
| Operations | Read operations (GET endpoints) - MVP priority |
| Service Layer | Mock service modules with typed interfaces |
| UX States | Loading skeletons, error messages, retry buttons, empty states |
| Data Models | TypeScript interfaces for all entities |

### 2.2 Out of Scope (Future Iterations)
- Write operations (POST/PUT/DELETE) - Phase 2
- Supabase database schema design - Separate PRD
- Authentication/authorization - Separate PRD
- Real AI/ML model integration for trainer
- Offline persistence with AsyncStorage

---

## 3. Technical Architecture

### 3.1 Service Layer Structure

```
src/
├── services/
│   ├── api/
│   │   ├── index.ts              # Service exports
│   │   ├── client.ts             # Future Supabase client (mock for now)
│   │   ├── types.ts              # Shared API types
│   │   ├── workouts.service.ts   # Workout-related endpoints
│   │   ├── exercises.service.ts  # Exercise database endpoints
│   │   ├── analytics.service.ts  # Analytics/metrics endpoints
│   │   ├── trainer.service.ts    # AI trainer endpoints
│   │   ├── rewards.service.ts    # Rewards system endpoints
│   │   └── user.service.ts       # User profile endpoints
│   └── mock/
│       ├── data/
│       │   ├── workouts.mock.ts
│       │   ├── exercises.mock.ts
│       │   ├── analytics.mock.ts
│       │   ├── trainer.mock.ts
│       │   ├── rewards.mock.ts
│       │   └── user.mock.ts
│       └── delay.ts              # Simulate network latency
├── hooks/
│   ├── useWorkouts.ts
│   ├── useExercises.ts
│   ├── useAnalytics.ts
│   ├── useTrainer.ts
│   ├── useRewards.ts
│   └── useUser.ts
└── components/
    └── ui/
        ├── LoadingSkeleton.tsx
        ├── ErrorState.tsx
        ├── EmptyState.tsx
        └── RetryButton.tsx
```

### 3.2 Service Pattern

Each service module follows this pattern:

```typescript
// services/api/workouts.service.ts
import { mockWorkouts } from '../mock/data/workouts.mock';
import { simulateDelay } from '../mock/delay';

export interface Workout {
  id: string;
  name: string;
  date: string;
  duration: string;
  totalSets: number;
  totalReps: number;
  formScore: number;
  exercises?: WorkoutExercise[];
}

export interface WorkoutsService {
  getWorkouts(filters?: WorkoutFilters): Promise<Workout[]>;
  getWorkoutById(id: string): Promise<Workout | null>;
}

// Mock implementation (swap to Supabase later)
export const workoutsService: WorkoutsService = {
  async getWorkouts(filters) {
    await simulateDelay();
    // Return mock data filtered by params
    return mockWorkouts.filter(/* apply filters */);
  },

  async getWorkoutById(id) {
    await simulateDelay();
    return mockWorkouts.find(w => w.id === id) ?? null;
  }
};
```

### 3.3 Custom Hook Pattern

```typescript
// hooks/useWorkouts.ts
import { useState, useEffect } from 'react';
import { workoutsService, Workout } from '../services/api/workouts.service';

interface UseWorkoutsResult {
  workouts: Workout[];
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useWorkouts(filters?: WorkoutFilters): UseWorkoutsResult {
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchWorkouts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await workoutsService.getWorkouts(filters);
      setWorkouts(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkouts();
  }, [filters]);

  return { workouts, isLoading, error, refetch: fetchWorkouts };
}
```

### 3.4 Component Usage Pattern

```typescript
// screens/LogbookScreen.tsx
import { useWorkouts } from '../hooks/useWorkouts';
import { LoadingSkeleton } from '../components/ui/LoadingSkeleton';
import { ErrorState } from '../components/ui/ErrorState';
import { EmptyState } from '../components/ui/EmptyState';

export function LogbookScreen() {
  const { workouts, isLoading, error, refetch } = useWorkouts();

  if (isLoading) {
    return <LoadingSkeleton variant="workoutList" />;
  }

  if (error) {
    return <ErrorState message={error.message} onRetry={refetch} />;
  }

  if (workouts.length === 0) {
    return <EmptyState
      title="No workouts yet"
      description="Start your first workout to see it here"
    />;
  }

  return (
    <FlatList
      data={workouts}
      renderItem={({ item }) => <WorkoutCard workout={item} />}
    />
  );
}
```

---

## 4. Screen-by-Screen Refactor Plan

### 4.1 AnalyticsScreen.tsx

**Current State:**
- 3 hardcoded metric arrays (Form, Consistency, Strength)
- Hardcoded workout duration data by day
- Synthetic data generation based on time range

**Hardcoded Data to Remove:**
```typescript
// Line ~50-80: Remove these arrays
const formData = [72, 75, 78, 82, 80, 85, 87];
const consistencyData = [65, 70, 68, 72, 75, 78, 79];
const strengthData = [70, 72, 75, 78, 80, 82, 84];
const workoutDurations = { Mon: 60, Tue: 80, Wed: 100, ... };
```

**New Service Calls:**
| Endpoint | Hook | Data Returned |
|----------|------|---------------|
| `GET /analytics/metrics` | `useAnalyticsMetrics(timeRange)` | `{ form: number[], consistency: number[], strength: number[], dates: string[] }` |
| `GET /analytics/workouts/duration` | `useWorkoutDurations(timeRange)` | `{ day: string, duration: number }[]` |
| `GET /analytics/trends` | `useAnalyticsTrends(timeRange)` | `{ formTrend: number, consistencyTrend: number, strengthTrend: number }` |

**UX States Required:**
- Loading: Skeleton cards for CircularProgress, skeleton chart lines
- Error: Full-screen error with retry button
- Empty: "Complete your first workout to see analytics"

---

### 4.2 ChooseExerciseScreen.tsx

**Current State:**
- 57 exercises hardcoded in `exercisesByCategory` object
- 10 muscle group tabs hardcoded

**Hardcoded Data to Remove:**
```typescript
// Line ~20-150: Remove entire exercisesByCategory object
const exercisesByCategory = {
  Chest: ['Barbell Bench Press', 'Incline Dumbbell Press', ...],
  Back: ['Deadlift', 'Pull-Ups', ...],
  // ... 8 more categories
};
```

**New Service Calls:**
| Endpoint | Hook | Data Returned |
|----------|------|---------------|
| `GET /exercises` | `useExercises()` | `Exercise[]` with all exercises |
| `GET /exercises/categories` | `useExerciseCategories()` | `{ id: string, name: string, emoji: string }[]` |
| `GET /exercises?category=chest` | `useExercises({ category })` | Filtered `Exercise[]` |

**Data Model:**
```typescript
interface Exercise {
  id: string;
  name: string;
  category: ExerciseCategory;
  muscleGroups: string[];
  imageUrl?: string;
  instructions?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}
```

**UX States Required:**
- Loading: Skeleton cards in grid layout
- Error: Inline error banner with retry
- Empty: "No exercises found" (shouldn't happen with seeded data)

---

### 4.3 LogbookScreen.tsx

**Current State:**
- 6 mock workouts hardcoded in `mockWorkoutSessions`
- Merges with in-memory `workoutStorage`
- Filter dropdowns with hardcoded options

**Hardcoded Data to Remove:**
```typescript
// Line ~30-70: Remove mockWorkoutSessions array
const mockWorkoutSessions = [
  { id: '1', name: 'Push Day - Strength', date: 'Oct 24', ... },
  { id: '2', name: 'Leg Hypertrophy', date: 'Oct 22', ... },
  // ... 4 more workouts
];
```

**New Service Calls:**
| Endpoint | Hook | Data Returned |
|----------|------|---------------|
| `GET /workouts` | `useWorkouts()` | `Workout[]` |
| `GET /workouts?year=2024&month=10` | `useWorkouts({ year, month })` | Filtered `Workout[]` |
| `GET /workouts?date=2024-10-24` | `useWorkouts({ date })` | Filtered `Workout[]` |

**UX States Required:**
- Loading: Skeleton workout cards (3-4 placeholders)
- Error: Full-screen error with retry
- Empty: "No workouts found. Start tracking to see your history!"

---

### 4.4 WorkoutDetailsScreen.tsx

**Current State:**
- 6 complete workout details with exercises and sets in `mockWorkoutDetails`

**Hardcoded Data to Remove:**
```typescript
// Line ~20-150: Remove mockWorkoutDetails object
const mockWorkoutDetails = {
  '1': {
    name: 'Push Day - Strength',
    exercises: [
      { name: 'Bench Press', sets: [{ setNumber: 1, reps: 8, weight: 225, formScore: 88 }, ...] },
      ...
    ]
  },
  // ... 5 more workouts
};
```

**New Service Calls:**
| Endpoint | Hook | Data Returned |
|----------|------|---------------|
| `GET /workouts/:id` | `useWorkoutDetails(id)` | `WorkoutDetails` with nested exercises and sets |

**Data Model:**
```typescript
interface WorkoutDetails extends Workout {
  exercises: {
    id: string;
    name: string;
    sets: {
      setNumber: number;
      reps: number;
      weight: number;
      formScore: number;
    }[];
  }[];
}
```

**UX States Required:**
- Loading: Skeleton with header + exercise card skeletons
- Error: Full-screen error with retry and back button
- Empty: "Workout not found" (edge case)

---

### 4.5 TrainerScreen.tsx

**Current State:**
- Uses same 6 mock workouts as LogbookScreen
- Hardcoded recommendation templates
- Pattern-matching AI responses

**Hardcoded Data to Remove:**
```typescript
// Line ~30-60: Remove mockWorkoutSessions
// Line ~80-120: Remove recommendation templates
// Line ~150-250: Remove AI response generation patterns
```

**New Service Calls:**
| Endpoint | Hook | Data Returned |
|----------|------|---------------|
| `GET /trainer/recommendations` | `useTrainerRecommendations()` | `Recommendation[]` |
| `GET /trainer/progress` | `useTrainerProgress()` | `{ avgForm: number, totalReps: number, formTrend: number, ... }` |
| `POST /trainer/chat` | `sendTrainerMessage(message)` | `{ response: string }` (mock for now) |

**Data Model:**
```typescript
interface Recommendation {
  id: string;
  type: 'success' | 'warning' | 'info';
  title: string;
  description: string;
  icon: string;
}
```

**UX States Required:**
- Loading: Skeleton recommendation cards + progress summary
- Error: Inline error with retry for each section
- Empty: "Complete more workouts to get personalized recommendations"

---

### 4.6 InsightsScreen.tsx

**Current State:**
- 15 hardcoded insight strings (5 per metric: Form, Consistency, Strength)

**Hardcoded Data to Remove:**
```typescript
// Line ~15-45: Remove insightsData object
const insightsData = {
  Form: ['15% increase in average score...', ...],
  Consistency: ['79% consistency rate...', ...],
  Strength: ['14-point improvement...', ...]
};
```

**New Service Calls:**
| Endpoint | Hook | Data Returned |
|----------|------|---------------|
| `GET /analytics/insights/:metric` | `useInsights(metric)` | `string[]` |
| `GET /analytics/recommendations/:metric` | `useMetricRecommendations(metric)` | `string[]` |

**UX States Required:**
- Loading: Skeleton text lines (5 placeholders)
- Error: Full-screen error with retry
- Empty: "Not enough data to generate insights yet"

---

### 4.7 RewardsScreen.tsx

**Current State:**
- 8 hardcoded rewards with point values
- Hardcoded user stats (formScore: 87, consistencyScore: 79)

**Hardcoded Data to Remove:**
```typescript
// Line ~20-35: Remove userStats
const userStats = { formScore: 87, consistencyScore: 79 };

// Line ~40-80: Remove rewards array
const rewards = [
  { id: '1', title: 'Free Protein Shake', pointsRequired: 200, ... },
  // ... 7 more rewards
];
```

**New Service Calls:**
| Endpoint | Hook | Data Returned |
|----------|------|---------------|
| `GET /user/stats` | `useUserStats()` | `{ formScore: number, consistencyScore: number, totalPoints: number }` |
| `GET /rewards` | `useRewards()` | `Reward[]` |
| `GET /rewards/user/redeemed` | `useRedeemedRewards()` | `RedeemedReward[]` |

**Data Model:**
```typescript
interface Reward {
  id: string;
  title: string;
  description?: string;
  pointsRequired: number;
  icon: string;
  category: 'supplements' | 'meals' | 'gym' | 'accessories';
}
```

**UX States Required:**
- Loading: Skeleton points card + skeleton reward cards
- Error: Full-screen error with retry
- Empty: "No rewards available" (shouldn't happen with seeded data)

---

### 4.8 CameraScreen.tsx

**Current State:**
- Minimal hardcoding (camera aspect ratio, MediaPipe config)
- Uses CurrentWorkoutContext for state

**Changes Required:**
- No major refactoring needed for MVP (read operations)
- Future: `POST /pose-analysis/analyze` for server-side form scoring
- Future: `POST /workouts` endpoint integration via SaveWorkoutScreen

---

## 5. Shared UI Components

### 5.1 LoadingSkeleton

```typescript
interface LoadingSkeletonProps {
  variant: 'card' | 'list' | 'chart' | 'text' | 'workoutList' | 'exerciseGrid';
  count?: number;
}
```

**Variants:**
- `card`: Single card skeleton with title and subtitle placeholders
- `list`: Multiple list item skeletons
- `chart`: Chart placeholder with axis lines
- `text`: Paragraph text lines
- `workoutList`: Specialized workout card skeletons
- `exerciseGrid`: Grid of exercise card skeletons

### 5.2 ErrorState

```typescript
interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  showBackButton?: boolean;
}
```

### 5.3 EmptyState

```typescript
interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
}
```

---

## 6. Mock Data Specifications

### 6.1 Network Simulation

```typescript
// services/mock/delay.ts
const MOCK_DELAY_MS = 800; // Simulate network latency
const MOCK_ERROR_RATE = 0; // Set to 0.1 for 10% error rate during testing

export async function simulateDelay(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, MOCK_DELAY_MS));

  if (Math.random() < MOCK_ERROR_RATE) {
    throw new Error('Simulated network error');
  }
}
```

### 6.2 Mock Data Structure

All mock data files export typed data that matches the API response structure:

```typescript
// services/mock/data/workouts.mock.ts
import { Workout, WorkoutDetails } from '../../api/workouts.service';

export const mockWorkouts: Workout[] = [
  {
    id: '1',
    name: 'Push Day - Strength',
    date: '2024-10-24',
    duration: '45 min',
    totalSets: 15,
    totalReps: 120,
    formScore: 87
  },
  // ... more workouts
];

export const mockWorkoutDetails: Record<string, WorkoutDetails> = {
  '1': {
    ...mockWorkouts[0],
    exercises: [
      {
        id: 'ex1',
        name: 'Bench Press',
        sets: [
          { setNumber: 1, reps: 8, weight: 225, formScore: 88 },
          // ... more sets
        ]
      }
    ]
  }
};
```

---

## 7. File Change Summary

### 7.1 New Files to Create

| File | Purpose |
|------|---------|
| `src/services/api/index.ts` | Service barrel export |
| `src/services/api/client.ts` | API client (mock → Supabase) |
| `src/services/api/types.ts` | Shared TypeScript types |
| `src/services/api/workouts.service.ts` | Workout CRUD operations |
| `src/services/api/exercises.service.ts` | Exercise database operations |
| `src/services/api/analytics.service.ts` | Analytics/metrics operations |
| `src/services/api/trainer.service.ts` | AI trainer operations |
| `src/services/api/rewards.service.ts` | Rewards system operations |
| `src/services/api/user.service.ts` | User profile operations |
| `src/services/mock/delay.ts` | Network simulation utility |
| `src/services/mock/data/workouts.mock.ts` | Mock workout data |
| `src/services/mock/data/exercises.mock.ts` | Mock exercise database |
| `src/services/mock/data/analytics.mock.ts` | Mock analytics data |
| `src/services/mock/data/trainer.mock.ts` | Mock trainer data |
| `src/services/mock/data/rewards.mock.ts` | Mock rewards data |
| `src/services/mock/data/user.mock.ts` | Mock user data |
| `src/hooks/useWorkouts.ts` | Workout data hook |
| `src/hooks/useExercises.ts` | Exercise data hook |
| `src/hooks/useAnalytics.ts` | Analytics data hook |
| `src/hooks/useTrainer.ts` | Trainer data hook |
| `src/hooks/useRewards.ts` | Rewards data hook |
| `src/hooks/useUser.ts` | User data hook |
| `src/components/ui/LoadingSkeleton.tsx` | Loading skeleton component |
| `src/components/ui/ErrorState.tsx` | Error state component |
| `src/components/ui/EmptyState.tsx` | Empty state component |
| `src/components/ui/RetryButton.tsx` | Retry button component |

### 7.2 Files to Modify

| File | Changes |
|------|---------|
| `src/screens/AnalyticsScreen.tsx` | Remove hardcoded metrics, use `useAnalytics` hook |
| `src/screens/ChooseExerciseScreen.tsx` | Remove hardcoded exercises, use `useExercises` hook |
| `src/screens/LogbookScreen.tsx` | Remove mock workouts, use `useWorkouts` hook |
| `src/screens/WorkoutDetailsScreen.tsx` | Remove mock details, use `useWorkoutDetails` hook |
| `src/screens/TrainerScreen.tsx` | Remove mock data, use `useTrainer` hooks |
| `src/screens/InsightsScreen.tsx` | Remove hardcoded insights, use `useInsights` hook |
| `src/screens/RewardsScreen.tsx` | Remove hardcoded rewards, use `useRewards` hook |

### 7.3 Files to Delete

| File | Reason |
|------|--------|
| `src/utils/workoutStorage.ts` | Replaced by workouts.service.ts |

---

## 8. API Endpoint Summary

### 8.1 Read Operations (MVP - Phase 1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/workouts` | List all user workouts |
| GET | `/workouts/:id` | Get workout details with exercises |
| GET | `/exercises` | List all exercises |
| GET | `/exercises/categories` | List exercise categories |
| GET | `/analytics/metrics` | Get form/consistency/strength over time |
| GET | `/analytics/workouts/duration` | Get workout duration by day |
| GET | `/analytics/trends` | Get metric trends |
| GET | `/analytics/insights/:metric` | Get insights for a metric |
| GET | `/trainer/recommendations` | Get personalized recommendations |
| GET | `/trainer/progress` | Get progress summary |
| GET | `/rewards` | List available rewards |
| GET | `/user/stats` | Get user statistics |

### 8.2 Write Operations (Phase 2 - Future)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/workouts` | Create new workout |
| PUT | `/workouts/:id` | Update workout |
| DELETE | `/workouts/:id` | Delete workout |
| POST | `/trainer/chat` | Send message to AI trainer |
| POST | `/rewards/:id/redeem` | Redeem a reward |
| PUT | `/user/profile` | Update user profile |
| PUT | `/user/preferences` | Update user preferences |

---

## 9. Implementation Phases

### Phase 1: Foundation (Week 1)
1. Create service layer directory structure
2. Define all TypeScript interfaces in `types.ts`
3. Create mock data files with existing hardcoded data
4. Implement `simulateDelay` utility
5. Create shared UI components (LoadingSkeleton, ErrorState, EmptyState)

### Phase 2: Core Services (Week 2)
1. Implement `workouts.service.ts` with mock backend
2. Implement `exercises.service.ts` with mock backend
3. Create `useWorkouts` and `useExercises` hooks
4. Refactor LogbookScreen, WorkoutDetailsScreen, ChooseExerciseScreen

### Phase 3: Analytics & Trainer (Week 3)
1. Implement `analytics.service.ts` with mock backend
2. Implement `trainer.service.ts` with mock backend
3. Create `useAnalytics` and `useTrainer` hooks
4. Refactor AnalyticsScreen, InsightsScreen, TrainerScreen

### Phase 4: User & Rewards (Week 4)
1. Implement `rewards.service.ts` with mock backend
2. Implement `user.service.ts` with mock backend
3. Create `useRewards` and `useUser` hooks
4. Refactor RewardsScreen
5. Final testing and polish

---

## 10. Testing Requirements

### 10.1 Unit Tests
- All service functions with mocked responses
- All custom hooks with React Testing Library
- Loading/error/empty state components

### 10.2 Integration Tests
- Screen renders correctly in all states (loading, error, empty, success)
- Data flows correctly from service → hook → component
- Error retry functionality works

### 10.3 Manual Testing Checklist
- [ ] Each screen shows loading skeleton on initial load
- [ ] Each screen handles network errors gracefully
- [ ] Each screen shows appropriate empty state
- [ ] Each screen displays data correctly when available
- [ ] Retry buttons trigger refetch
- [ ] Navigation between screens preserves state appropriately

---

## 11. Future Considerations

### 11.1 Supabase Migration Path
When ready to connect to real Supabase backend:

1. Install Supabase client: `npx expo install @supabase/supabase-js`
2. Update `src/services/api/client.ts` to initialize Supabase
3. Replace mock implementations in service files with Supabase queries
4. No changes required to hooks or components

Example migration:
```typescript
// Before (mock)
async getWorkouts() {
  await simulateDelay();
  return mockWorkouts;
}

// After (Supabase)
async getWorkouts() {
  const { data, error } = await supabase
    .from('workouts')
    .select('*')
    .order('date', { ascending: false });
  if (error) throw error;
  return data;
}
```

### 11.2 Real-time Subscriptions
For live workout tracking, Supabase Realtime can be added:
```typescript
// Future enhancement
supabase
  .channel('workout-updates')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'sets' },
    payload => updateLiveWorkout(payload))
  .subscribe();
```

### 11.3 Offline Support
Future AsyncStorage caching can be layered on top:
```typescript
// Future enhancement
async getWorkouts() {
  try {
    const data = await supabase.from('workouts').select('*');
    await AsyncStorage.setItem('workouts_cache', JSON.stringify(data));
    return data;
  } catch (error) {
    const cached = await AsyncStorage.getItem('workouts_cache');
    if (cached) return JSON.parse(cached);
    throw error;
  }
}
```

---

## 12. Appendix

### A. Current Hardcoded Data Inventory

| Screen | Data Type | Approximate Lines | Priority |
|--------|-----------|-------------------|----------|
| AnalyticsScreen | Metric arrays, durations | 30 lines | High |
| ChooseExerciseScreen | 57 exercises | 130 lines | High |
| LogbookScreen | 6 workouts | 40 lines | High |
| WorkoutDetailsScreen | 6 workout details | 130 lines | High |
| TrainerScreen | Workouts, recommendations, AI patterns | 170 lines | Medium |
| InsightsScreen | 15 insight strings | 30 lines | Medium |
| RewardsScreen | 8 rewards, user stats | 50 lines | Medium |

**Total: ~580 lines of hardcoded data to extract**

### B. Dependencies

No new dependencies required for mock service layer.

Future Supabase integration will require:
```json
{
  "@supabase/supabase-js": "^2.x"
}
```

---

## 13. Approval

| Role | Name | Date | Signature |
|------|------|------|-----------|
| Product Manager | | | |
| Tech Lead | | | |
| Engineering | | | |

---

*End of Document*
