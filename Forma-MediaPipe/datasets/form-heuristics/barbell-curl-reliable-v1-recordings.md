# Barbell Curl Reliable-v1 Recording Plan

This is the 50-recording Barbell Curl collection plan for reliable form feedback.
It is designed for heuristic tuning now and future model or hybrid training
later. The plan prioritizes issue coverage, clean negatives, hard negatives,
partial-view coverage, and unscorable view-quality examples.

## Summary

| Split | Recordings | Reps | Purpose |
| --- | ---: | ---: | --- |
| Train | 30 | 187 | Fit thresholds/features with clean, isolated, mixed, partial-view, and unscorable examples. |
| Validation | 10 | 63 | Select configs/models using independent issue coverage and hard negatives. |
| Test | 10 | 66 | Hold out final reliability checks with every issue represented. |
| Total | 50 | 316 | 304 scorable reps plus 12 unscorable/view-quality reps. |

Coverage targets in this plan:

- 120 clean scorable reps, including 18 hard-negative clean reps.
- 12 unscorable reps across 4 unsupported/poor-quality recordings.
- 10 side/oblique partial-view reps where only visible-arm issues are labelable.
- Every labelable Barbell Curl issue appears in train, validation, and test.
- Validation has at least 2 positives per issue; test has at least 3 positives per issue.

## Labeling Rules

- Use `view="front"` and `scorable=true` for full-form Barbell Curl scoring.
- Side or oblique partial-view clips may be `scorable=true`, but only label visible-arm ROM, shoulder involvement, torso swing, and tempo.
- Do not label `barbell-curl.asymmetry` or `barbell-curl.elbow_flare` from side or oblique clips.
- Unsupported, badly occluded, or unstable clips should be `scorable=false` with `issueIds: []`.
- Every reviewed label needs correct `startMs`, `endMs`, `view`, `scorable`, and `reviewStatus: "reviewed"`.
- Use `issueSeverities` when possible. Rows marked mild should be labelled `mild`; rows marked clear should be labelled `moderate` or `severe`, depending on how obvious the fault is.
- If the lifter accidentally performs a different visible issue than the plan says, label the truth in the video and note the mismatch.

## Issue Coverage

Counts below are positive issue-label appearances. Combined-fault reps can add
two issue IDs on one rep.

| Issue ID | Train | Validation | Test | Total |
| --- | ---: | ---: | ---: | ---: |
| `barbell-curl.incomplete_flex` | 12 | 2 | 5 | 19 |
| `barbell-curl.incomplete_extend` | 12 | 2 | 5 | 19 |
| `barbell-curl.incomplete_rom` | 9 | 7 | 3 | 19 |
| `barbell-curl.shoulder_warn` | 8 | 2 | 5 | 15 |
| `barbell-curl.shoulder_fail` | 13 | 3 | 3 | 19 |
| `barbell-curl.torso_warn` | 9 | 2 | 6 | 17 |
| `barbell-curl.torso_fail` | 13 | 3 | 3 | 19 |
| `barbell-curl.elbow_flare` | 11 | 4 | 3 | 18 |
| `barbell-curl.tempo_up` | 8 | 5 | 3 | 16 |
| `barbell-curl.tempo_down` | 10 | 3 | 3 | 16 |
| `barbell-curl.asymmetry` | 13 | 4 | 5 | 22 |

## Recording Guidance

Rotate recordings across 3-5 participants. With 5 people, aim for 10 recordings
per person. With 3 people, keep split sessions separate and make sure each issue
appears from at least 2 people. Validation and test clips must be filmed in
separate sessions from train clips.

Each recording below is written as a self-contained set card. The `Label` column
is what should go in `issueIds` for that rep. Clean reps should have
`issueIds: []`.

## Train Recordings

### train01-clean-front-a

Setup: `split=train`, `view=front`, `scorable=true`, 5 reps. Normal load, normal tempo, full body and bar visible.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. Full extension at bottom, full curl at top, stable torso. | `[]` |
| 2 | Clean full curl. | `[]` |
| 3 | Clean full curl. | `[]` |
| 4 | Clean full curl. | `[]` |
| 5 | Clean full curl. | `[]` |

### train02-clean-front-b

Setup: `split=train`, `view=front`, `scorable=true`, 5 reps. Use a different subject or camera distance from train01 if possible.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Clean full curl. | `[]` |
| 3 | Clean full curl. | `[]` |
| 4 | Clean full curl. | `[]` |
| 5 | Clean full curl. | `[]` |

### train03-clean-front-c

Setup: `split=train`, `view=front`, `scorable=true`, 5 reps. Slightly slower controlled reps, still natural.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with controlled tempo. | `[]` |
| 2 | Clean full curl with controlled tempo. | `[]` |
| 3 | Clean full curl with controlled tempo. | `[]` |
| 4 | Clean full curl with controlled tempo. | `[]` |
| 5 | Clean full curl with controlled tempo. | `[]` |

### train04-clean-front-d

Setup: `split=train`, `view=front`, `scorable=true`, 5 reps. Slightly heavier but still clean; no body swing.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with stable shoulders and torso. | `[]` |
| 2 | Clean full curl with stable shoulders and torso. | `[]` |
| 3 | Clean full curl with stable shoulders and torso. | `[]` |
| 4 | Clean full curl with stable shoulders and torso. | `[]` |
| 5 | Clean full curl with stable shoulders and torso. | `[]` |

### train05-focus-flex-a

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Isolate top-short curls; keep bottom extension and torso clean.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 3 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 4 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 5 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 6 | Clean full curl. | `[]` |

### train06-focus-flex-b

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Repeat top-short curls with another subject/session or grip width.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 3 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 4 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 5 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 6 | Clean full curl. | `[]` |

### train07-focus-extend-a

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Isolate bottom-short curls; fully curl at the top.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 3 | Mildly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 4 | Clearly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 5 | Clearly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 6 | Clean full curl. | `[]` |

### train08-focus-extend-b

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Repeat bottom-short curls with another subject/session.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 3 | Mildly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 4 | Clearly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 5 | Clearly avoid full elbow extension at the bottom. | `barbell-curl.incomplete_extend` |
| 6 | Clean full curl. | `[]` |

### train09-focus-rom

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Isolate short half-curls where both top and bottom are incomplete.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild short half-curl: slightly short at both top and bottom. | `barbell-curl.incomplete_rom` |
| 3 | Mild short half-curl: slightly short at both top and bottom. | `barbell-curl.incomplete_rom` |
| 4 | Clear short half-curl: obvious short range at both top and bottom. | `barbell-curl.incomplete_rom` |
| 5 | Clear short half-curl: obvious short range at both top and bottom. | `barbell-curl.incomplete_rom` |
| 6 | Clean full curl. | `[]` |

### train10-focus-shoulder-warn

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Mild upper-arm drift only; avoid torso swing.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly let the elbows/upper arms drift forward. | `barbell-curl.shoulder_warn` |
| 3 | Mildly let the elbows/upper arms drift forward. | `barbell-curl.shoulder_warn` |
| 4 | Clear but not extreme upper-arm drift. | `barbell-curl.shoulder_warn` |
| 5 | Clear but not extreme upper-arm drift. | `barbell-curl.shoulder_warn` |
| 6 | Clean full curl. | `[]` |

### train11-focus-shoulder-fail-a

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Obvious shoulder heave; keep torso otherwise stable.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild shoulder heave or upper-arm swing. | `barbell-curl.shoulder_fail` |
| 3 | Mild shoulder heave or upper-arm swing. | `barbell-curl.shoulder_fail` |
| 4 | Clear shoulder heave to help lift the bar. | `barbell-curl.shoulder_fail` |
| 5 | Clear shoulder heave to help lift the bar. | `barbell-curl.shoulder_fail` |
| 6 | Clean full curl. | `[]` |

### train12-focus-shoulder-fail-b

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Repeat shoulder heave with another subject/session.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild shoulder heave or upper-arm swing. | `barbell-curl.shoulder_fail` |
| 3 | Mild shoulder heave or upper-arm swing. | `barbell-curl.shoulder_fail` |
| 4 | Clear shoulder heave to help lift the bar. | `barbell-curl.shoulder_fail` |
| 5 | Clear shoulder heave to help lift the bar. | `barbell-curl.shoulder_fail` |
| 6 | Clean full curl. | `[]` |

### train13-focus-torso-warn

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Mild torso swing; avoid shoulder heave.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild torso swing or lean-back, still controlled. | `barbell-curl.torso_warn` |
| 3 | Mild torso swing or lean-back, still controlled. | `barbell-curl.torso_warn` |
| 4 | Clear but not extreme torso swing. | `barbell-curl.torso_warn` |
| 5 | Clear but not extreme torso swing. | `barbell-curl.torso_warn` |
| 6 | Clean full curl. | `[]` |

### train14-focus-torso-fail-a

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Clear body swing or lean-back cheat.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild but obvious body swing to start the curl. | `barbell-curl.torso_fail` |
| 3 | Mild but obvious body swing to start the curl. | `barbell-curl.torso_fail` |
| 4 | Clear strong lean-back or body swing to lift the bar. | `barbell-curl.torso_fail` |
| 5 | Clear strong lean-back or body swing to lift the bar. | `barbell-curl.torso_fail` |
| 6 | Clean full curl. | `[]` |

### train15-focus-torso-fail-b

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Repeat clear body swing with another subject/session.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild but obvious body swing to start the curl. | `barbell-curl.torso_fail` |
| 3 | Mild but obvious body swing to start the curl. | `barbell-curl.torso_fail` |
| 4 | Clear strong lean-back or body swing to lift the bar. | `barbell-curl.torso_fail` |
| 5 | Clear strong lean-back or body swing to lift the bar. | `barbell-curl.torso_fail` |
| 6 | Clean full curl. | `[]` |

### train16-focus-elbow-flare-a

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Elbows flare outward in the frontal plane; keep both arms visible.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly let both elbows flare outward. | `barbell-curl.elbow_flare` |
| 3 | Mildly let both elbows flare outward. | `barbell-curl.elbow_flare` |
| 4 | Clearly flare elbows outward through the curl. | `barbell-curl.elbow_flare` |
| 5 | Clearly flare elbows outward through the curl. | `barbell-curl.elbow_flare` |
| 6 | Clean full curl. | `[]` |

### train17-focus-elbow-flare-b

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Repeat elbow flare with another subject/session.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly let both elbows flare outward. | `barbell-curl.elbow_flare` |
| 3 | Mildly let both elbows flare outward. | `barbell-curl.elbow_flare` |
| 4 | Clearly flare elbows outward through the curl. | `barbell-curl.elbow_flare` |
| 5 | Clearly flare elbows outward through the curl. | `barbell-curl.elbow_flare` |
| 6 | Clean full curl. | `[]` |

### train18-focus-tempo-up

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Curl upward too quickly; lower under control.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with normal tempo. | `[]` |
| 2 | Mildly rush the upward curl. | `barbell-curl.tempo_up` |
| 3 | Mildly rush the upward curl. | `barbell-curl.tempo_up` |
| 4 | Clearly curl upward too fast. | `barbell-curl.tempo_up` |
| 5 | Clearly curl upward too fast. | `barbell-curl.tempo_up` |
| 6 | Clean full curl with normal tempo. | `[]` |

### train19-focus-tempo-down

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Lower too quickly; curl up under control.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with normal tempo. | `[]` |
| 2 | Mildly rush the lowering phase. | `barbell-curl.tempo_down` |
| 3 | Mildly rush the lowering phase. | `barbell-curl.tempo_down` |
| 4 | Clearly drop the bar too fast on the way down. | `barbell-curl.tempo_down` |
| 5 | Clearly drop the bar too fast on the way down. | `barbell-curl.tempo_down` |
| 6 | Clean full curl with normal tempo. | `[]` |

### train20-focus-asymmetry-a

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. One arm lags, one side curls less, or the bar tilts.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with both arms even. | `[]` |
| 2 | Mild left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 3 | Mild left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 4 | Clear left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 5 | Clear left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 6 | Clean full curl with both arms even. | `[]` |

### train21-focus-asymmetry-b

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Repeat asymmetry with another subject/session.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with both arms even. | `[]` |
| 2 | Mild left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 3 | Mild left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 4 | Clear left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 5 | Clear left/right mismatch in timing, height, or ROM. | `barbell-curl.asymmetry` |
| 6 | Clean full curl with both arms even. | `[]` |

### train22-multi-rom-tempo

Setup: `split=train`, `view=front`, `scorable=true`, 10 reps. Endpoint and ROM mixture.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 3 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 4 | Mildly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 5 | Clearly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 6 | Mild short half-curl. | `barbell-curl.incomplete_rom` |
| 7 | Clear short half-curl. | `barbell-curl.incomplete_rom` |
| 8 | Mildly rush the lowering phase. | `barbell-curl.tempo_down` |
| 9 | Clearly drop the bar too fast. | `barbell-curl.tempo_down` |
| 10 | Clean full curl. | `[]` |

### train23-multi-body

Setup: `split=train`, `view=front`, `scorable=true`, 10 reps. Body-cheat severity ladder.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild upper-arm drift. | `barbell-curl.shoulder_warn` |
| 3 | Clear upper-arm drift that is still not a full shoulder heave. | `barbell-curl.shoulder_warn` |
| 4 | Mild shoulder heave. | `barbell-curl.shoulder_fail` |
| 5 | Clear shoulder heave. | `barbell-curl.shoulder_fail` |
| 6 | Mild torso swing. | `barbell-curl.torso_warn` |
| 7 | Clear but not extreme torso swing. | `barbell-curl.torso_warn` |
| 8 | Mild but obvious body swing. | `barbell-curl.torso_fail` |
| 9 | Clear strong body swing or lean-back cheat. | `barbell-curl.torso_fail` |
| 10 | Clean full curl. | `[]` |

### train24-multi-bilateral-tempo

Setup: `split=train`, `view=front`, `scorable=true`, 10 reps. Bilateral/front-only issues plus tempo.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild left/right arm mismatch. | `barbell-curl.asymmetry` |
| 3 | Clear left/right arm mismatch. | `barbell-curl.asymmetry` |
| 4 | Mild elbow flare outward. | `barbell-curl.elbow_flare` |
| 5 | Clear elbow flare outward. | `barbell-curl.elbow_flare` |
| 6 | Mildly rush the upward curl. | `barbell-curl.tempo_up` |
| 7 | Clearly curl upward too fast. | `barbell-curl.tempo_up` |
| 8 | Mildly rush the lowering phase. | `barbell-curl.tempo_down` |
| 9 | Clearly drop the bar too fast. | `barbell-curl.tempo_down` |
| 10 | Clean full curl. | `[]` |

### train25-multi-hard-issues

Setup: `split=train`, `view=front`, `scorable=true`, 10 reps. Harder issue mix for feature separation.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild short half-curl. | `barbell-curl.incomplete_rom` |
| 3 | Clear short half-curl. | `barbell-curl.incomplete_rom` |
| 4 | Mild shoulder heave. | `barbell-curl.shoulder_fail` |
| 5 | Clear shoulder heave. | `barbell-curl.shoulder_fail` |
| 6 | Mild but obvious body swing. | `barbell-curl.torso_fail` |
| 7 | Clear strong body swing or lean-back cheat. | `barbell-curl.torso_fail` |
| 8 | Mild left/right arm mismatch. | `barbell-curl.asymmetry` |
| 9 | Clear left/right arm mismatch. | `barbell-curl.asymmetry` |
| 10 | Clean full curl. | `[]` |

### train26-hard-negative-front

Setup: `split=train`, `view=front`, `scorable=true`, 6 reps. Acceptable near-threshold reps; do not over-label.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean curl with slight natural torso movement, still acceptable. | `[]` |
| 2 | Clean curl with natural shoulder movement, not a fault. | `[]` |
| 3 | Clean curl with brisk but controlled tempo. | `[]` |
| 4 | Clean curl reaching near-full but acceptable top ROM. | `[]` |
| 5 | Clean curl reaching near-full but acceptable bottom extension. | `[]` |
| 6 | Clean curl with normal form. | `[]` |

### train27-combined-realistic

Setup: `split=train`, `view=front`, `scorable=true`, 8 reps. Realistic co-occurring faults.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Short half-curl and drop the bar too fast. | `barbell-curl.incomplete_rom`, `barbell-curl.tempo_down` |
| 3 | Shoulder heave plus mild torso swing. | `barbell-curl.shoulder_fail`, `barbell-curl.torso_warn` |
| 4 | Strong torso swing plus fast upward curl. | `barbell-curl.torso_fail`, `barbell-curl.tempo_up` |
| 5 | Left/right mismatch plus incomplete bottom extension. | `barbell-curl.asymmetry`, `barbell-curl.incomplete_extend` |
| 6 | Elbows flare outward plus mild shoulder drift. | `barbell-curl.elbow_flare`, `barbell-curl.shoulder_warn` |
| 7 | Stop short at the top plus mild torso swing. | `barbell-curl.incomplete_flex`, `barbell-curl.torso_warn` |
| 8 | Clean full curl. | `[]` |

### train28-partial-side

Setup: `split=train`, `view=side` or `view=oblique`, `scorable=true` partial, 5 reps. Visible arm only. Do not label asymmetry or elbow flare.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean visible-arm curl. | `[]` |
| 2 | Visible arm stops short at the top. | `barbell-curl.incomplete_flex` |
| 3 | Visible arm does not fully extend at the bottom. | `barbell-curl.incomplete_extend` |
| 4 | Visible shoulder drift plus visible torso swing. | `barbell-curl.shoulder_warn`, `barbell-curl.torso_warn` |
| 5 | Visible arm curls up too fast and lowers too fast. | `barbell-curl.tempo_up`, `barbell-curl.tempo_down` |

### train29-unscorable-occluded

Setup: `split=train`, unsupported or occluded view, `scorable=false`, 3 reps. Count reps if visible, but do not label form issues.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Curl with arms or torso partly hidden. | `[]`; `scorable=false` |
| 2 | Curl with arms or torso partly hidden. | `[]`; `scorable=false` |
| 3 | Curl with arms or torso partly hidden. | `[]`; `scorable=false` |

### train30-unscorable-bad-setup

Setup: `split=train`, unsupported or poor angle, `scorable=false`, 3 reps. Too close, unstable, or insufficient landmark confidence.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Curl from bad setup or unreliable tracking. | `[]`; `scorable=false` |
| 2 | Curl from bad setup or unreliable tracking. | `[]`; `scorable=false` |
| 3 | Curl from bad setup or unreliable tracking. | `[]`; `scorable=false` |

## Validation Recordings

### val01-clean-front

Setup: `split=validation`, `view=front`, `scorable=true`, 5 reps. Independent session/person from train.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Clean full curl. | `[]` |
| 3 | Clean full curl. | `[]` |
| 4 | Clean full curl. | `[]` |
| 5 | Clean full curl. | `[]` |

### val02-focus-rom

Setup: `split=validation`, `view=front`, `scorable=true`, 6 reps. Validation ROM aggregate cue.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild short half-curl. | `barbell-curl.incomplete_rom` |
| 3 | Mild short half-curl. | `barbell-curl.incomplete_rom` |
| 4 | Clear short half-curl. | `barbell-curl.incomplete_rom` |
| 5 | Clear short half-curl. | `barbell-curl.incomplete_rom` |
| 6 | Clean full curl. | `[]` |

### val03-focus-elbow-flare

Setup: `split=validation`, `view=front`, `scorable=true`, 6 reps. Validation front-only elbow cue.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly flare elbows outward. | `barbell-curl.elbow_flare` |
| 3 | Mildly flare elbows outward. | `barbell-curl.elbow_flare` |
| 4 | Clearly flare elbows outward. | `barbell-curl.elbow_flare` |
| 5 | Clearly flare elbows outward. | `barbell-curl.elbow_flare` |
| 6 | Clean full curl. | `[]` |

### val04-focus-tempo-up

Setup: `split=validation`, `view=front`, `scorable=true`, 6 reps. Validation fast curl cue.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with normal tempo. | `[]` |
| 2 | Mildly rush the upward curl. | `barbell-curl.tempo_up` |
| 3 | Mildly rush the upward curl. | `barbell-curl.tempo_up` |
| 4 | Clearly curl upward too fast. | `barbell-curl.tempo_up` |
| 5 | Clearly curl upward too fast. | `barbell-curl.tempo_up` |
| 6 | Clean full curl with normal tempo. | `[]` |

### val05-focus-asymmetry

Setup: `split=validation`, `view=front`, `scorable=true`, 6 reps. Validation front-only bilateral cue.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl with both arms even. | `[]` |
| 2 | Mild left/right arm mismatch. | `barbell-curl.asymmetry` |
| 3 | Mild left/right arm mismatch. | `barbell-curl.asymmetry` |
| 4 | Clear left/right arm mismatch. | `barbell-curl.asymmetry` |
| 5 | Clear left/right arm mismatch. | `barbell-curl.asymmetry` |
| 6 | Clean full curl with both arms even. | `[]` |

### val06-multi-rom-tempo

Setup: `split=validation`, `view=front`, `scorable=true`, 10 reps. Endpoint and eccentric validation.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 3 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 4 | Mildly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 5 | Clearly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 6 | Mild short half-curl. | `barbell-curl.incomplete_rom` |
| 7 | Clear short half-curl. | `barbell-curl.incomplete_rom` |
| 8 | Mildly rush the lowering phase. | `barbell-curl.tempo_down` |
| 9 | Clearly drop the bar too fast. | `barbell-curl.tempo_down` |
| 10 | Clean full curl. | `[]` |

### val07-multi-body

Setup: `split=validation`, `view=front`, `scorable=true`, 10 reps. Body-cheat validation.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild upper-arm drift. | `barbell-curl.shoulder_warn` |
| 3 | Clear upper-arm drift that is still not a full shoulder heave. | `barbell-curl.shoulder_warn` |
| 4 | Mild shoulder heave. | `barbell-curl.shoulder_fail` |
| 5 | Clear shoulder heave. | `barbell-curl.shoulder_fail` |
| 6 | Mild torso swing. | `barbell-curl.torso_warn` |
| 7 | Clear but not extreme torso swing. | `barbell-curl.torso_warn` |
| 8 | Mild but obvious body swing. | `barbell-curl.torso_fail` |
| 9 | Clear strong body swing or lean-back cheat. | `barbell-curl.torso_fail` |
| 10 | Clean full curl. | `[]` |

### val08-hard-negative-front

Setup: `split=validation`, `view=front`, `scorable=true`, 6 reps. Independent clean near-threshold negatives.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean curl with slight natural torso movement, still acceptable. | `[]` |
| 2 | Clean curl with natural shoulder movement, not a fault. | `[]` |
| 3 | Clean curl with brisk but controlled tempo. | `[]` |
| 4 | Clean curl reaching near-full but acceptable top ROM. | `[]` |
| 5 | Clean curl reaching near-full but acceptable bottom extension. | `[]` |
| 6 | Clean curl with normal form. | `[]` |

### val09-partial-oblique

Setup: `split=validation`, `view=side` or `view=oblique`, `scorable=true` partial, 5 reps. Partial-view validation. Do not label asymmetry or elbow flare.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean visible-arm curl. | `[]` |
| 2 | Visible arm performs a short half-curl. | `barbell-curl.incomplete_rom` |
| 3 | Visible shoulder heaves to help lift. | `barbell-curl.shoulder_fail` |
| 4 | Visible torso swing or lean-back cheat. | `barbell-curl.torso_fail` |
| 5 | Visible arm curls up too fast and lowers too fast. | `barbell-curl.tempo_up`, `barbell-curl.tempo_down` |

### val10-unscorable-quality

Setup: `split=validation`, unknown or poor-quality view, `scorable=false`, 3 reps. Poor lighting, wrists hidden, or landmark dropouts.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Curl from poor-quality capture. | `[]`; `scorable=false` |
| 2 | Curl from poor-quality capture. | `[]`; `scorable=false` |
| 3 | Curl from poor-quality capture. | `[]`; `scorable=false` |

## Test Recordings

### test01-clean-front

Setup: `split=test`, `view=front`, `scorable=true`, 5 reps. Held-out clean baseline.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Clean full curl. | `[]` |
| 3 | Clean full curl. | `[]` |
| 4 | Clean full curl. | `[]` |
| 5 | Clean full curl. | `[]` |

### test02-focus-flex

Setup: `split=test`, `view=front`, `scorable=true`, 6 reps. Held-out top-short issue.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 3 | Mildly stop short at the top. | `barbell-curl.incomplete_flex` |
| 4 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 5 | Clearly stop short at the top. | `barbell-curl.incomplete_flex` |
| 6 | Clean full curl. | `[]` |

### test03-focus-extend

Setup: `split=test`, `view=front`, `scorable=true`, 6 reps. Held-out bottom-short issue.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 3 | Mildly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 4 | Clearly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 5 | Clearly avoid full extension at the bottom. | `barbell-curl.incomplete_extend` |
| 6 | Clean full curl. | `[]` |

### test04-focus-shoulder-warn

Setup: `split=test`, `view=front`, `scorable=true`, 6 reps. Held-out mild shoulder involvement.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mildly let the elbows/upper arms drift forward. | `barbell-curl.shoulder_warn` |
| 3 | Mildly let the elbows/upper arms drift forward. | `barbell-curl.shoulder_warn` |
| 4 | Clear but not extreme upper-arm drift. | `barbell-curl.shoulder_warn` |
| 5 | Clear but not extreme upper-arm drift. | `barbell-curl.shoulder_warn` |
| 6 | Clean full curl. | `[]` |

### test05-focus-torso-warn

Setup: `split=test`, `view=front`, `scorable=true`, 6 reps. Held-out mild torso swing.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild torso swing or lean-back, still controlled. | `barbell-curl.torso_warn` |
| 3 | Mild torso swing or lean-back, still controlled. | `barbell-curl.torso_warn` |
| 4 | Clear but not extreme torso swing. | `barbell-curl.torso_warn` |
| 5 | Clear but not extreme torso swing. | `barbell-curl.torso_warn` |
| 6 | Clean full curl. | `[]` |

### test06-multi-bilateral-tempo

Setup: `split=test`, `view=front`, `scorable=true`, 10 reps. Held-out front-only plus tempo mix.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild left/right arm mismatch. | `barbell-curl.asymmetry` |
| 3 | Clear left/right arm mismatch. | `barbell-curl.asymmetry` |
| 4 | Mild elbow flare outward. | `barbell-curl.elbow_flare` |
| 5 | Clear elbow flare outward. | `barbell-curl.elbow_flare` |
| 6 | Mildly rush the upward curl. | `barbell-curl.tempo_up` |
| 7 | Clearly curl upward too fast. | `barbell-curl.tempo_up` |
| 8 | Mildly rush the lowering phase. | `barbell-curl.tempo_down` |
| 9 | Clearly drop the bar too fast. | `barbell-curl.tempo_down` |
| 10 | Clean full curl. | `[]` |

### test07-multi-hard-issues

Setup: `split=test`, `view=front`, `scorable=true`, 10 reps. Held-out hard issue mix.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Mild short half-curl. | `barbell-curl.incomplete_rom` |
| 3 | Clear short half-curl. | `barbell-curl.incomplete_rom` |
| 4 | Mild shoulder heave. | `barbell-curl.shoulder_fail` |
| 5 | Clear shoulder heave. | `barbell-curl.shoulder_fail` |
| 6 | Mild but obvious body swing. | `barbell-curl.torso_fail` |
| 7 | Clear strong body swing or lean-back cheat. | `barbell-curl.torso_fail` |
| 8 | Mild left/right arm mismatch. | `barbell-curl.asymmetry` |
| 9 | Clear left/right arm mismatch. | `barbell-curl.asymmetry` |
| 10 | Clean full curl. | `[]` |

### test08-hard-negative-front

Setup: `split=test`, `view=front`, `scorable=true`, 6 reps. Held-out clean near-threshold negatives.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean curl with slight natural torso movement, still acceptable. | `[]` |
| 2 | Clean curl with natural shoulder movement, not a fault. | `[]` |
| 3 | Clean curl with brisk but controlled tempo. | `[]` |
| 4 | Clean curl reaching near-full but acceptable top ROM. | `[]` |
| 5 | Clean curl reaching near-full but acceptable bottom extension. | `[]` |
| 6 | Clean curl with normal form. | `[]` |

### test09-combined-realistic

Setup: `split=test`, `view=front`, `scorable=true`, 8 reps. Held-out realistic co-occurring faults.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Clean full curl. | `[]` |
| 2 | Short half-curl and drop the bar too fast. | `barbell-curl.incomplete_rom`, `barbell-curl.tempo_down` |
| 3 | Shoulder heave plus mild torso swing. | `barbell-curl.shoulder_fail`, `barbell-curl.torso_warn` |
| 4 | Strong torso swing plus fast upward curl. | `barbell-curl.torso_fail`, `barbell-curl.tempo_up` |
| 5 | Left/right mismatch plus incomplete bottom extension. | `barbell-curl.asymmetry`, `barbell-curl.incomplete_extend` |
| 6 | Elbows flare outward plus mild shoulder drift. | `barbell-curl.elbow_flare`, `barbell-curl.shoulder_warn` |
| 7 | Stop short at the top plus mild torso swing. | `barbell-curl.incomplete_flex`, `barbell-curl.torso_warn` |
| 8 | Clean full curl. | `[]` |

### test10-unscorable-setup

Setup: `split=test`, unknown or poor-quality view, `scorable=false`, 3 reps. Camera too close, moving, or keypoints unreliable.

| Rep | Perform | Label |
| ---: | --- | --- |
| 1 | Curl from poor setup or unreliable tracking. | `[]`; `scorable=false` |
| 2 | Curl from poor setup or unreliable tracking. | `[]`; `scorable=false` |
| 3 | Curl from poor setup or unreliable tracking. | `[]`; `scorable=false` |

## Review Checklist

Before a recording counts toward this plan:

- Label file is marked `reviewStatus: "reviewed"`.
- `expectedReps` equals `reps.length`.
- Each rep has accurate `startMs` and `endMs`.
- Each rep has explicit `view` and `scorable`.
- Clean and hard-negative reps have `issueIds: []`.
- Unscorable reps have `scorable=false` and `issueIds: []`.
- Side/oblique partial clips do not include `barbell-curl.asymmetry` or `barbell-curl.elbow_flare`.
- Multi-issue and combined-fault reps include every true visible issue ID, not just the most obvious one.
