# Form Heuristics Dataset

Desktop workflow for improving the app's deterministic exercise heuristics with
prerecorded videos, generated landmarks, and human-reviewed per-rep labels.

This pipeline tunes threshold/config JSON for the existing heuristics. It does
not train model weights.

## Folder Layout

- `videos/<exercise-slug>/` raw source videos. Ignored by Git.
- `landmarks/<exercise-slug>/` generated MediaPipe landmark JSON. Ignored by Git.
- `labels/<exercise-slug>/` reviewed label JSON and `_template.json` files.
- `reports/` generated evaluation/optimisation reports. Ignored by Git.
- `candidates/` optional local scratch space. Ignored by Git.

Each label folder has a `_template.json` with the exact exercise name and
copyable issue ids/messages for that exercise.

## One-Time Setup

Install the Python dependencies used by video landmark extraction:

```sh
python3 -m pip install -r scripts/requirements-dataset.txt
```

## Add A New Video

Example for Barbell Squat:

1. Put the video in the matching exercise folder.

```text
datasets/form-heuristics/videos/barbell-squat/squat_001.mp4
```

2. Generate landmarks and a draft label.

```sh
npm run dataset:prepare -- \
  --exercise "Barbell Squat" \
  --video datasets/form-heuristics/videos/barbell-squat/squat_001.mp4 \
  --split train
```

This writes:

```text
datasets/form-heuristics/landmarks/barbell-squat/squat_001.json
datasets/form-heuristics/labels/barbell-squat/squat_001.json
```

Use `--force` only when you intentionally want to overwrite existing generated
landmarks or labels.

If landmarks already exist, generate only the draft label:

```sh
npm run dataset:draft-label -- \
  --exercise "Barbell Squat" \
  --video datasets/form-heuristics/videos/barbell-squat/squat_001.mp4 \
  --landmarks datasets/form-heuristics/landmarks/barbell-squat/squat_001.json \
  --split train
```

## Review The Draft Label

Generated labels start as:

```json
{
  "reviewStatus": "draft",
  "expectedReps": 5,
  "reps": []
}
```

Draft labels are ignored by `dataset:evaluate` and `dataset:optimize`.

Open the generated label and review:

- `expectedReps`: total real reps in the video.
- `reps[]`: one entry per real rep.
- `startMs` / `endMs`: rep windows from the video timeline.
- `issueIds`: ground-truth form issues for that rep.

Generated feedback appears only as suggestions:

- `suggestedIssueIds`
- `suggestedFeedbackMessages`
- `suggestedScore`

Keep `issueIds: []` for clean reps. Copy only correct suggestions into
`issueIds`, or copy another valid issue id from `availableIssues`.

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

- `train`: used to discover candidate thresholds.
- `validation`: used to choose the winning config.
- `test`: held back for final regression checks.

Most videos should be `train`, but keep enough independent `validation` and
`test` clips for every exercise you want to auto-tune.

Default auto-apply minimums are:

- train: 20 reviewed cases
- validation: 5 reviewed cases
- test: 5 reviewed cases

The optimiser can still write reports below these counts, but it will not write
production tuned configs.

## Validate And Evaluate

Run this after reviewing labels:

```sh
npm run dataset:evaluate
```

This validates the dataset and reports current heuristic performance. It checks:

- label JSON shape
- exercise name matches the landmark recording
- `expectedReps` matches `reps.length`
- rep windows are ordered and non-overlapping
- issue ids are valid
- landmark files exist

It also reports skipped templates and draft labels. Draft labels stay skipped
until you mark them as `"reviewed"`.

## Optimise Heuristics

Optimise all exercises with reviewed data:

```sh
npm run dataset:optimize
```

Optimise one exercise only:

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

The optimiser writes `src/utils/exercises/definitions/tuned/*.json` only when:

- the exercise supports config variants and tunable ranges
- minimum train/validation/test case counts are met
- the winner improves validation metrics enough
- test rep-count accuracy does not regress beyond the exercise gate
- test clean-rep false-positive rate does not regress beyond the exercise gate
- `--dry-run` is not set

Tuned JSON files are tracked source. Review them and their reports before
committing.

## Label Format

Minimal reviewed label example:

```json
{
  "schemaVersion": 1,
  "exerciseName": "Barbell Squat",
  "sourceVideo": "videos/barbell-squat/squat_001.mp4",
  "landmarkFile": "landmarks/barbell-squat/squat_001.json",
  "split": "train",
  "reviewStatus": "reviewed",
  "expectedReps": 2,
  "reps": [
    {
      "index": 1,
      "startMs": 850,
      "endMs": 2850,
      "issueIds": []
    },
    {
      "index": 2,
      "startMs": 3200,
      "endMs": 5200,
      "issueIds": ["barbell-squat.depth_short"],
      "notes": "Did not reach depth"
    }
  ]
}
```

Rep issue scoring matches predicted reps to labelled timing windows before
comparing issue ids. Good `startMs` and `endMs` labels matter because missed,
extra, or shifted reps can otherwise make feedback metrics noisy.

## Exercise Slugs

Current dataset folders:

- `barbell-squat`
- `push-up`
- `barbell-curl`
- `cable-row`
- `cable-pushdowns`
- `cable-lat-pulldowns`
- `leg-extensions`
- `lying-leg-curl`
- `machine-ab-crunches`
- `standing-dumbbell-lateral-raises`

## Full Loop

```text
add video
-> npm run dataset:prepare
-> review label timings and issueIds
-> mark reviewStatus as reviewed
-> npm run dataset:evaluate
-> npm run dataset:optimize:exercise -- --exercise "<Exercise Name>" --dry-run
-> run without --dry-run when the dataset is strong enough
-> review report and tuned JSON
```
