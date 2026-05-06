import { createDraftLabelFromReplay, getAvailableIssues } from '../dataset';
import type { ExerciseDefinition } from '../types';
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
});
