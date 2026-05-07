# Standing Dumbbell Lateral Raises Real-Video Smoke Checklist

This checklist is a human QA artifact for pre-dataset validation. It is not reviewed training data, should not be used as optimizer input, and must not update `src/utils/exercises/definitions/tuned/lateralRaise.json`.

Record each clip as a short set of 2-5 reps when possible. Verify rep count, `scorable`, quality warnings, issue IDs when scorable, and the listed diagnostics in replay output.

| # | Clip scenario | Expected reps | Expected `scorable` | Expected quality warnings | Expected issue IDs when scorable | Diagnostics to inspect |
|---|---|---:|---|---|---|---|
| 1 | Clean front-view reps | Count all clean reps | `true` | None | None | `peakHeightRatio`, `peakLateralReachRatio`, `viewAngleDeg` |
| 2 | Clean front-camera mirrored capture | Count all clean reps | `true` | None | None | `leftPeakHeightRatio`, `rightPeakHeightRatio`, `viewAngleDeg` |
| 3 | Image-only landmarks available, no world landmarks | Count all clean reps | `true` | None | None | `viewAngleDeg.eligible=false`, `skippedReason=world_landmarks_unavailable` |
| 4 | Oblique camera, roughly 35 degrees | Count reps | `false` | `front_view_uncertain` | None | `view=oblique`, `nonFrontViewSampleRatio` |
| 5 | Side-ish camera, roughly 60-90 degrees | Count reps if movement signal is visible | `false` | `front_view_uncertain` | None | `view=side`, `maxViewAngleDeg` |
| 6 | Front raise mistaken for lateral raise | Count reps | `true` if front view is valid | `None` | `standing-dumbbell-lateral-raises.wrong_plane` | `peakLateralReachRatio` |
| 7 | Scaption raise slightly forward but still wide | Count reps | `true` | None | Maybe none, unless reach is below threshold | `peakLateralReachRatio`, `leftPeakLateralReachRatio`, `rightPeakLateralReachRatio` |
| 8 | Low ROM, arms stop around half height | Count meaningful partials only | `true` | None | `standing-dumbbell-lateral-raises.rom_height` | `peakHeightRatio` |
| 9 | Tiny pulse below partial threshold | Do not count | N/A | N/A | N/A | FSM trace only |
| 10 | Over-raise above shoulder height | Count reps | `true` | None | `standing-dumbbell-lateral-raises.over_raise` | `peakHeightRatio` |
| 11 | Excessive elbow bend through the raise | Count reps | `true` | None | `standing-dumbbell-lateral-raises.elbow_bend` | `minStraightnessRatio`, sample count |
| 12 | One arm consistently lower near the top | Count reps | `true` | None | `standing-dumbbell-lateral-raises.asymmetry` | `topHeightAsymmetry`, `topFrameCount` |
| 13 | Single-frame asymmetry spike | Count reps | `true` | None | None | `topHeightAsymmetry`, `topFrameCount` |
| 14 | Sustained shoulder shrug | Count reps | `true` | None | `standing-dumbbell-lateral-raises.shoulder_shrug` | `shrugPct`, `headShrugPct`, sample counts |
| 15 | One-frame shoulder spike | Count reps | `true` | None | None | `shrugPct`, shrug warning sample counts |
| 16 | Lateral torso lean to help lift | Count reps | `true` | None | `standing-dumbbell-lateral-raises.torso_warn` | `torsoLean` |
| 17 | Backward/forward trunk rocking | Count reps | `true` if front view is valid | None | `standing-dumbbell-lateral-raises.torso_warn` | `sagittalTorsoSway` |
| 18 | Hip shift or knee bounce momentum | Count reps | `true` if front view is valid | None | `standing-dumbbell-lateral-raises.torso_warn` | `hipSwayRatio` |
| 19 | Very fast upward swing | Count reps | `true` | None | `standing-dumbbell-lateral-raises.tempo_up` | `tRaise` |
| 20 | Very fast descent | Count reps | `true` | None | `standing-dumbbell-lateral-raises.tempo_down` | `tLower` |
| 21 | Low light with visible landmarks | Count reps if tracking remains stable | Depends on tracking quality | Possible tracking warnings | Only if scorable | `qualityStatus`, `lowConfidenceFrames`, cue eligibility |
| 22 | Loose clothing but visible joints | Count reps | `true` if confidence stays medium/high | None or tracking warnings | Only if scorable | form sample counts and skipped reasons |
| 23 | Wrists intermittently low confidence | Count reps if elbow fallback preserves height signal | `true` if rep quality stays medium/high | Maybe tracking warnings | Avoid false `elbow_bend` and `wrong_plane` | `minStraightnessRatio.eligible`, `peakLateralReachRatio` |
| 24 | Meaningful leaned partial rep | Count one partial | `true` if front view is valid | None | `standing-dumbbell-lateral-raises.rom_height`, `standing-dumbbell-lateral-raises.torso_warn` | `peakHeightRatio`, `torsoLean.sampleCount` |
| 25 | Oblique camera plus wrong-plane movement | Count reps | `false` | `front_view_uncertain` | None surfaced to user while unscorable | `view`, `wrong_plane` cue diagnostic for offline review |

Acceptance notes:

- Countable but unscorable view-angle failures should show setup guidance, not form coaching.
- Clean front-view reps should not trigger `front_view_uncertain`, `wrong_plane`, `asymmetry`, `shoulder_shrug`, or tempo issues.
- Any threshold changes after this smoke pass require reviewed label files in the training, validation, and testing splits.
