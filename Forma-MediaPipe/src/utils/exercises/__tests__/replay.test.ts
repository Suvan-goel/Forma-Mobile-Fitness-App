/**
 * Generic Replay Tests — auto-discovers recordings and runs them
 * against the matching ExerciseDefinition from the registry.
 *
 * To add a test for any exercise:
 *   1. Record landmarks on-device (start/stop a set in dev mode)
 *   2. Save the JSON to __tests__/recordings/<name>.json
 *   3. Run `npm test` — it picks up the file automatically
 */

import * as fs from 'fs';
import * as path from 'path';
import { replayRecording } from './replayRunner';
import '../definitions/register';
import { ExerciseRegistry } from '../ExerciseRegistry';
import { parsePoseFrame, type RawPoseLandmark } from '../../pose/parsePoseFrame';
import { UNSCORED_REP_FEEDBACK } from '../shared/poseQuality';
import { createLandmarkRecordingFrame } from '../replay';
import type { ExerciseDefinition, ExerciseState } from '../types';
import type { LandmarkRecording } from './types';

const RECORDINGS_DIR = path.join(__dirname, 'recordings');

function discoverRecordings(): Array<{ filename: string; recording: LandmarkRecording }> {
  if (!fs.existsSync(RECORDINGS_DIR)) return [];
  return fs
    .readdirSync(RECORDINGS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(filename => ({
      filename,
      recording: JSON.parse(
        fs.readFileSync(path.join(RECORDINGS_DIR, filename), 'utf-8'),
      ) as LandmarkRecording,
    }));
}

const recordings = discoverRecordings();

function frame(timestamp: number, score: number): LandmarkRecording['frames'][number] {
  return {
    timestamp,
    keypoints: [{ name: 'left_shoulder', x: 0.5, y: 0.5, z: 0, score }],
  };
}

function rawLandmark(index: number, overrides: Partial<RawPoseLandmark> = {}): RawPoseLandmark {
  return {
    x: 0.1 + index * 0.01,
    y: 0.2 + index * 0.01,
    z: index * 0.001,
    visibility: 0.9,
    presence: 0.8,
    ...overrides,
  };
}

function rawLandmarks(overrides: Record<number, Partial<RawPoseLandmark>> = {}): RawPoseLandmark[] {
  return Array.from({ length: 33 }, (_, index) => rawLandmark(index, overrides[index]));
}

function replayTestDefinition(activeUntilFrame: number): ExerciseDefinition {
  return {
    name: 'Replay Quality Window Test',
    requiredView: 'any',
    qualityProfile: {
      exerciseName: 'Replay Quality Window Test',
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
      repQualityWindowActive: false,
      _internal: { frameIndex: 0 },
    }),
    update: (_keypoints, state) => {
      const internal = state._internal as { frameIndex: number };
      const frameIndex = internal.frameIndex + 1;
      const completed = frameIndex === activeUntilFrame + 1;
      return {
        ...state,
        repCount: completed ? 1 : 0,
        repQualityWindowActive: frameIndex >= 3 && frameIndex <= activeUntilFrame,
        lastRepResult: completed ? { repIndex: 1, score: 90, messages: [] } : null,
        debugInfo: { phase: frameIndex >= 3 && frameIndex <= activeUntilFrame ? 'ACTIVE' : 'REST' },
        _internal: { frameIndex },
      };
    },
    ttsConfig: { feedbackToIssue: {} },
    summaryConfig: {},
  };
}

describe('Replay quality windows', () => {
  it('creates v2 recording frames with primary source, frame context, and pose metadata', () => {
    const parsed = parsePoseFrame({
      timestampMs: 1234,
      landmarks: rawLandmarks({
        0: { visibility: undefined, presence: undefined },
        1: { visibility: 1.0, presence: 0.25 },
      }),
    });

    expect(parsed).not.toBeNull();
    const recordingFrame = createLandmarkRecordingFrame({
      parsedFrame: parsed!,
      timestamp: 0,
      frameContext: {
        silentGapMs: 1200,
        trackingInterrupted: true,
        reacquisitionFrameIndex: 0,
      },
    });

    expect(recordingFrame).toMatchObject({
      timestamp: 0,
      timestampMs: 1234,
      status: 'poseDetected',
      primarySource: 'image',
      frameContext: {
        silentGapMs: 1200,
        trackingInterrupted: true,
        reacquisitionFrameIndex: 0,
      },
    });
    expect(recordingFrame.keypoints[0].score).toBe(1.0);
    expect(recordingFrame.poseMetadata?.imageLandmarks?.[0]).toMatchObject({
      name: 'nose',
      visibility: null,
      presence: null,
      visibilityState: 'missing',
      presenceState: 'missing',
      scoreSource: 'default',
    });
    expect(recordingFrame.poseMetadata?.imageLandmarks?.[1]).toMatchObject({
      name: 'left_eye_inner',
      visibility: 1.0,
      presence: 0.25,
      visibilityState: 'present',
      presenceState: 'present',
      scoreSource: 'visibility',
    });
  });

  it('replays v2 recordings while recomputing frame gap context from timestamps', () => {
    const seenTrackingInterrupted: boolean[] = [];
    const definition: ExerciseDefinition = {
      ...replayTestDefinition(999),
      name: 'Replay V2 Compatibility Test',
      update: (_keypoints, state, frameContext) => {
        seenTrackingInterrupted.push(frameContext?.trackingInterrupted === true);
        const internal = state._internal as { frameIndex: number };
        return {
          ...state,
          _internal: { frameIndex: internal.frameIndex + 1 },
        };
      },
    };
    const recording: LandmarkRecording = {
      schemaVersion: 2,
      exerciseName: 'Replay V2 Compatibility Test',
      metadata: {},
      frames: [
        {
          ...frame(0, 0.99),
          status: 'poseDetected',
          primarySource: 'image',
          frameContext: { trackingInterrupted: true, silentGapMs: 5000 },
        },
        {
          ...frame(33, 0.99),
          status: 'poseDetected',
          primarySource: 'image',
          frameContext: { trackingInterrupted: true, silentGapMs: 5000 },
        },
      ],
    };

    const result = replayRecording(definition, recording);

    expect(result.finalRepCount).toBe(0);
    expect(seenTrackingInterrupted).toEqual([false, false]);
  });

  it('skips explicit v2 noPose and trackingLost frames during current replay', () => {
    const seen: Array<{ timestampMs: number | undefined; trackingInterrupted: boolean }> = [];
    const definition: ExerciseDefinition = {
      ...replayTestDefinition(999),
      name: 'Replay Lost Frame Compatibility Test',
      update: (_keypoints, state, frameContext) => {
        seen.push({
          timestampMs: frameContext?.timestampMs,
          trackingInterrupted: frameContext?.trackingInterrupted === true,
        });
        const internal = state._internal as { frameIndex: number };
        return {
          ...state,
          _internal: { frameIndex: internal.frameIndex + 1 },
        };
      },
    };
    const recording: LandmarkRecording = {
      schemaVersion: 2,
      exerciseName: 'Replay Lost Frame Compatibility Test',
      metadata: {},
      frames: [
        { ...frame(0, 0.99), status: 'poseDetected', primarySource: 'image' },
        { timestamp: 500, status: 'noPose', keypoints: [], primarySource: 'image' },
        { timestamp: 1000, status: 'trackingLost', keypoints: [], primarySource: 'image' },
        { ...frame(2001, 0.99), status: 'poseDetected', primarySource: 'image' },
      ],
    };

    replayRecording(definition, recording);

    expect(seen).toEqual([
      { timestampMs: 0, trackingInterrupted: false },
      { timestampMs: 2001, trackingInterrupted: true },
    ]);
  });

  it('passes image and world frame context into exercise updates', () => {
    const seen: Array<{
      keypointX: number;
      worldX: number | null;
      imageX: number | null;
      primarySource: string | null;
    }> = [];
    const definition: ExerciseDefinition = {
      ...replayTestDefinition(1),
      name: 'Replay Frame Context Test',
      qualityProfile: {
        exerciseName: 'Replay Frame Context Test',
        requiredView: 'any',
        requiredJoints: ['left_shoulder'],
        importantJoints: [],
        windowSize: 1,
      },
      update: (keypoints, state, frameContext) => {
        seen.push({
          keypointX: keypoints[0]?.x ?? NaN,
          worldX: frameContext?.worldKeypoints?.[0]?.x ?? null,
          imageX: frameContext?.imageKeypoints?.[0]?.x ?? null,
          primarySource: frameContext?.primarySource ?? null,
        });
        return state;
      },
    };
    const recording: LandmarkRecording = {
      exerciseName: 'Replay Frame Context Test',
      metadata: {},
      frames: [{
        timestamp: 0,
        keypoints: [{ name: 'left_shoulder', x: 2, y: 0, z: 0, score: 0.99 }],
        worldKeypoints: [{ name: 'left_shoulder', x: 2, y: 0, z: 0, score: 0.99 }],
        imageKeypoints: [{ name: 'left_shoulder', x: 0.5, y: 0.5, z: 0, score: 0.99 }],
      }],
    };

    replayRecording(definition, recording);

    expect(seen).toEqual([{
      keypointX: 2,
      worldX: 2,
      imageX: 0.5,
      primarySource: 'world',
    }]);
  });

  it('uses image as replay primary source when only image landmarks are present', () => {
    const seen: Array<{
      worldX: number | null;
      imageX: number | null;
      primarySource: string | null;
    }> = [];
    const definition: ExerciseDefinition = {
      ...replayTestDefinition(1),
      name: 'Replay Image Context Test',
      qualityProfile: {
        exerciseName: 'Replay Image Context Test',
        requiredView: 'any',
        requiredJoints: ['left_shoulder'],
        importantJoints: [],
        windowSize: 1,
      },
      update: (_keypoints, state, frameContext) => {
        seen.push({
          worldX: frameContext?.worldKeypoints?.[0]?.x ?? null,
          imageX: frameContext?.imageKeypoints?.[0]?.x ?? null,
          primarySource: frameContext?.primarySource ?? null,
        });
        return state;
      },
    };
    const recording: LandmarkRecording = {
      exerciseName: 'Replay Image Context Test',
      metadata: {},
      frames: [{
        timestamp: 0,
        keypoints: [{ name: 'left_shoulder', x: 0.5, y: 0.5, z: 0, score: 0.99 }],
        imageKeypoints: [{ name: 'left_shoulder', x: 0.5, y: 0.5, z: 0, score: 0.99 }],
      }],
    };

    replayRecording(definition, recording);

    expect(seen).toEqual([{
      worldX: null,
      imageX: 0.5,
      primarySource: 'image',
    }]);
  });

  it('ignores low-confidence setup frames before an active rep window', () => {
    const recording: LandmarkRecording = {
      exerciseName: 'Replay Quality Window Test',
      metadata: {},
      frames: [
        frame(0, 0),
        frame(33, 0),
        frame(66, 0.99),
        frame(99, 0.99),
        frame(132, 0.99),
      ],
    };

    const result = replayRecording(replayTestDefinition(4), recording, { confidenceGating: true });

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(true);
    expect(result.feedbackMessages).toEqual([]);
  });

  it('uses the shared unscored message for low-confidence active reps', () => {
    const recording: LandmarkRecording = {
      exerciseName: 'Replay Quality Window Test',
      metadata: {},
      frames: Array.from({ length: 14 }, (_, index) => frame(index * 33, index < 2 ? 0.99 : 0)),
    };

    const result = replayRecording(replayTestDefinition(13), recording, { confidenceGating: true });

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.feedbackMessages[0]).toContain(UNSCORED_REP_FEEDBACK);
  });

  it('preserves exercise-provided unscorable reps and quality warnings', () => {
    const definition: ExerciseDefinition = {
      ...replayTestDefinition(4),
      update: (_keypoints, state) => {
        const internal = state._internal as { frameIndex: number };
        const frameIndex = internal.frameIndex + 1;
        const completed = frameIndex === 5;
        return {
          ...state,
          repCount: completed ? 1 : 0,
          repQualityWindowActive: frameIndex >= 3 && frameIndex <= 4,
          lastRepResult: completed
            ? {
                repIndex: 1,
                score: 90,
                messages: [],
                scorable: false,
                qualityWarnings: ['side_view_uncertain'],
              }
            : null,
          debugInfo: { phase: frameIndex >= 3 && frameIndex <= 4 ? 'ACTIVE' : 'REST' },
          _internal: { frameIndex },
        };
      },
    };
    const recording: LandmarkRecording = {
      exerciseName: 'Replay Quality Window Test',
      metadata: {},
      frames: Array.from({ length: 5 }, (_, index) => frame(index * 33, 0.99)),
    };

    const result = replayRecording(definition, recording, { confidenceGating: true });

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0].scorable).toBe(false);
    expect(result.reps[0].qualityWarnings).toContain('side_view_uncertain');
    expect(result.feedbackMessages[0]).toContain('Turn side-on so I can judge your form.');
  });
});

if (recordings.length === 0) {
  describe('Replay Tests', () => {
    it('no recordings found — add JSON files to __tests__/recordings/', () => {
      // Placeholder so Jest doesn't report an empty suite
    });
  });
} else {
  describe.each(recordings)('$filename', ({ recording }) => {
    const definition = ExerciseRegistry.get(recording.exerciseName);

    if (!definition) {
      it(`should have a registered definition for "${recording.exerciseName}"`, () => {
        throw new Error(
          `No ExerciseDefinition found for "${recording.exerciseName}". ` +
          `Is it registered in definitions/register.ts?`,
        );
      });
      return;
    }

    it('counts the expected number of reps', () => {
      const result = replayRecording(definition, recording);
      expect(result.finalRepCount).toBe(recording.metadata.expectedReps);
    });

    it('scores within the expected range', () => {
      const [minScore, maxScore] = recording.metadata.expectedScoreRange ?? [0, 100];
      const result = replayRecording(definition, recording);
      result.repScores.forEach(score => {
        expect(score).toBeGreaterThanOrEqual(minScore);
        expect(score).toBeLessThanOrEqual(maxScore);
      });
    });
  });
}
