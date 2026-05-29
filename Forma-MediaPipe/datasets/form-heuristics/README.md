# Form Heuristics Replay Dataset

Desktop workflow for improving the app's deterministic exercise heuristics with
prerecorded videos, generated MediaPipe landmarks, replay output, and
human-reviewed per-rep labels.

This pipeline tunes threshold/config JSON for existing heuristics. It does not
train model weights. Replay feeds each landmark frame through the same
`ExerciseDefinition.update()` implementation used by live workouts, so dataset
evaluation is the offline version of the app's real analysis path.

The reviewer policy lives in
`src/utils/exercises/dataset/labelPolicy.ts`. It is the source of truth for
scorable views, labelable issue IDs, non-ground-truth diagnostics, and reviewer
guidance.

## Current Scope

There are 10 registered exercises and 10 matching label templates:

| Exercise | Scorable reviewed view | Labelling notes |
| --- | --- | --- |
| Barbell Curl | `front`, plus partial `side`/`oblique` | Front is full scoring. Side/oblique may label only visible-arm ROM, shoulder involvement, torso swing, and tempo. Do not label asymmetry or elbow flare from side/oblique. |
| Push-Up | `side` | Camera/setup diagnostics are not reviewed form issue labels. |
| Barbell Squat | `side` | Runtime keeps `requiredView: "any"` for compatibility, but reviewed dataset scoring is side-view only. |
| Standing Dumbbell Lateral Raises | `front` | Side, oblique, or unknown views can count reps but should be `scorable=false`. |
| Cable Row | `side` | Side-view full-form scoring target. |
| Cable Lat Pulldowns | `side` | Usable side-diagonal captures should be labelled `view="side"` for v1. |
| Cable Pushdowns | `side` | Side-view full-form scoring target. |
| Leg Extensions | `side` | Side-view full-form scoring target. |
| Lying Leg Curl | `side` | `lying-leg-curl.side_view_uncertain` is a runtime/replay diagnostic, not ground truth. |
| Machine Ab Crunches | `side` | `machine-ab-crunches.side_view_uncertain` is a runtime/replay diagnostic, not ground truth. |

Consistent reviewer rule: count reps consistently, always label reviewed reps
with `view` and `scorable`, and only add form `issueIds` when that rep is
judgeable under the exercise's supported scoring view.

## Folder Layout

- `videos/<split-folder>/<exercise-slug>/` raw source videos. Ignored by Git.
- `landmarks/<split-folder>/<exercise-slug>/` generated MediaPipe landmark JSON. Ignored by Git.
- `labels/<split-folder>/<exercise-slug>/` reviewed label JSON files.
- `labels/templates/` exercise label templates named `<exercise-slug>.template.json`.
- `reports/` generated evaluation/optimization reports. Ignored by Git.
- `candidates/` optional local scratch space. Ignored by Git.

Each template has the exact exercise name, policy-generated guidance, and the
allowed ground-truth form issue IDs for that exercise.

The split folder names are:

- `training` for label split value `"train"`
- `validation` for label split value `"validation"`
- `testing` for label split value `"test"`

## One-Time Setup

Install the Python dependencies used by video landmark extraction:

```sh
python3 -m pip install -r scripts/requirements-dataset.txt
```

## Recording Videos

Use short, single-exercise clips with a small buffer before the first rep and
after the last rep. Most clips should be 5-6 reps; mixed clips can be 8-10 reps
so one recording can cover multiple issue IDs without making you film one clip
per fault.

For reliable product work, use
`datasets/form-heuristics/recording-plan.reliable-v1.json` as the source of
truth. Existing clips count only when their label is reviewed, has correct
`view`/`scorable` values, has matching landmark JSON, and has visible issue
labels. The current Barbell Curl labels in this repo are `draft`, so they do
not count until reviewed.

The first fully expanded exercise protocol is
`datasets/form-heuristics/barbell-curl-reliable-v1-recordings.md`, which lays
out all 50 Barbell Curl recordings rep by rep.

### Reliable Product Target

The reliable-v1 target is **50 reviewed recordings per exercise**: 30 train, 10
validation, and 10 test. Across the 10 registered exercises this is **500
recordings** and roughly **3,160+ reviewed reps**.

For exercises without a detailed per-recording protocol yet, collect this default
shape:

| Recording type | Train | Validation | Test | Total | Reps each | Purpose |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Clean baseline | 5 | 1 | 2 | 8 | 5 | Clean negatives with normal technique. |
| Issue-focus | 16 | 4 | 2 | 22 | 6 | One target issue per clip, mild and clear examples. |
| Multi-issue | 4 | 2 | 2 | 8 | 10 | Four issue IDs per clip, two reps each. |
| Hard-negative clean | 3 | 1 | 2 | 6 | 6 | Near-threshold but acceptable reps to reduce false positives. |
| Combined realistic faults | 1 | 0 | 1 | 2 | 8 | Realistic two-issue reps. |
| View/quality robustness | 1 | 2 | 1 | 4 | 3 | Unsupported view, occlusion, or poor setup; `scorable=false`. |

The Barbell Curl detailed protocol uses a stronger issue-focused distribution
than the default shape: 17 train issue-focus clips, 4 validation issue-focus
clips, 4 test issue-focus clips, 2 partial side/oblique clips, and 4 unscorable
clips.

Use the audit command to check collection progress:

```sh
npm run dataset:recording-plan
```

Generate a filming checklist CSV when coordinating recordings:

```sh
npm run --silent dataset:recording-plan -- --checklist > reliable-v1-checklist.csv
```

The audit requires every exercise to reach 50 reviewed recordings, every split
target, at least 316 reviewed reps, at least 40 clean scorable reps, at least 12
unscorable/view-quality reps, and positive examples for every planned issue in
train, validation, and test.

### Why these counts

Replay does not train a neural network. It extracts MediaPipe landmarks from
video, feeds those landmarks through the same `ExerciseDefinition.update()` code
used in live workouts, and compares the replayed per-rep predictions with
reviewed label JSON.

The optimizer uses:

- `train` clips to discover candidate FSM and feedback thresholds.
- `validation` clips to select the winning threshold config.
- `test` clips only for held-out regression checks.
- per-rep diagnostics to tune individual issue thresholds. For a threshold to
  be safely changed, the diagnostic path needs both positive reps with that
  issue and negative reps without that issue. Aim for at least 2 positive
  reps per issue in both `train` and `validation`.
- optional `expectedScoreRange` labels for score calibration. If no score
  ranges are reviewed, score-only tunables are skipped and the optimizer focuses
  on rep count, issue IDs, view, and scorable gating.

This is why the plan uses clean clips, issue-focus clips, grouped issue clips,
hard negatives, combined faults, and unsupported-view clips instead of many
random sets.

### Global capture rules

- Film train, validation, and test independently. Do not split one take into
  multiple splits.
- Keep the camera fixed for a clip; do not pan, zoom, or switch sides mid-set.
- Use the listed scorable view for form clips. Unsupported-view clips are for
  rep-count/view/scorable robustness only.
- Keep form-critical joints visible for the whole rep. For side-view exercises,
  the same-side shoulder/hip/knee/ankle or wrist should remain visible.
- Keep reps deliberate. For issue clips, isolate the requested issue unless the
  line explicitly asks for a combined fault.
- Label only what is visible. If the view does not support a cue, use
  `scorable=false` and `issueIds: []`.
- Do not label non-ground-truth diagnostics as form faults:
  `push-up.camera_setup`, `lying-leg-curl.side_view_uncertain`, and
  `machine-ab-crunches.side_view_uncertain`.

### Compact v1 Target Counts

The compact target below is retained for quick smoke testing and early threshold
tuning only. It is not the reliable-product collection target.

| Exercise | Train | Validation | Test | Total recordings | Scorable form view |
| --- | ---: | ---: | ---: | ---: | --- |
| Barbell Curl | 6 | 5 | 3 | 14 | front full scoring; side/oblique partial only |
| Push-Up | 5 | 4 | 2 | 11 | side |
| Barbell Squat | 5 | 4 | 2 | 11 | side |
| Standing Dumbbell Lateral Raises | 5 | 4 | 2 | 11 | front |
| Cable Row | 5 | 4 | 2 | 11 | side |
| Cable Lat Pulldowns | 5 | 4 | 2 | 11 | side or usable side-diagonal |
| Cable Pushdowns | 5 | 4 | 2 | 11 | side |
| Leg Extensions | 5 | 4 | 2 | 11 | side |
| Lying Leg Curl | 5 | 4 | 2 | 11 | side |
| Machine Ab Crunches | 5 | 4 | 2 | 11 | side |

Compact target: 113 recordings. Use it only when you need a small smoke/tuning
set before committing to reliable-v1 collection.

### Barbell Curl

Primary heuristic signals: curl top/bottom ROM, total ROM, shoulder movement,
torso swing, left/right asymmetry or sync, elbow flare, and concentric/eccentric
tempo. Front view is required for full scoring. Side/oblique clips may label
only visible-arm ROM, shoulder involvement, torso swing, and tempo.

- `train01-clean-front`: front, 5 reps, all clean.
- `train02-rom-front`: front, 8 reps. Reps 1 and 8 clean; reps 2-3 stop short at the top (`barbell-curl.incomplete_flex`); reps 4-5 do not fully extend at the bottom (`barbell-curl.incomplete_extend`); reps 6-7 are short half-curls (`barbell-curl.incomplete_rom`).
- `train03-shoulder-torso-front`: front, 10 reps. Rep 1 clean; reps 2-3 mild upper-arm drift (`barbell-curl.shoulder_warn`); reps 4-5 obvious shoulder heave (`barbell-curl.shoulder_fail`); reps 6-7 mild torso swing (`barbell-curl.torso_warn`); reps 8-9 obvious body swing (`barbell-curl.torso_fail`); rep 10 clean.
- `train04-symmetry-elbow-front`: front, 7 reps. Rep 1 clean; reps 2-5 uneven height, one arm lagging, or one arm doing less ROM (`barbell-curl.asymmetry`); reps 6-7 elbows flare outward (`barbell-curl.elbow_flare`).
- `train05-tempo-front`: front, 6 reps. Reps 1 and 6 clean; reps 2-3 curl up too fast (`barbell-curl.tempo_up`); reps 4-5 drop the bar down too fast (`barbell-curl.tempo_down`).
- `train06-side-oblique-partial`: side or oblique, 5 reps. Rep 1 clean visible-arm curl; rep 2 top-short visible arm; rep 3 bottom-short visible arm; rep 4 torso swing; rep 5 fast tempo. Do not label asymmetry or elbow flare from this clip.
- `val01-clean-front`: front, 5 clean reps, different session/person/camera distance from train.
- `val02-rom-front`: front, 8 reps, same issue pattern as `train02`.
- `val03-shoulder-torso-front`: front, 10 reps, same issue pattern as `train03`.
- `val04-symmetry-elbow-tempo-front`: front, 10 reps. Rep 1 clean; reps 2-3 asymmetry; reps 4-5 elbow flare; reps 6-7 fast curl up; reps 8-9 fast lowering; rep 10 clean.
- `val05-side-oblique-partial`: side or oblique, 5 reps, same visible-arm partial-label pattern as `train06`.
- `test01-clean-front`: front, 5 clean reps.
- `test02-mixed-rom-body-front`: front, 8 reps. Include one clean rep, then one each of top-short, bottom-short, half-curl, shoulder warn, shoulder fail, torso warn, torso fail.
- `test03-mixed-symmetry-tempo-front`: front, 8 reps. Reps 1 and 8 clean; reps 2-3 asymmetry; reps 4-5 elbow flare; rep 6 fast curl up; rep 7 fast lowering.

### Push-Up

Primary heuristic signals: side-view elbow depth, top lockout, total ROM, hip
sag, hip pike, head/neck alignment, shoulder-over-wrist setup, and tempo.
`push-up.camera_setup` is a runtime setup diagnostic, not a labelable form
fault.

- `train01-clean-side`: side, 5 clean reps, full body visible.
- `train02-rom-side`: side, 8 reps. Reps 1 and 8 clean; reps 2-3 shallow depth (`push-up.depth_short`); reps 4-5 no full lockout (`push-up.lockout_short`); reps 6-7 short half-reps (`push-up.incomplete_rom`).
- `train03-body-side`: side, 10 reps. Rep 1 clean; reps 2-3 hip sag; reps 4-5 hip pike; reps 6-7 head not neutral; reps 8-9 shoulders set too far from wrists; rep 10 clean.
- `train04-tempo-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 push up too fast; reps 4-5 drop into the descent too fast.
- `train05-view-frontish`: front/oblique or deliberately poor side setup, 3 reps. Keep it safe, count reps if visible, label `scorable=false` and no issues.
- `val01-clean-side`: side, 5 clean reps.
- `val02-rom-tempo-side`: side, 12 reps. Reps 1 and 12 clean; two reps each for depth short, lockout short, incomplete ROM, fast push, and fast descent.
- `val03-body-side`: side, 10 reps, same issue pattern as `train03`.
- `val04-view-frontish`: front/oblique, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 10 reps. Rep 1 clean; rep 2 depth short; rep 3 lockout short; rep 4 incomplete ROM; rep 5 hip sag; rep 6 hip pike; rep 7 head position; rep 8 shoulder stack; rep 9 fast push; rep 10 fast descent.

### Barbell Squat

Primary heuristic signals: side-view depth, top lockout, total ROM, torso lean
warn/fail, heel lift, and ascent/descent tempo. Runtime still allows any view,
but reviewed form scoring is side-view only.

- `train01-clean-side`: side, 5 clean reps, full body and both feet visible.
- `train02-rom-side`: side, 8 reps. Reps 1 and 8 clean; reps 2-3 squat high (`barbell-squat.depth_short`); reps 4-5 do not fully stand tall (`barbell-squat.lockout_short`); reps 6-7 short partial ROM (`barbell-squat.incomplete_rom`).
- `train03-torso-heel-side`: side, 8 reps. Rep 1 clean; reps 2-3 mild forward lean (`barbell-squat.torso_warn`); reps 4-5 excessive forward lean (`barbell-squat.torso_fail`); reps 6-7 heels lift; rep 8 clean.
- `train04-tempo-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 bounce/stand up too fast; reps 4-5 descend too fast.
- `train05-view-front-oblique`: front or oblique, 3 reps, `scorable=false`.
- `val01-clean-side`: side, 5 clean reps.
- `val02-rom-tempo-side`: side, 12 reps. Reps 1 and 12 clean; two reps each for depth short, lockout short, incomplete ROM, fast ascent, and fast descent.
- `val03-torso-heel-side`: side, 8 reps, same issue pattern as `train03`.
- `val04-view-front-oblique`: front/oblique, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 9 reps. Include one clean rep, then depth short, lockout short, incomplete ROM, torso warn, torso fail, heel lift, fast ascent, and fast descent.

### Standing Dumbbell Lateral Raises

Primary heuristic signals: front-view raise height, over-raise, elbow bend,
torso sway, left/right asymmetry, wrong plane/front-raise drift, shoulder shrug,
and tempo.

- `train01-clean-front`: front, 5 clean reps, both arms and wrists visible.
- `train02-height-plane-front`: front, 8 reps. Reps 1 and 8 clean; reps 2-3 stop below shoulder height; reps 4-5 raise above shoulder height; reps 6-7 drift forward into a front raise.
- `train03-arms-traps-front`: front, 8 reps. Rep 1 clean; reps 2-3 excessive elbow bend; reps 4-5 asymmetric arm height; reps 6-7 shoulder shrug; rep 8 clean.
- `train04-torso-tempo-front`: front, 8 reps. Rep 1 clean; reps 2-3 torso lean/sway; reps 4-5 swing the weights up too fast; reps 6-7 drop them down too fast; rep 8 clean.
- `train05-view-side-oblique`: side or oblique, 3 reps, `scorable=false`.
- `val01-clean-front`: front, 5 clean reps.
- `val02-height-plane-tempo-front`: front, 12 reps. Reps 1 and 12 clean; two reps each for low raise, over-raise, wrong plane, fast raise, and fast lower.
- `val03-arms-traps-torso-front`: front, 10 reps. Rep 1 clean; two reps each for elbow bend, asymmetry, shoulder shrug, and torso sway; rep 10 clean.
- `val04-view-side-oblique`: side/oblique, 3 reps, `scorable=false`.
- `test01-clean-front`: front, 5 clean reps.
- `test02-mixed-front`: front, 10 reps. Include one clean rep, then one rep each for low raise, over-raise, elbow bend, torso sway, asymmetry, fast raise, fast lower, shoulder shrug, and wrong plane.

### Cable Row

Primary heuristic signals: side-view pull depth, front stretch/extension,
shoulder retraction, torso lean, torso rocking, high row path, shoulder shrug,
and pull/return tempo.

- `train01-clean-side`: side, 5 clean reps, torso, shoulders, elbows, and handles visible.
- `train02-rom-retraction-side`: side, 8 reps. Reps 1 and 8 clean; reps 2-3 do not pull far enough; reps 4-5 do not fully extend forward; reps 6-7 pull without enough shoulder retraction.
- `train03-body-path-side`: side, 10 reps. Rep 1 clean; reps 2-3 lean back; reps 4-5 rock torso; reps 6-7 row too high; reps 8-9 shrug shoulders; rep 10 clean.
- `train04-tempo-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 pull too fast; reps 4-5 let the return snap forward.
- `train05-view-front-oblique`: front or oblique, 3 reps, `scorable=false`.
- `val01-clean-side`: side, 5 clean reps.
- `val02-rom-retraction-tempo-side`: side, 12 reps. Reps 1 and 12 clean; two reps each for pull depth, extension, shoulder retraction, fast pull, and fast return.
- `val03-body-path-side`: side, 10 reps, same issue pattern as `train03`.
- `val04-view-front-oblique`: front/oblique, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 10 reps. Include one clean rep, then one rep each for row depth, row extension, shoulder retraction, torso lean, torso rocking, high row, shoulder shrug, fast pull, and fast return.

### Cable Lat Pulldowns

Primary heuristic signals: side or side-diagonal pull depth, top extension,
elbow drive, torso lean, torso rocking, shoulder shrug, and pull/return tempo.

- `train01-clean-side`: side or usable side-diagonal, 5 clean reps.
- `train02-rom-elbow-side`: side, 8 reps. Reps 1 and 8 clean; reps 2-3 do not pull to upper chest; reps 4-5 do not reach all the way up; reps 6-7 pull mostly with arms instead of driving elbows down.
- `train03-body-shrug-side`: side, 8 reps. Rep 1 clean; reps 2-3 lean back excessively; reps 4-5 rock torso; reps 6-7 shrug shoulders; rep 8 clean.
- `train04-tempo-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 pull down too fast; reps 4-5 let the return snap up.
- `train05-view-front-oblique`: front or steep oblique, 3 reps, `scorable=false`.
- `val01-clean-side`: side, 5 clean reps.
- `val02-rom-elbow-tempo-side`: side, 12 reps. Reps 1 and 12 clean; two reps each for pull depth, top extension, elbow drive, fast pull, and fast return.
- `val03-body-shrug-side`: side, 8 reps, same issue pattern as `train03`.
- `val04-view-front-oblique`: front/oblique, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 9 reps. Include one clean rep, then one rep each for pull depth, top extension, elbow drive, torso lean, torso rocking, shoulder shrug, fast pull, and fast return.

### Cable Pushdowns

Primary heuristic signals: side-view bottom lockout, top flexion/start depth,
elbow drift, elbows set too far forward, torso lean, torso rocking, and
push/return tempo.

- `train01-clean-side`: side, 5 clean reps, elbow, wrist/handle, shoulder, and torso visible.
- `train02-range-setup-side`: side, 8 reps. Reps 1 and 8 clean; reps 2-3 do not lock out at the bottom; reps 4-5 start without enough elbow bend at the top; reps 6-7 start with elbows too far forward.
- `train03-elbow-torso-side`: side, 8 reps. Rep 1 clean; reps 2-3 elbows drift away from sides; reps 4-5 lean into the pushdown; reps 6-7 rock torso; rep 8 clean.
- `train04-tempo-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 push down too fast; reps 4-5 let the return snap up.
- `train05-view-front-oblique`: front or oblique, 3 reps, `scorable=false`.
- `val01-clean-side`: side, 5 clean reps.
- `val02-range-setup-tempo-side`: side, 12 reps. Reps 1 and 12 clean; two reps each for bottom lockout, top ROM, elbow-forward setup, fast push, and fast return.
- `val03-elbow-torso-side`: side, 8 reps, same issue pattern as `train03`.
- `val04-view-front-oblique`: front/oblique, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 9 reps. Include one clean rep, then one rep each for lockout short, top ROM short, elbow drift, elbow-forward setup, torso lean, torso rocking, fast push, and fast return.

### Leg Extensions

Primary heuristic signals: side-view top lockout, bottom/deep knee bend, torso
movement off the pad, hip lift, top hold, and extension/return tempo.

- `train01-clean-side`: side, 5 clean reps, same-side hip, knee, ankle/roller, and torso visible.
- `train02-rom-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 do not fully straighten at the top; reps 4-5 do not lower into a deep enough bend.
- `train03-posture-hold-side`: side, 8 reps. Rep 1 clean; reps 2-3 torso/back leaves the pad; reps 4-5 hips lift; reps 6-7 skip the brief top pause; rep 8 clean.
- `train04-tempo-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 extend too fast; reps 4-5 drop the weight too fast.
- `train05-view-front-oblique`: front or oblique, 3 reps, `scorable=false`.
- `val01-clean-side`: side, 5 clean reps.
- `val02-rom-tempo-side`: side, 10 reps. Reps 1 and 10 clean; two reps each for lockout short, bottom ROM short, fast extension, and fast return.
- `val03-posture-hold-side`: side, 8 reps, same issue pattern as `train03`.
- `val04-view-front-oblique`: front/oblique, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 8 reps. Include one clean rep, then one rep each for lockout short, bottom ROM short, torso movement, hip lift, top hold short, fast extension, and fast return.

### Lying Leg Curl

Primary heuristic signals: side-view curl depth, bottom extension, hip lift,
thigh movement, top hold, curl/lower tempo, and jerkiness. Keep the same-side
hip, knee, and lower-leg endpoint visible; the roller may hide the ankle, so
make sure the heel or foot is visible.

- `train01-clean-side`: side, 5 clean reps.
- `train02-rom-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 do not curl high enough; reps 4-5 do not extend fully at the bottom.
- `train03-hip-thigh-hold-side`: side, 8 reps. Rep 1 clean; reps 2-3 hips lift; reps 4-5 thighs move instead of staying pinned; reps 6-7 skip the top hold; rep 8 clean.
- `train04-tempo-jerk-side`: side, 8 reps. Rep 1 clean; reps 2-3 curl too fast; reps 4-5 lower too fast; reps 6-7 move jerkily/bounce; rep 8 clean.
- `train05-view-uncertain`: front, oblique, or side with the lower-leg endpoint hidden, 3 reps, `scorable=false`; do not label `lying-leg-curl.side_view_uncertain`.
- `val01-clean-side`: side, 5 clean reps.
- `val02-rom-tempo-jerk-side`: side, 12 reps. Reps 1 and 12 clean; two reps each for curl depth short, extension short, fast curl, fast lower, and jerkiness.
- `val03-hip-thigh-hold-side`: side, 8 reps, same issue pattern as `train03`.
- `val04-view-uncertain`: unsupported/uncertain view, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 9 reps. Include one clean rep, then one rep each for curl depth short, extension short, hip lift, thigh movement, top hold short, fast curl, fast lower, and jerkiness.

### Machine Ab Crunches

Primary heuristic signals: side-view crunch depth, upright return, neck
position, crunch/return tempo, jerkiness, arm pulling, and hip shifting. Keep
same-side shoulder, hip, and knee visible.

- `train01-clean-side`: side, 5 clean reps.
- `train02-rom-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 do not crunch deep enough; reps 4-5 do not return upright enough.
- `train03-neck-arms-hips-side`: side, 10 reps. Rep 1 clean; reps 2-3 neck/head pulls forward; reps 4-5 pull hard with arms; reps 6-7 hips shift/lift; reps 8-9 jerky motion; rep 10 clean.
- `train04-tempo-side`: side, 6 reps. Reps 1 and 6 clean; reps 2-3 crunch too fast; reps 4-5 return too fast.
- `train05-view-uncertain`: front, oblique, or side with shoulder/hip/knee obscured, 3 reps, `scorable=false`; do not label `machine-ab-crunches.side_view_uncertain`.
- `val01-clean-side`: side, 5 clean reps.
- `val02-rom-tempo-side`: side, 10 reps. Reps 1 and 10 clean; two reps each for crunch depth short, upright return short, fast crunch, and fast return.
- `val03-neck-arms-hips-jerk-side`: side, 10 reps, same issue pattern as `train03`.
- `val04-view-uncertain`: unsupported/uncertain view, 3 reps, `scorable=false`.
- `test01-clean-side`: side, 5 clean reps.
- `test02-mixed-side`: side, 9 reps. Include one clean rep, then one rep each for crunch depth short, upright return short, neck forward, fast crunch, fast return, jerkiness, arm pull, and hips moving.

### When to collect more

After the target set is reviewed, run:

```sh
npm run dataset:evaluate
npm run dataset:optimize -- --dry-run --include-case-details
```

Collect more only when the report points to a concrete gap:

- missed reps or extra reps: add 2-3 clean/partial-ROM clips for that exercise.
- low issue recall: add one 5-rep clip with 2-3 obvious positives for the missed issue.
- high clean false positives: add one clean clip from a different person/body size/camera distance.
- poor view/scorable accuracy: add one 3-rep unsupported-view clip and one clean scorable-view clip.
- weak score calibration: review `expectedScoreRange` for already-collected clean, mild-fault, and severe-fault reps before filming new clips.

## Add A New Video

Example for Barbell Squat:

1. Put the video in the matching exercise/split folder.

```text
datasets/form-heuristics/videos/training/barbell-squat/squat_001.mp4
```

2. Generate landmarks and a draft label.

```sh
npm run dataset:prepare -- \
  --exercise "Barbell Squat" \
  --video datasets/form-heuristics/videos/training/barbell-squat/squat_001.mp4 \
  --split train
```

This writes:

```text
datasets/form-heuristics/landmarks/training/barbell-squat/squat_001.json
datasets/form-heuristics/labels/training/barbell-squat/squat_001.json
```

Use `--force` only when you intentionally want to overwrite existing generated
landmarks or labels.

If landmarks already exist, generate only the draft label:

```sh
npm run dataset:draft-label -- \
  --exercise "Barbell Squat" \
  --video datasets/form-heuristics/videos/training/barbell-squat/squat_001.mp4 \
  --landmarks datasets/form-heuristics/landmarks/training/barbell-squat/squat_001.json \
  --split train
```

## Review The Draft Label

Draft labels are generated from replay and start as `reviewStatus: "draft"`.
Draft labels are ignored by `dataset:evaluate` and `dataset:optimize`.

Open the generated label and review:

- `expectedReps`: total real reps in the video.
- `reps[]`: exactly one entry per real rep.
- `startMs` / `endMs`: rep windows from the video timeline.
- `view`: `side`, `front`, `oblique`, or `unknown`.
- `scorable`: `true` only when the rep is judgeable under the exercise policy.
- `issueIds`: reviewed ground-truth form issues for that rep.

Generated replay output appears only as suggestions:

- `suggestedIssueIds`
- `suggestedFeedbackMessages`
- `suggestedScore`

Reviewer rules:

- Keep `issueIds: []` for clean reps.
- Copy only correct suggestions into `issueIds`.
- If one rep has multiple visible form issues, include every correct issue ID.
- If `scorable=false`, keep `issueIds: []`.
- Do not copy setup, view-quality, or tracking diagnostics into reviewed `issueIds`.
- Use `expectedScoreRange` only when a scorable rep's score range is genuinely judgeable.
- Add `notes` for context when a rep is unscorable or ambiguous.

When the file is correct, change:

```json
{
  "reviewStatus": "reviewed"
}
```

Existing labels with no `reviewStatus` are treated as reviewed for backwards
compatibility, but new labels should set it explicitly.

## Choose The Split

Use all three splits for each exercise:

- `train` labels live under `training/` and are used to discover candidate thresholds.
- `validation` labels live under `validation/` and are used to choose the winning config.
- `test` labels live under `testing/` and are held back for final regression checks.

Most videos should be `train`, but keep enough independent `validation` and
`test` clips for every exercise you want to auto-tune.

Default auto-apply minimums are:

- train: 1 reviewed case
- validation: 1 reviewed case
- test: 1 reviewed case

The optimizer can still write reports below these counts, but it will not write
production tuned configs.

## Validate And Evaluate

Run this after reviewing labels:

```sh
npm run dataset:evaluate
```

Evaluate only one exercise while building a dataset:

```sh
FORMA_DATASET_EXERCISE="Cable Lat Pulldowns" npm run dataset:evaluate
```

Add optional split filtering when checking one held-out slice:

```sh
FORMA_DATASET_EXERCISE="Cable Lat Pulldowns" FORMA_DATASET_SPLITS="test" npm run dataset:evaluate
```

Validation checks:

- label JSON shape
- exercise name matches the landmark recording
- `expectedReps` matches `reps.length`
- rep windows are ordered and non-overlapping
- reviewed reps include `view` and `scorable`
- reviewed scorable reps use the exercise's supported view
- unscorable reps do not carry reviewed `issueIds`
- issue IDs are valid and labelable from that rep's view
- non-ground-truth setup/view/tracking diagnostics are not used as reviewed labels
- optional per-rep `expectedScoreRange` values are finite ordered ranges in `0..100`
- landmark files exist

It also reports skipped templates and draft labels. Draft labels stay skipped
until you mark them as `"reviewed"`.

## Optimize Heuristics

Optimize all exercises with reviewed data:

```sh
npm run dataset:optimize
```

Optimize one exercise only:

```sh
npm run dataset:optimize:exercise -- --exercise "Barbell Squat"
```

The targeted command loads only that exercise's reviewed labels and landmarks.
The all-exercise command processes exercises one at a time, so it does not load
all landmark files into memory at once.

Use `--dry-run` when you want a report without writing tuned config JSON:

```sh
npm run dataset:optimize:exercise -- \
  --exercise "Barbell Squat" \
  --dry-run \
  --random-candidates 200 \
  --refinement-rounds 1 \
  --survivors 8 \
  --seed 42
```

Useful optional flags:

- `--report <path>` writes the report to a specific file.
- `--include-case-details` adds detailed baseline/winner per-video results.
- `--min-train-cases <n>` changes the train auto-apply minimum.
- `--min-validation-cases <n>` changes the validation auto-apply minimum.
- `--min-test-cases <n>` changes the test auto-apply minimum.

Reports are compact by default. Candidate rankings include aggregate metrics,
not every per-video result.

## Auto-Apply Rules

The optimizer writes `src/utils/exercises/definitions/tuned/*.json` only when:

- the exercise supports config variants and tunable ranges
- minimum train/validation/test case counts are met
- the winner improves validation metrics enough
- test rep-count accuracy does not regress beyond the exercise gate
- test clean-rep false-positive rate does not regress beyond the exercise gate
- test view, scorable, and score-range metrics pass the exercise gates when configured
- `--dry-run` is not set

Tuned JSON files are tracked source. Review them and their reports before
committing.

## Label Format

Minimal reviewed label example:

```json
{
  "schemaVersion": 1,
  "exerciseName": "Barbell Squat",
  "sourceVideo": "videos/training/barbell-squat/squat_001.mp4",
  "landmarkFile": "landmarks/training/barbell-squat/squat_001.json",
  "split": "train",
  "reviewStatus": "reviewed",
  "expectedReps": 2,
  "reps": [
    {
      "index": 1,
      "startMs": 850,
      "endMs": 2850,
      "issueIds": [],
      "view": "side",
      "scorable": true,
      "expectedScoreRange": [90, 100]
    },
    {
      "index": 2,
      "startMs": 3200,
      "endMs": 5200,
      "issueIds": [
        "barbell-squat.depth_short",
        "barbell-squat.torso_fail"
      ],
      "view": "side",
      "scorable": true,
      "notes": "Did not reach depth and leaned too far forward."
    }
  ]
}
```

Unscorable reviewed rep example:

```json
{
  "index": 3,
  "startMs": 5600,
  "endMs": 7100,
  "issueIds": [],
  "view": "front",
  "scorable": false,
  "notes": "Rep counted, but front view is not judgeable for Barbell Squat side-view form cues."
}
```

Rep issue scoring matches predicted reps to labelled timing windows before
comparing issue IDs. Good `startMs` and `endMs` labels matter because missed,
extra, or shifted reps can otherwise make feedback metrics noisy.

## Exercise Slugs

Current dataset folders:

- `barbell-curl`
- `barbell-squat`
- `cable-lat-pulldowns`
- `cable-pushdowns`
- `cable-row`
- `leg-extensions`
- `lying-leg-curl`
- `machine-ab-crunches`
- `push-up`
- `standing-dumbbell-lateral-raises`

## Full Loop

```text
record one exercise video in the correct view
-> place it under videos/<split-folder>/<exercise-slug>/
-> npm run dataset:prepare
-> review rep count, timing, view, scorable, and issueIds
-> mark reviewStatus as reviewed
-> npm run dataset:evaluate
-> npm run dataset:optimize:exercise -- --exercise "<Exercise Name>" --dry-run
-> run without --dry-run when the dataset is strong enough
-> review report and tuned JSON
```
