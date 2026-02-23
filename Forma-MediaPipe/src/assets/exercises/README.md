# Exercise card images

Place one image per exercise here to show on the Choose Exercise screen. Then update `EXERCISE_IMAGE_MAP` in `src/screens/ChooseExerciseScreen.tsx` to use them.

## Suggested filenames (match to exercise name)

| Exercise name | Suggested filename   |
|---------------|-----------------------|
| Push-Up | `push_up.png` |
| Cable Pushdowns | `cable_pushdowns.png` |
| Barbell Curl | `barbell_curl.png` |
| Machine Ab Crunches | `machine_ab_crunches.png` |
| Barbell Squat | `barbell_squat.png` |
| Leg Extensions | `leg_extensions.png` |
| Lying Leg Curl | `lying_leg_curl.png` |
| Cable Lat Pulldowns | `cable_lat_pulldowns.png` |
| Standing Dumbbell Lateral Raises | `standing_dumbbell_lateral_raises.png` |
| Cable Row | `cable_row.png` |

## How to wire them up

In `src/screens/ChooseExerciseScreen.tsx`, change each entry in `EXERCISE_IMAGE_MAP` from the category fallback to your image, for example:

```ts
'Push-Up': require('../assets/exercises/push_up.png'),
'Barbell Curl': require('../assets/exercises/barbell_curl.png'),
// ... etc.
```

Use `.png`, `.jpg`, or `.jpeg`. Images are displayed with `resizeMode="cover"` in a fixed-height area (~140px); landscape or square assets usually look best.
