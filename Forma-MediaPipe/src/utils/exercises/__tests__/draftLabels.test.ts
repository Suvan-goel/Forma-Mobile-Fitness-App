import { createDraftLabelFromReplay, getAvailableIssues } from '../dataset';
import { barbellCurlDefinition } from '../definitions/barbellCurl';
import { cableRowDefinition } from '../definitions/cableRow';
import { lateralRaiseDefinition } from '../definitions/lateralRaise';
import { legExtensionsDefinition } from '../definitions/legExtensions';
import { pushupDefinition } from '../definitions/pushup';
import { squatDefinition } from '../definitions/squat';
import type { ExerciseDefinition, RepDiagnostics } from '../types';
import type { LandmarkRecording, ReplayResultVerbose } from '../replay';

const definition: ExerciseDefinition = {
  name: 'Demo Exercise',
  requiredView: 'any',
  createState: () => ({
    repCount: 0,
    lastRepResult: null,
    feedback: null,
    feedbackTimestamp: null,
    debugInfo: {},
    _internal: {},
  }),
  update: (_, state) => state,
  ttsConfig: {
    feedbackToIssue: {
      'Go deeper.': 'depth_short',
      'Try to go deeper.': 'depth_short',
      'Stay upright.': 'torso_warn',
    },
  },
  summaryConfig: {},
};

const recording: LandmarkRecording = {
  exerciseName: 'Demo Exercise',
  metadata: { recordedAt: '2026-01-01T00:00:00.000Z' },
  frames: [
    { timestamp: 0, keypoints: [] },
    { timestamp: 500, keypoints: [] },
  ],
};

const replay: ReplayResultVerbose = {
  finalRepCount: 1,
  repScores: [88],
  feedbackMessages: ['Go deeper.'],
  reps: [
    {
      repIndex: 1,
      score: 88,
      messages: ['Go deeper.'],
      issueIds: ['demo-exercise.depth_short'],
      startedAt: 0,
      completedAt: 500,
    },
  ],
  frameTraces: [],
  fsmTransitions: [],
  repTraces: [
    {
      repIndex: 1,
      score: 88,
      messages: ['Go deeper.'],
      issueIds: ['demo-exercise.depth_short'],
      startedAt: 0,
      completedAt: 500,
      transitions: [
        {
          frameIndex: 1,
          timestamp: 125,
          fromPhase: 'REST',
          toPhase: 'WORKING',
          angles: {},
        },
      ],
    },
  ],
};

describe('draft label generation', () => {
  it('creates draft labels with rep timing and suggestions only', () => {
    const label = createDraftLabelFromReplay({
      definition,
      recording,
      replay,
      sourceVideo: 'videos/demo/demo_001.mp4',
      landmarkFile: 'landmarks/demo/demo_001.json',
      split: 'train',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
    });

    expect(label).toMatchObject({
      reviewStatus: 'draft',
      expectedReps: 1,
      reps: [
        {
          index: 1,
          startMs: 125,
          endMs: 500,
          issueIds: [],
          view: 'unknown',
          scorable: true,
          suggestedIssueIds: ['demo-exercise.depth_short'],
          suggestedFeedbackMessages: ['Go deeper.'],
          suggestedScore: 88,
        },
      ],
    });
    expect(label.availableIssues).toEqual([
      { issueId: 'demo-exercise.depth_short', feedbackMessage: 'Go deeper.' },
      { issueId: 'demo-exercise.torso_warn', feedbackMessage: 'Stay upright.' },
    ]);
    expect(label.draftMetadata).toEqual({
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
      source: 'heuristic-replay',
    });
  });

  it('lists each available issue id once with a representative feedback message', () => {
    expect(getAvailableIssues(definition)).toEqual([
      { issueId: 'demo-exercise.depth_short', feedbackMessage: 'Go deeper.' },
      { issueId: 'demo-exercise.torso_warn', feedbackMessage: 'Stay upright.' },
    ]);
  });

  it('adds Barbell Curl multi-view labeling guidance to draft labels', () => {
    const label = createDraftLabelFromReplay({
      definition: barbellCurlDefinition,
      recording: {
        ...recording,
        exerciseName: 'Barbell Curl',
      },
      replay,
      sourceVideo: 'videos/barbell-curl/barbell_curl_001.mp4',
      landmarkFile: 'landmarks/barbell-curl/barbell_curl_001.json',
      split: 'train',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
    });

    expect(label.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Front-view Barbell Curl reps are full-form labels'),
        expect.stringContaining('Side/oblique Barbell Curl reps are limited-signal fallback labels'),
        expect.stringContaining('do not treat missing asymmetry or elbow-flare cues as clean negatives'),
      ]),
    );
  });

  it('adds Push-Up labeling guidance to draft labels', () => {
    const label = createDraftLabelFromReplay({
      definition: pushupDefinition,
      recording: {
        ...recording,
        exerciseName: 'Push-Up',
      },
      replay,
      sourceVideo: 'videos/push-up/pushup_001.mp4',
      landmarkFile: 'landmarks/push-up/pushup_001.json',
      split: 'train',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
    });

    expect(label.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Standard side-view floor push-ups are the target scope'),
        expect.stringContaining('use scorable=false when the view, full body, or form-critical landmarks are not judgeable'),
        expect.stringContaining('Use push-up.depth_short or push-up.lockout_short'),
        expect.stringContaining('Use push-up.incomplete_rom only as the fallback ROM issue'),
        expect.stringContaining('do not treat unobservable cues as clean negatives'),
      ]),
    );
  });

  it('adds side-view Barbell Squat labeling guidance to draft labels', () => {
    const label = createDraftLabelFromReplay({
      definition: squatDefinition,
      recording: {
        ...recording,
        exerciseName: 'Barbell Squat',
      },
      replay,
      sourceVideo: 'videos/barbell-squat/squat_001.mp4',
      landmarkFile: 'landmarks/barbell-squat/squat_001.json',
      split: 'train',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
    });

    expect(label.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Side-view Barbell Squat reps are the v1 full-form scoring target'),
        expect.stringContaining('mark them scorable=false and do not label clean negatives'),
        expect.stringContaining('Use barbell-squat.incomplete_rom only as the fallback ROM issue'),
        expect.stringContaining('Do not label knee valgus in v1'),
      ]),
    );
    expect(label.availableIssues?.map((issue) => issue.issueId) ?? []).not.toContain('barbell-squat.knee_valgus');
  });

  it('adds side-view Cable Row labeling guidance to draft labels', () => {
    const label = createDraftLabelFromReplay({
      definition: cableRowDefinition,
      recording: {
        ...recording,
        exerciseName: 'Cable Row',
      },
      replay,
      sourceVideo: 'videos/cable-row/cable_row_001.mp4',
      landmarkFile: 'landmarks/cable-row/cable_row_001.json',
      split: 'train',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
    });

    expect(label.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Side-view Cable Row reps are the v1 full-form scoring target'),
        expect.stringContaining('mark them scorable=false and do not label clean negatives'),
        expect.stringContaining('Label row depth, extension, shoulder retraction'),
        expect.stringContaining('Do not label row-target height, hold, or velocity diagnostics'),
      ]),
    );
    expect(label.reps[0]?.view).toBe('unknown');
    expect(label.reps[0]?.scorable).toBe(true);
    expect(label.availableIssues?.map((issue) => issue.issueId) ?? []).not.toContain('cable-row.row_target_high');
  });

  it('adds side-view Leg Extensions labeling guidance and inferred rep metadata to draft labels', () => {
    const diagnostics: RepDiagnostics = {
      exerciseName: 'Leg Extensions',
      repIndex: 1,
      view: 'side',
      selectedSide: 'left',
      scorable: true,
      metrics: {},
      cues: {},
    };
    const legExtensionReplay: ReplayResultVerbose = {
      ...replay,
      repTraces: replay.repTraces.map(trace => ({
        ...trace,
        diagnostics,
        scorable: true,
      })),
    };
    const label = createDraftLabelFromReplay({
      definition: legExtensionsDefinition,
      recording: {
        ...recording,
        exerciseName: 'Leg Extensions',
      },
      replay: legExtensionReplay,
      sourceVideo: 'videos/leg-extensions/leg_extension_001.mp4',
      landmarkFile: 'landmarks/leg-extensions/leg_extension_001.json',
      split: 'train',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
    });

    expect(label.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Side-view Leg Extensions reps are the v1 full-form scoring target'),
        expect.stringContaining('mark them scorable=false and do not label clean negatives'),
        expect.stringContaining('Label lockout, bottom range, hip lift, torso movement, top hold, and tempo'),
        expect.stringContaining('Reviewed scorable Leg Extensions reps must use view=side'),
      ]),
    );
    expect(label.reps[0]?.view).toBe('side');
    expect(label.reps[0]?.scorable).toBe(true);
  });

  it('adds front-view lateral-raise labeling guidance to draft labels', () => {
    const label = createDraftLabelFromReplay({
      definition: lateralRaiseDefinition,
      recording: {
        ...recording,
        exerciseName: 'Standing Dumbbell Lateral Raises',
      },
      replay,
      sourceVideo: 'videos/standing-dumbbell-lateral-raises/lateral_raise_001.mp4',
      landmarkFile: 'landmarks/standing-dumbbell-lateral-raises/lateral_raise_001.json',
      split: 'train',
      generatedAt: '2026-01-01T00:00:00.000Z',
      generator: 'test',
    });

    expect(label.labelingGuidance).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Front-view Standing Dumbbell Lateral Raises are the v1 full-form scoring target'),
        expect.stringContaining('mark them scorable=false and do not label clean negatives'),
        expect.stringContaining('do not count tiny pulses'),
        expect.stringContaining('note the visible subcause'),
        expect.stringContaining('Reviewed scorable Standing Dumbbell Lateral Raises reps must use view=front'),
      ]),
    );
  });
});
