import type { Keypoint } from '../../poseAnalysis';
import type { DatasetCase } from '../dataset';
import { evaluateCase } from '../dataset';
import {
  buildMlDataset,
  buildMlRepExamples,
  mlExampleToCsvRow,
} from '../ml';
import { replayRecordingVerbose, type LandmarkRecording, type ReplayResultVerbose } from '../replay';
import type { ExerciseDefinition, ExerciseState, RepDiagnostics } from '../types';

const requiredJointNames = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

function keypoints(wristX: number): Keypoint[] {
  return requiredJointNames.map((name, index) => ({
    name,
    x: name === 'left_wrist' ? wristX : 0.2 + index * 0.01,
    y: 0.3 + index * 0.01,
    z: 0.1 + index * 0.01,
    score: 0.99,
  }));
}

const depthDiagnostics: RepDiagnostics = {
  exerciseName: 'Demo Exercise',
  repIndex: 1,
  view: 'side',
  selectedSide: 'left',
  scorable: true,
  metrics: {
    depthRatio: {
      key: 'depthRatio',
      value: 0.82,
      unit: 'ratio',
      eligible: true,
      confidence: 0.93,
      sampleCount: 6,
    },
  },
  cues: {
    'demo-exercise.depth_short': {
      issueId: 'demo-exercise.depth_short',
      metricKeys: ['depthRatio'],
      triggered: true,
      eligible: true,
      direction: 'above',
      thresholdPath: 'formThresholds.DEPTH_WARN',
      thresholdValue: 0.75,
      margin: 0.07,
      support: 6,
    },
  },
};

const recording: LandmarkRecording = {
  exerciseName: 'Demo Exercise',
  metadata: {
    recordedAt: '2026-01-01T00:00:00.000Z',
    modelName: 'pose_landmarker_heavy',
    fps: 30,
  },
  frames: [
    { timestamp: 0, keypoints: keypoints(0.1), worldKeypoints: keypoints(0.1) },
    { timestamp: 500, keypoints: keypoints(0.8), worldKeypoints: keypoints(0.8) },
    { timestamp: 1000, keypoints: keypoints(0.9), worldKeypoints: keypoints(0.9) },
  ],
};

const datasetCase: DatasetCase = {
  label: {
    schemaVersion: 1,
    exerciseName: 'Demo Exercise',
    sourceVideo: 'videos/demo.mp4',
    landmarkFile: 'landmarks/demo.json',
    split: 'train',
    reviewStatus: 'reviewed',
    expectedReps: 1,
    reps: [
      {
        index: 1,
        startMs: 0,
        endMs: 1000,
        issueIds: ['demo-exercise.depth_short'],
        view: 'side',
        scorable: true,
      },
    ],
    captureMetadata: {
      cameraView: 'side',
      cameraSide: 'left',
    },
  },
  recording,
  labelPath: '/tmp/demo-label.json',
  recordingPath: '/tmp/demo-recording.json',
};

const definition: ExerciseDefinition = {
  name: 'Demo Exercise',
  requiredView: 'any',
  tunedConfigPath: 'src/utils/exercises/definitions/tuned/demo.json',
  createState: (): ExerciseState => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: { phase: 'START' },
    repQualityWindowActive: true,
    _internal: { completed: false },
  }),
  update: (frameKeypoints, state): ExerciseState => {
    const internal = state._internal as { completed: boolean };
    if (internal.completed || (frameKeypoints.find((keypoint) => keypoint.name === 'left_wrist')?.x ?? 0) <= 0.5) {
      return state;
    }
    internal.completed = true;
    return {
      ...state,
      repCount: 1,
      lastRepResult: {
        repIndex: 1,
        score: 82,
        messages: ['Go deeper.'],
        issueIds: ['demo-exercise.depth_short'],
        diagnostics: depthDiagnostics,
        scorable: true,
      },
      feedback: 'Go deeper.',
      feedbackTimestamp: Date.now(),
      debugInfo: { phase: 'DONE' },
      _internal: internal,
    };
  },
  ttsConfig: {
    feedbackToIssue: {
      'Go deeper.': 'depth_short',
    },
  },
  summaryConfig: {},
};

describe('ML rep dataset export', () => {
  it('builds one ML example per matched labelled rep with diagnostics and features', () => {
    const replay: ReplayResultVerbose = replayRecordingVerbose(definition, recording, {
      confidenceGating: true,
    });
    const evaluation = evaluateCase(datasetCase, replay);
    const result = buildMlRepExamples({
      definition,
      datasetCase,
      replay,
      caseEvaluation: evaluation,
      labelFile: datasetCase.labelPath,
      recordingFile: datasetCase.recordingPath,
      heuristicConfigVersion: 'demo-config',
    });

    expect(result.skippedMissingMatchedPrediction).toBe(0);
    expect(result.examples).toHaveLength(1);
    expect(result.examples[0]).toMatchObject({
      exerciseName: 'Demo Exercise',
      exerciseSlug: 'demo-exercise',
      split: 'train',
      repIndex: 1,
      labels: {
        issueIds: ['demo-exercise.depth_short'],
        clean: false,
        scorable: true,
        view: 'side',
      },
      heuristic: {
        issueIds: ['demo-exercise.depth_short'],
        score: 82,
        scorable: true,
      },
      metadata: {
        heuristicConfigVersion: 'demo-config',
        poseModelName: 'pose_landmarker_heavy',
      },
    });
    expect(result.examples[0].features['diagnostic.metric.depthratio.value']).toBe(0.82);
    expect(result.examples[0].features['diagnostic.cue.demo_exercise_depth_short.margin']).toBe(0.07);
    expect(result.examples[0].features['landmark.left_wrist.x.range']).toBeGreaterThan(0);
    expect(result.examples[0].features['kinematic.left_wrist.velocity.max']).toBeGreaterThan(0);
  });

  it('builds a manifest and CSV-ready rows without changing replay output contracts', () => {
    const result = buildMlDataset({
      exerciseName: definition.name,
      definition,
      cases: [datasetCase],
      datasetRoot: 'datasets/form-heuristics',
      includeDrafts: false,
      discoveredLabelFiles: 1,
      outputs: {
        jsonl: 'datasets/form-heuristics/ml/demo-exercise/rep_examples.jsonl',
        csv: 'datasets/form-heuristics/ml/demo-exercise/features.csv',
        manifest: 'datasets/form-heuristics/ml/demo-exercise/manifest.json',
      },
      generatedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(result.examples).toHaveLength(1);
    expect(result.manifest).toMatchObject({
      exerciseName: 'Demo Exercise',
      exerciseSlug: 'demo-exercise',
      includeDrafts: false,
      counts: {
        discoveredLabelFiles: 1,
        loadedCases: 1,
        exportedExamples: 1,
      },
      issueCounts: {
        'demo-exercise.depth_short': 1,
      },
      labelColumns: {
        'demo-exercise.depth_short': 'label_issue__demo_exercise_depth_short',
      },
    });
    expect(result.manifest.featureNames).toContain('heuristic.score');

    const row = mlExampleToCsvRow(
      result.examples[0],
      result.manifest.featureNames,
      result.manifest.labelColumns,
      Object.keys(result.manifest.issueCounts),
    );
    expect(row.label_issue__demo_exercise_depth_short).toBe(1);
    expect(row.heuristic_issue__demo_exercise_depth_short).toBe(1);
    expect(row['feature__heuristic.score']).toBe(82);
  });
});
