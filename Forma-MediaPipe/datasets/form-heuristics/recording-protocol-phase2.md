# Phase 2 Recording Protocol — Barbell Curl (Multi-Subject Eval)

**Why this matters:** every accuracy number we have comes from one person (Suvan). These
recordings are the independent test set that decides whether the form feedback is
production-ready. They are for **evaluation, not training** — honest ground truth matters
more than perfect form.

**Total time: ~35–45 min.** One subject, 9 short sets, with rest between sets.

---

## Device prep (Suvan does this before handing over)

- [ ] Dev build installed, debug mode ON, landmark recording ON
- [ ] Confirm a test recording saves and can be pulled (`scripts/pull-recordings.sh`)
- [ ] Bring: barbell/EZ-bar with a weight Mohammad can curl for 8 controlled reps
- [ ] Print or open this doc + the ground-truth log template (bottom)

## Camera setup (different from Suvan's usual spot — that's the point)

- Phone on tripod/stable prop, **front-on** to the lifter (facing them squarely)
- Distance ~1.5–2 m, camera height roughly chest level
- Lifter fully visible from **head to mid-thigh minimum** for the whole set
- Wait for the in-app status pill to show good tracking before starting each set
- Lighting: normal gym/room lighting is fine; avoid strong backlight (window behind lifter)

## Rules for every set

1. **Stand still ~2 seconds** in the start position before rep 1 (warmup gate).
2. One recording per set: start set → do the reps → end set. Don't merge sets.
3. Faults must be **deliberate and unambiguous** — exaggerate slightly.
4. **Clean means genuinely clean**: full curl up, full extension down, torso still, controlled speed.
5. Immediately after each set, fill in the ground-truth log — per rep, what you actually did. If a rep came out different than intended (e.g., you meant clean but swung), **write what actually happened**. That honesty is the entire value of this exercise.

---

## The 9 sets

| # | Set | Reps | Script |
|---|-----|------|--------|
| 1 | Clean baseline | 8 | All clean, controlled |
| 2 | Short ROM | 6 | Rep 1 clean → reps 2–5 **stop the curl around halfway up** (don't bring the bar near your shoulders), full lowering → rep 6 clean |
| 3 | Torso swing | 6 | Rep 1 clean → reps 2–5 **lean back / rock your torso** to swing the bar up (keep shoulders down, don't shrug) → rep 6 clean |
| 4 | Shoulder lift | 6 | Rep 1 clean → reps 2–5 **shrug/raise your shoulders and drive elbows forward** to lift the bar (keep torso still) → rep 6 clean |
| 5 | Fast tempo | 6 | Rep 1 clean → reps 2–5 **throw the bar up as fast as possible** (lowering can be normal) → rep 6 clean |
| 6 | Hard negative | 6 | All clean but **exaggerated**: extra-hard squeeze at the top, extra-slow 3-second lowering, deliberate pause at full extension. This set tries to fool the app into false complaints — perfect form, unusual style |
| 7 | Realistic mixed | 8–10 | Go a bit heavier. Curl naturally to near-fatigue. Faults will creep in on their own — afterwards, log **per rep** what actually happened (clean / short / swing / shoulder / fast), best honest judgment |
| 8 | Leave-frame | 4 | 2 clean reps → **put the bar down and walk fully out of frame for ~5 seconds** → walk back, settle ~2s → 2 more clean reps. Expected count is exactly 4 — this tests a known double-counting bug |
| 9 | Second camera spot | 6 | Move the phone: different distance (~1 m closer/farther) or ~20–30° off-center. All clean reps |

Sets 3 vs 4 are the most important pair — the app currently confuses torso swing with
shoulder lift. Keep them as isolated as you can: **swing = torso only, shrug = shoulders only.**

---

## Ground-truth log (fill one block per set, immediately after the set)

```
Set #: ___   Time: ___   Weight: ___
Camera: position A / position B
Intended script followed? yes / no (explain)

Rep 1: clean / short-ROM / torso-swing / shoulder-lift / fast / other: ___
Rep 2: ...
Rep 3: ...
(one line per rep — including reps the app may not have counted)

Total reps actually performed: ___
Anything weird (stumble, half-rep, stepped away, bar dropped): ___
```

## After the session (Suvan)

- [ ] Pull recordings: `scripts/pull-recordings.sh`
- [ ] Rename files to `m01-clean-baseline.json` … `m09-second-angle.json` (match the log)
- [ ] Keep the ground-truth log with the files — labels get written from the log, **not** from what the app detected
- [ ] New subject metadata for labels: `subjectId: subject-barbell-curl-002`, fresh `sessionId`, fresh `cameraSetupId`
- [ ] Run the bake-off on the new files only — that result is the production-readiness number
