# Barbell Curl Optimizer Flow

Use this flow after the barbell curl videos in `training`, `validation`, and
`testing` have been labelled and marked as reviewed.

Run all commands from the repo root:

```sh
cd /Users/suvangoel/Forma-Mobile-Fitness-App/Forma-MediaPipe
```

## 1. Validate The Dataset

Check that all labels load correctly before tuning:

```sh
npm run dataset:evaluate
```

Confirm the output shows:

```text
Draft labels skipped: 0
Missing-landmark labels skipped: 0
```

If any labels are still skipped, fix those before running the optimizer.

## 2. Run A Dry Run

Start with a dry run so you can inspect the candidate result without writing a
tuned config:

```sh
npm run dataset:optimize:exercise -- \
  --exercise "Barbell Curl" \
  --dry-run \
  --include-case-details
```

The optimizer writes a report under:

```text
datasets/form-heuristics/reports/
```

Use `--include-case-details` when you want per-video baseline and winner
details in the report.

## 3. Apply The Optimized Config

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

## 4. Verify The Result

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
