# Before Production Checklist

Things that must be resolved before App Store submission.

---

## 1. Switch OAuth from Implicit Flow to PKCE

**Current state:** Google Sign-In uses implicit flow — tokens are returned in the URL hash (`forma://#access_token=...`). This was a deliberate fallback because PKCE flow caused "invalid flow state" errors on real devices (iOS backgrounding the app during OAuth clears the in-memory PKCE verifier before the code exchange completes).

**Why it matters for production:**
- Tokens in the URL hash can be intercepted by other apps registered for the `forma://` scheme
- Apple increasingly scrutinizes apps with financial transactions (paywalls) for auth security
- PKCE is the OAuth 2.0 best practice for native mobile apps

**What needs to be done:**
1. Switch to `expo-linking` to handle the deep link redirect as a native app event rather than catching it inside `WebBrowser.openAuthSessionAsync`. This keeps the Supabase client alive and the PKCE verifier in AsyncStorage across the browser session.
2. Add `flowType: 'pkce'` back to the Supabase client config in `src/services/supabase/client.ts`
3. Update `src/services/supabase/auth.ts` to use the `expo-linking` approach instead of polling `openAuthSessionAsync` result
4. Test on a real device — the simulator does not reproduce the lifecycle issue

**Reference files:**
- `src/services/supabase/client.ts` — add `flowType: 'pkce'`
- `src/services/supabase/auth.ts` — rewrite `handleOAuthResult` using `expo-linking`
- `expo-crypto` is already installed (used internally by supabase-js for PKCE verifier generation)

---

## 2. Remove Mock Data from Logbook

**Current state:** `LogbookScreen` merges real Supabase workouts with `mockWorkoutSessions` from `workoutStorage.ts`. The mock data was kept so the screen isn't empty during development.

**What needs to be done:**
- Remove the `getWorkouts()` call and mock merge logic from `LogbookScreen.tsx`
- Remove the `workoutStorage.ts` import from `SaveWorkoutScreen.tsx` if any remnants remain

---

## 3. Replace "Athlete" with Real User Display Name

**Current state:** The Logbook header hardcodes `"Athlete"` as the welcome name. The real display name is available via `userService.getCurrentUser()` or `useAuth().user`.

---

## 4. Environment Variables — Production Keys

**Current state:** `.env` contains development Supabase keys (anon key is safe to ship, but double-check RLS policies are airtight before going live).

**What needs to be done:**
- Audit all RLS policies in `scripts/migration.sql` — ensure no user can read another user's data
- Confirm the Supabase anon key has no elevated privileges
- Set up separate Supabase projects for dev and prod environments

---

## 5. Apple Sign-In

**Current state:** Apple Sign-In button is present in `WelcomeScreen` but the Supabase Apple provider is not configured (pending Apple Developer Program membership).

**What needs to be done:**
- Join Apple Developer Program
- Follow the Apple Sign-In setup steps in `docs/PRD-SUPABASE-INTEGRATION.md`
- Apple Sign-In is **required by App Store guidelines** for any app that offers third-party login (Google)
