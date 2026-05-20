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

Use short, single-exercise clips. A good default is 3-8 reps per clip with a
small buffer before the first rep and after the last rep.

For each exercise, collect:

- clean examples
- common form-fault examples for each available issue ID
- a mix of people, body sizes, clothing, machines/benches, lighting, and camera distances
- train, validation, and test clips recorded independently

Capture requirements:

- Use the scorable view from the table above.
- Keep all form-critical joints visible for the whole rep.
- Keep the camera stable and avoid zoom/pan changes mid-set.
- Avoid mixed-exercise clips.
- Avoid clipping the start/end of reps.
- Do not rely on unsupported views for clean-negative form labels.

Unsupported or uncertain views are still useful for rep-count robustness, but
review those reps as `scorable=false` with empty `issueIds`.

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
