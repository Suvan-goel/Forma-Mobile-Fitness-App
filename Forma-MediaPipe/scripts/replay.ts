/**
 * Exercise Heuristic Replay Script
 *
 * Loads a recorded landmark session (captured in dev mode on-device) and
 * replays every frame through the exercise's update() function — the exact
 * same logic that runs at 30fps on the phone.
 *
 * USAGE
 * -----
 *   npx jest scripts/replay.ts --testNamePattern="<optional filter>"
 *
 * Or run all recordings in the folder:
 *   npx jest scripts/replay.ts
 *
 * RECORDING FILES
 * ---------------
 * Drop JSON files exported from the Metro console into scripts/recordings/.
 * Each file must match the format emitted by CameraScreen's landmark recorder:
 *
 *   {
 *     "exerciseName": "Lat Pulldown",
 *     "metadata": { "recordedAt": "...", "description": "3 reps", "expectedReps": 3 },
 *     "frames": [ { "timestamp": 0, "keypoints": [...] }, ... ]
 *   }
 *
 * HOW TO EXTRACT A RECORDING FROM METRO
 * --------------------------------------
 *  1. Run the app in dev mode with debug mode enabled
 *  2. Start + stop a set in the CameraScreen
 *  3. In the Metro terminal, you will see:
 *       === LANDMARK_RECORDING_START ===
 *       {"exerciseName":...  (JSON in 4000-char chunks)
 *       === LANDMARK_RECORDING_END ===
 *  4. Copy everything between the START/END markers, join the chunks into
 *     one string, and save as a .json file in scripts/recordings/
 *
 * OUTPUT (per recording)
 * ----------------------
 *   Frame-by-frame log of phase transitions, rep completions, and feedback.
 *   Per-rep summary: score, messages, phase sequence.
 *   Set summary: total reps, average score, all feedback seen.
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Import all exercise definitions (same as CameraScreen does) ──────────────
// We import register.ts which populates ExerciseRegistry as a side effect.
import '../src/utils/exercises/definitions/register';
import { ExerciseRegistry } from '../src/utils/exercises/ExerciseRegistry';
import type { ExerciseState } from '../src/utils/exercises/types';
import type { Keypoint } from '../src/utils/poseAnalysis';

// ─────────────────────────────────────────────────────────────────────────────
// Types matching the JSON format emitted by CameraScreen
// ─────────────────────────────────────────────────────────────────────────────

interface RecordingFrame {
  timestamp: number;
  keypoints: Keypoint[];
}

interface RecordingFile {
  exerciseName: string;
  metadata: {
    recordedAt?: string;
    description?: string;
    expectedReps?: number;
    duration?: number;
  };
  frames: RecordingFrame[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 1): string {
  return n.toFixed(decimals);
}

function pad(s: string, width: number): string {
  return s.padEnd(width);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core replay function
// ─────────────────────────────────────────────────────────────────────────────

interface ReplayResult {
  totalReps: number;
  repScores: number[];
  repMessages: string[][];
  phaseSequences: string[][];
  allFeedbackSeen: string[];
  frameCount: number;
  durationSeconds: number;
}

function replayRecording(recording: RecordingFile, verbose: boolean): ReplayResult {
  const definition = ExerciseRegistry.get(recording.exerciseName);
  if (!definition) {
    throw new Error(
      `No exercise definition found for "${recording.exerciseName}". ` +
      `Registered exercises: ${ExerciseRegistry.list().join(', ')}`
    );
  }

  let state: ExerciseState = definition.createState();

  const repScores: number[] = [];
  const repMessages: string[][] = [];
  const phaseSequences: string[][] = [];
  const allFeedbackSeen = new Set<string>();
  let currentPhaseSequence: string[] = [];
  let lastPhase: string | undefined;
  let lastRepCount = 0;

  const durationSeconds =
    recording.frames.length > 1
      ? (recording.frames[recording.frames.length - 1].timestamp -
          recording.frames[0].timestamp) / 1000
      : 0;

  for (let i = 0; i < recording.frames.length; i++) {
    const frame = recording.frames[i];
    const prevState = state;
    state = definition.update(frame.keypoints, state);

    // ── Track phase changes ────────────────────────────────────────────────
    const currentPhase = state.debugInfo?.phase as string | undefined;
    if (currentPhase && currentPhase !== lastPhase) {
      if (verbose) {
        console.log(
          `  [f${pad(String(i), 4)}  t=${pad(fmt(frame.timestamp / 1000, 2) + 's', 7)}]` +
          `  Phase: ${lastPhase ?? '—'} → ${currentPhase}`
        );
      }
      if (currentPhase) {
        currentPhaseSequence.push(currentPhase);
      }
      lastPhase = currentPhase;
    }

    // ── Track feedback changes ─────────────────────────────────────────────
    if (
      verbose &&
      state.feedback &&
      state.feedback !== prevState.feedback
    ) {
      console.log(
        `  [f${pad(String(i), 4)}  t=${pad(fmt(frame.timestamp / 1000, 2) + 's', 7)}]` +
        `  Feedback: "${state.feedback}"`
      );
    }
    if (state.feedback) {
      allFeedbackSeen.add(state.feedback);
    }

    // ── Detect rep completion ──────────────────────────────────────────────
    if (state.repCount > lastRepCount) {
      const repIndex = state.repCount - 1;
      const result = state.lastRepResult;
      const score = result?.score ?? 0;
      const messages = result?.messages ?? [];

      repScores.push(score);
      repMessages.push(messages);
      phaseSequences.push([...currentPhaseSequence]);

      // Score bar: visual indicator (e.g. ████████░░ 80)
      const filled = Math.round(score / 10);
      const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);

      console.log(
        `\n  ┌─ REP ${repIndex + 1} COMPLETE (frame ${i}, t=${fmt(frame.timestamp / 1000, 2)}s) ─────────────────────`
      );
      console.log(`  │  Score:    [${bar}] ${fmt(score, 0)}/100`);
      if (messages.length > 0) {
        console.log(`  │  Issues:   ${messages.join(' | ')}`);
      } else {
        console.log(`  │  Issues:   none (clean rep)`);
      }
      console.log(`  │  Phases:   ${currentPhaseSequence.join(' → ')}`);
      console.log(`  └${'─'.repeat(60)}`);

      currentPhaseSequence = [];
      lastRepCount = state.repCount;
    }
  }

  return {
    totalReps: state.repCount,
    repScores,
    repMessages,
    phaseSequences,
    allFeedbackSeen: Array.from(allFeedbackSeen),
    frameCount: recording.frames.length,
    durationSeconds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Load all recording files from the recordings/ directory
// ─────────────────────────────────────────────────────────────────────────────

function loadRecordings(): Array<{ file: string; recording: RecordingFile }> {
  const recordingsDir = path.join(__dirname, 'recordings');
  if (!fs.existsSync(recordingsDir)) {
    return [];
  }

  const files = fs.readdirSync(recordingsDir).filter(f => f.endsWith('.json'));
  return files.map(file => {
    const raw = fs.readFileSync(path.join(recordingsDir, file), 'utf-8');
    const recording = JSON.parse(raw) as RecordingFile;
    return { file, recording };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Jest test suite — one test per recording file
// ─────────────────────────────────────────────────────────────────────────────

const recordings = loadRecordings();

if (recordings.length === 0) {
  describe('Exercise Replay', () => {
    it('no recordings found — drop JSON files into scripts/recordings/ to run', () => {
      console.log('\n  No recording files found in scripts/recordings/');
      console.log('  See the comment at the top of scripts/replay.ts for instructions.\n');
      // Not a failure — just a guide
      expect(true).toBe(true);
    });
  });
} else {
  describe('Exercise Replay', () => {
    for (const { file, recording } of recordings) {
      const label = `${recording.exerciseName} — ${file}`;

      it(label, () => {
        const expectedReps = recording.metadata?.expectedReps;

        console.log('\n');
        console.log(`${'═'.repeat(70)}`);
        console.log(`  ${recording.exerciseName.toUpperCase()}`);
        console.log(`  File:     ${file}`);
        console.log(`  Recorded: ${recording.metadata?.recordedAt ?? 'unknown'}`);
        console.log(`  Note:     ${recording.metadata?.description ?? ''}`);
        console.log(`  Frames:   ${recording.frames.length}`);
        if (expectedReps !== undefined) {
          console.log(`  Expected: ${expectedReps} rep${expectedReps !== 1 ? 's' : ''}`);
        }
        console.log(`${'─'.repeat(70)}`);

        // VERBOSE = true shows every phase transition + feedback change.
        // Set to false if you only want the per-rep summaries.
        const VERBOSE = true;

        const result = replayRecording(recording, VERBOSE);

        // ── Set summary ──────────────────────────────────────────────────
        const avgScore =
          result.repScores.length > 0
            ? result.repScores.reduce((a, b) => a + b, 0) / result.repScores.length
            : 0;

        console.log(`\n${'─'.repeat(70)}`);
        console.log(`  SET SUMMARY`);
        console.log(`  Reps detected:  ${result.totalReps}`);
        if (expectedReps !== undefined) {
          const match = result.totalReps === expectedReps ? '✓' : `✗ (expected ${expectedReps})`;
          console.log(`  Rep count:      ${match}`);
        }
        console.log(`  Avg score:      ${fmt(avgScore, 1)}/100`);
        console.log(`  Duration:       ${fmt(result.durationSeconds, 1)}s`);
        console.log(`  Frame count:    ${result.frameCount}`);

        if (result.repScores.length > 0) {
          const scoreList = result.repScores
            .map((s, i) => `Rep ${i + 1}: ${fmt(s, 0)}`)
            .join('  |  ');
          console.log(`  Scores:         ${scoreList}`);
        }

        if (result.allFeedbackSeen.length > 0) {
          console.log(`  All feedback:`);
          for (const msg of result.allFeedbackSeen) {
            const count = result.repMessages.filter(msgs => msgs.includes(msg)).length;
            console.log(`    - "${msg}" (${count} rep${count !== 1 ? 's' : ''})`);
          }
        } else {
          console.log(`  All feedback:   none fired`);
        }
        console.log(`${'═'.repeat(70)}\n`);

        // ── Assertions ───────────────────────────────────────────────────
        // Rep count assertion: only if expectedReps is set in the metadata.
        // If it fails, the output above tells you exactly what happened.
        if (expectedReps !== undefined) {
          expect(result.totalReps).toBe(expectedReps);
        } else {
          // No assertion — replay is purely diagnostic
          expect(true).toBe(true);
        }
      });
    }
  });
}
