# Text-to-Speech Feedback

## Overview

Tracked exercises use the ElevenLabs coach to speak short, friendly form cues while the detailed visual feedback remains on screen. The runtime path is:

1. Exercise definition generates exact visual feedback strings.
2. `src/utils/exercises/definitions/register.ts` merges each exercise's TTS config into the global message maps.
3. `src/backend/services/ttsCoach.ts` chooses one high-priority cue, rotates message variations, and calls `speakWithElevenLabs`.
4. `src/backend/services/elevenlabsTTS.ts` sends text to the Supabase `tts` Edge Function, which proxies ElevenLabs and returns audio.

## Message Model

Each exercise TTS config has:

- `feedbackToIssue`: exact visual feedback string to stable issue type.
- `issueDefinitions`: shared issue-level pools with priority and multiple spoken variations.
- `feedbackMessages`: optional exact feedback-string pools for exercise-specific cues when a generic issue pool would sound wrong.

The coach splits newline-joined visual feedback before lookup, so a screen string like:

```text
Slow down the push - control the movement.
Hips are sagging - engage your core to maintain a straight line.
```

still resolves to individual TTS candidates and speaks the highest-priority issue.

## Coverage Audit

Current coverage includes every feedback literal produced by the registered exercise definitions:

| Exercise | Visual feedback strings | Exact TTS pools added |
| --- | ---: | ---: |
| Barbell Curl | 13 | 0 |
| Cable Pushdowns | 6 | 5 |
| Cable Row | 6 | 3 |
| Cable Lat Pulldowns | 5 | 5 |
| Standing Dumbbell Lateral Raises | 7 | 1 |
| Leg Extensions | 6 | 5 |
| Lying Leg Curl | 5 | 1 |
| Machine Ab Crunches | 5 | 4 |
| Push-Up | 10 | 1 |
| Barbell Squat | 8 | 7 |
| Shared low-ROM partial rep | 1 | 1 |

The exact pools mainly cover cases where the old generic issue pool was technically mapped but not trainer-like enough, such as squat depth, ab-crunch extension, lat-pulldown return control, leg-extension pad contact, and cable-pushdown lockout.

## Guardrail

`src/backend/services/__tests__/ttsCoverage.test.ts` verifies:

- every exercise `messages.push(...)` feedback literal has a TTS issue mapping;
- every mapped issue has a speakable pool with at least three variations;
- exact feedback-specific pools are not orphaned;
- newline-joined form feedback is split before priority selection.
