# Replay Dataset Optimizer Flow

This file was originally Barbell-Curl-specific. The current replay dataset flow
now applies to all registered exercises. Use this as the quick optimizer
checklist after videos have been prepared, labelled, and marked as reviewed.

Run all commands from the repo root:

```sh
cd /Users/suvangoel/Forma-Mobile-Fitness-App/Forma-MediaPipe
```

## 1. Prepare Videos And Labels

For each clip:

1. Record one exercise in the correct dataset view.
2. Put the raw video under `datasets/form-heuristics/videos/<split-folder>/<exercise-slug>/`.
3. Generate landmarks and a replay draft label:

```sh
npm run dataset:prepare -- \
  --exercise "<Exercise Name>" \
  --video datasets/form-heuristics/videos/<split-folder>/<exercise-slug>/<clip>.mp4 \
  --split train
```

Use split folders `training`, `validation`, or `testing`, and pass the matching
label split value: `--split train`, `--split validation`, or `--split test`.
If landmarks already exist, run `npm run dataset:draft-label` with
`--landmarks` instead.

## 2. Review Labels

Draft labels are ignored by evaluation and optimization. Before tuning, every
case you want included must have:

- `reviewStatus: "reviewed"`
- `expectedReps` matching the real rep count and `reps.length`
- accurate `startMs` / `endMs` windows
- `view` on every reviewed rep
- `scorable` on every reviewed rep
- `issueIds` copied only from visible, correct, ground-truth form issues

Use `scorable=false` for unsupported views, uncertain views, occlusions, poor
tracking, or reps that count but cannot be judged for that exercise's scoring
view. Keep `issueIds: []` on unscorable reps.

Do not copy setup, view-quality, or tracking diagnostics into reviewed
`issueIds`. Runtime diagnostics such as `side_view_uncertain` and
`front_view_uncertain` help replay analysis, but reviewed labels should express
those cases with `scorable=false`.

## 3. Exercise View Policy

| Exercise | Reviewed scorable view |
| --- | --- |
| Barbell Curl | `front` full scoring; `side`/`oblique` partial scoring |
| Push-Up | `side` |
| Barbell Squat | `side` |
| Standing Dumbbell Lateral Raises | `front` |
| Cable Row | `side` |
| Cable Lat Pulldowns | `side` |
| Cable Pushdowns | `side` |
| Leg Extensions | `side` |
| Lying Leg Curl | `side` |
| Machine Ab Crunches | `side` |

Barbell Curl is the only current partial-view exception. Side/oblique curl reps
may label visible-arm ROM, shoulder involvement, torso swing, and tempo. Do not
label asymmetry or elbow flare from side/oblique curl captures.

## 4. Validate The Dataset

Check that all reviewed labels load correctly before tuning:

```sh
npm run dataset:evaluate
```

For a single exercise:

```sh
FORMA_DATASET_EXERCISE="Barbell Curl" npm run dataset:evaluate
```

Confirm the output has no unexpected skipped reviewed cases:

```text
Missing-landmark labels skipped: 0
```

`Draft labels skipped` can be nonzero while you are still reviewing, but those
drafts will not influence evaluation or optimization.

## 5. Run A Dry Run

Start with a dry run so you can inspect the candidate result without writing a
tuned config:

```sh
npm run dataset:optimize:exercise -- \
  --exercise "Barbell Curl" \
  --dry-run \
  --include-case-details
```

Replace `"Barbell Curl"` with any registered exercise once that exercise has
reviewed train, validation, and test labels.

The optimizer writes a report under:

```text
datasets/form-heuristics/reports/
```

Use `--include-case-details` when you want per-video baseline and winner
details in the report.

## 6. Apply The Optimized Config

If the dry-run report looks good, run the optimizer without `--dry-run`:

```sh
npm run dataset:optimize:exercise -- \
  --exercise "Barbell Curl" \
  --include-case-details
```

If the optimizer finds a qualifying improvement, it writes the tuned config to:

```text
src/utils/exercises/definitions/tuned/
```

It is normal for this command to produce no tuned config change if no candidate
improves validation performance while passing the test-set gates.

## 7. Verify The Result

After applying a tuned config, rerun the evaluator:

```sh
npm run dataset:evaluate
```

Then inspect the diff:

```sh
git diff
```

Pay special attention to:

```text
src/utils/exercises/definitions/tuned/
datasets/form-heuristics/reports/
```

## Optional Search Controls

For a smaller or reproducible search, add flags such as:

```sh
npm run dataset:optimize:exercise -- \
  --exercise "Barbell Curl" \
  --dry-run \
  --include-case-details \
  --random-candidates 200 \
  --refinement-rounds 1 \
  --survivors 8 \
  --seed 42
```

Useful flags:

- `--report <path>` writes the report to a specific path.
- `--random-candidates <n>` controls the random search size.
- `--refinement-rounds <n>` controls refinement passes.
- `--survivors <n>` controls how many candidates survive each search round.
- `--seed <n>` makes the random search reproducible.
- `--min-train-cases <n>` changes the train split auto-apply minimum.
- `--min-validation-cases <n>` changes the validation split auto-apply minimum.
- `--min-test-cases <n>` changes the test split auto-apply minimum.
