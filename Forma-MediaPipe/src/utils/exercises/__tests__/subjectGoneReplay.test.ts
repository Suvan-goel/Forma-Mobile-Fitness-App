/**
 * Re-entry double-counting regression tests against real recordings.
 *
 * The leave-frame case is built by splicing real frames: a clean set cut
 * mid-rep, the walk-out hallucination window from 03_walk_out.json re-timed to
 * a continuous 200ms cadence (so the silent-gap interruption can NOT fire and
 * only the subject-gone signal covers it), then the rest of the clean set.
 * Without the subject-gone interruption this splice counts a phantom 6th rep
 * (score 0) completed by hallucinated poses at the end of the gone window.
 */
import * as fs from 'fs';
import * as path from 'path';
import '../definitions/register';
import { ExerciseRegistry } from '../ExerciseRegistry';
import {
  buildReplayFrameCache,
  replayRecording,
  replayRecordingWithFrameCache,
} from '../replay/replayRunner';
import type { ExerciseDefinition, ExerciseState } from '../types';
import type { LandmarkRecording } from '../replay/types';

const STATUS_TESTS_DIR = path.resolve(__dirname, '../../../../datasets/form-heuristics/status-tests');

function loadRecording(name: string): LandmarkRecording {
  return JSON.parse(fs.readFileSync(path.join(STATUS_TESTS_DIR, name), 'utf8'));
}

const GONE_CADENCE_MS = 200;

function buildSplicedLeaveFrameRecording(): {
  recording: LandmarkRecording;
  goneStartMs: number;
  goneEndMs: number;
} {
  const clean = loadRecording('01_clean_curl.json');
  const walkOut = loadRecording('03_walk_out.json');

  // 2 complete reps (at 2821/4796ms) + the partial up-swing of rep 3.
  const beforeLeave = clean.frames.filter((frame) => frame.timestamp <= 5900);
  // The hallucinated zero-reliable-chain window while the subject is out.
  const goneWindow = walkOut.frames.filter(
    (frame) => frame.timestamp >= 5979 && frame.timestamp <= 14851,
  );
  // Rep 3 from its start plus reps 4-5.
  const afterReturn = clean.frames.filter((frame) => frame.timestamp >= 5000);

  const lastBefore = beforeLeave[beforeLeave.length - 1].timestamp;
  const gone = goneWindow.map((frame, index) => ({
    ...frame,
    timestamp: lastBefore + GONE_CADENCE_MS * (index + 1),
  }));
  const goneEndMs = gone[gone.length - 1].timestamp;
  const returnOffset = goneEndMs + GONE_CADENCE_MS - afterReturn[0].timestamp;
  const returned = afterReturn.map((frame) => ({
    ...frame,
    timestamp: frame.timestamp + returnOffset,
  }));

  return {
    recording: {
      ...clean,
      metadata: { ...clean.metadata, description: 'spliced leave-frame repro', expectedReps: 5 },
      frames: [...beforeLeave, ...gone, ...returned],
    },
    goneStartMs: gone[0].timestamp,
    goneEndMs,
  };
}

function probeDefinition(
  seen: Array<{ timestamp: number; interrupted: boolean }>,
): ExerciseDefinition {
  return {
    name: 'Subject Gone Probe',
    requiredView: 'any',
    qualityProfile: {
      exerciseName: 'Subject Gone Probe',
      requiredView: 'any',
      requiredJoints: ['left_shoulder'],
      importantJoints: [],
      windowSize: 3,
    },
    createState: (): ExerciseState => ({
      repCount: 0,
      lastRepResult: null,
      feedback: null,
      feedbackTimestamp: null,
      debugInfo: {},
      _internal: {},
    }),
    update: (_keypoints, state, frameContext) => {
      seen.push({
        timestamp: frameContext?.timestampMs ?? -1,
        interrupted: frameContext?.trackingInterrupted === true,
      });
      return state;
    },
    ttsConfig: { feedbackToIssue: {} },
    summaryConfig: {},
  };
}

describe('subject-gone replay integration', () => {
  const barbellCurl = ExerciseRegistry.get('Barbell Curl')!;

  it('counts exactly the performed reps on the spliced leave-frame recording', () => {
    const { recording } = buildSplicedLeaveFrameRecording();
    const result = replayRecording(barbellCurl, recording);

    expect(result.finalRepCount).toBe(5);
    // The pre-fix phantom rep completed on hallucinated frames with score 0.
    for (const score of result.repScores) {
      expect(score).toBeGreaterThan(50);
    }
  });

  it('matches via the frame-cache replay path', () => {
    const { recording } = buildSplicedLeaveFrameRecording();
    const result = replayRecordingWithFrameCache(barbellCurl, buildReplayFrameCache(recording));

    expect(result.finalRepCount).toBe(5);
  });

  it('interrupts tracking only inside the subject-gone window', () => {
    const { recording, goneStartMs, goneEndMs } = buildSplicedLeaveFrameRecording();
    const seen: Array<{ timestamp: number; interrupted: boolean }> = [];
    replayRecording(probeDefinition(seen), recording);

    const interrupted = seen.filter((frame) => frame.interrupted);
    expect(interrupted.length).toBeGreaterThan(0);
    // The signal needs a sustained zero-reliable run before arming, and holds
    // through the re-entry frames until a reliable chain returns.
    const armEarliestMs = goneStartMs + 2500;
    const releaseLatestMs = goneEndMs + 1000;
    for (const frame of interrupted) {
      expect(frame.timestamp).toBeGreaterThanOrEqual(armEarliestMs);
      expect(frame.timestamp).toBeLessThanOrEqual(releaseLatestMs);
    }
  });

  it('does not interrupt an occluded but present subject', () => {
    const recording = loadRecording('02_occluded_curl.json');
    const seen: Array<{ timestamp: number; interrupted: boolean }> = [];
    replayRecording(probeDefinition(seen), recording);

    expect(seen.some((frame) => frame.interrupted)).toBe(false);
    expect(replayRecording(barbellCurl, recording).finalRepCount).toBe(5);
  });

  it('keeps the clean and walk-out status recordings unchanged', () => {
    expect(replayRecording(barbellCurl, loadRecording('01_clean_curl.json')).finalRepCount).toBe(5);
    expect(replayRecording(barbellCurl, loadRecording('03_walk_out.json')).finalRepCount).toBe(0);
  });
});
