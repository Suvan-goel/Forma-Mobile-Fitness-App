import { barbellCurlDefinition } from '../definitions/barbellCurl';
import { replayRecording, replayRecordingVerbose } from './replayRunner';
import type { LandmarkRecording } from './types';
import type { Keypoint } from '../../poseAnalysis';

type CurlView = 'front' | 'side-left' | 'side-right' | 'oblique-left' | 'oblique-right';
type WristStyle = 'neutral' | 'curled';
type FrameValue<T> = T | ((index: number) => T);

const EXTENDED_WRIST_Y = 0.6;
const TOP_WRIST_Y = 1.2;
const PULSE_WRIST_Y = 0.78;
const HALF_WRIST_Y = 1.08;
const FRAME_MS = 50;

function kp(name: string, x: number, y: number, z: number, score = 0.99): Keypoint {
  return { name, x, y, z, score };
}

function frameValue<T>(value: FrameValue<T> | undefined, index: number, fallback: T): T {
  if (typeof value === 'function') return (value as (index: number) => T)(index);
  return value ?? fallback;
}

function sideGeometry(view: CurlView) {
  switch (view) {
    case 'side-left':
      return {
        leftX: -0.035,
        rightX: 0.035,
        leftZ: -0.25,
        rightZ: 0.25,
        visibleArm: 'left' as const,
      };
    case 'side-right':
      return {
        leftX: -0.035,
        rightX: 0.035,
        leftZ: 0.25,
        rightZ: -0.25,
        visibleArm: 'right' as const,
      };
    case 'oblique-left':
      return {
        leftX: -0.13,
        rightX: 0.13,
        leftZ: -0.18,
        rightZ: 0.18,
        visibleArm: 'left' as const,
      };
    case 'oblique-right':
      return {
        leftX: -0.13,
        rightX: 0.13,
        leftZ: 0.18,
        rightZ: -0.18,
        visibleArm: 'right' as const,
      };
    case 'front':
    default:
      return {
        leftX: -0.22,
        rightX: 0.22,
        leftZ: 0,
        rightZ: 0,
        visibleArm: 'both' as const,
      };
  }
}

function armKeypoints(
  side: 'left' | 'right',
  x: number,
  z: number,
  wristY: number,
  visible: boolean,
  wristStyle: WristStyle,
  elbowOffset: number,
  elbowZOffset: number,
  indexScore: number,
  jointScore?: number,
  shoulderScore = 0.99,
  hipScore = 0.99,
): Keypoint[] {
  const score = visible ? (jointScore ?? 0.99) : 0.05;
  const shoulderY = 1.4;
  const elbowY = 1.0;
  const elbowX = x + (side === 'left' ? -elbowOffset : elbowOffset);
  const elbowZ = z + elbowZOffset;
  const indexY = wristY + (wristY - elbowY) * 0.2;
  const indexX = wristStyle === 'curled'
    ? x + (side === 'left' ? -0.18 : 0.18)
    : x;
  const effectiveIndexScore = visible ? indexScore : 0.05;

  return [
    kp(`${side}_shoulder`, x, shoulderY, z, shoulderScore),
    kp(`${side}_elbow`, elbowX, elbowY, elbowZ, score),
    kp(`${side}_wrist`, x, wristY, z, score),
    kp(`${side}_index`, indexX, indexY, z, effectiveIndexScore),
    kp(`${side}_hip`, x, 0.5, z, hipScore),
  ];
}

function makeFrame(
  timestamp: number,
  wristY: number,
  view: CurlView,
  wristStyle: WristStyle,
  index: number,
  options: {
    elbowOffset?: FrameValue<number>;
    indexScore?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording['frames'][number] {
  return makeDualFrame(timestamp, wristY, wristY, view, wristStyle, index, options);
}

function makeDualFrame(
  timestamp: number,
  leftWristY: number,
  rightWristY: number,
  view: CurlView,
  wristStyle: WristStyle,
  index: number,
  options: {
    elbowOffset?: FrameValue<number>;
    indexScore?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording['frames'][number] {
  const geom = sideGeometry(view);
  const leftVisible = geom.visibleArm === 'both' || geom.visibleArm === 'left';
  const rightVisible = geom.visibleArm === 'both' || geom.visibleArm === 'right';
  const elbowOffset = frameValue(options.elbowOffset, index, 0);
  const indexScore = frameValue(options.indexScore, index, 0.99);
  const leftScore = frameValue(options.leftScore, index, 0.99);
  const rightScore = frameValue(options.rightScore, index, 0.99);
  const leftElbowZOffset = frameValue(options.leftElbowZOffset, index, 0);
  const rightElbowZOffset = frameValue(options.rightElbowZOffset, index, 0);
  const leftShoulderScore = frameValue(options.leftShoulderScore, index, 0.99);
  const rightShoulderScore = frameValue(options.rightShoulderScore, index, 0.99);
  const leftHipScore = frameValue(options.leftHipScore, index, 0.99);
  const rightHipScore = frameValue(options.rightHipScore, index, 0.99);

  return {
    timestamp,
    keypoints: [
      kp('nose', 0, 1.72, -0.05, 0.99),
      ...armKeypoints('left', geom.leftX, geom.leftZ, leftWristY, leftVisible, wristStyle, elbowOffset, leftElbowZOffset, indexScore, leftScore, leftShoulderScore, leftHipScore),
      ...armKeypoints('right', geom.rightX, geom.rightZ, rightWristY, rightVisible, wristStyle, elbowOffset, rightElbowZOffset, indexScore, rightScore, rightShoulderScore, rightHipScore),
    ],
  };
}

function buildRecording(
  description: string,
  wristPath: number[],
  view: CurlView = 'front',
  options: {
    wristStyle?: WristStyle | ((index: number) => WristStyle);
    elbowOffset?: FrameValue<number>;
    indexScore?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording {
  const { wristStyle = 'neutral', elbowOffset, indexScore, leftScore, rightScore, leftElbowZOffset, rightElbowZOffset, leftShoulderScore, rightShoulderScore, leftHipScore, rightHipScore } = options;

  return {
    exerciseName: 'Barbell Curl',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (wristPath.length * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: wristPath.map((wristY, index) => {
      const frameWristStyle = typeof wristStyle === 'function' ? wristStyle(index) : wristStyle;
      return makeFrame(index * FRAME_MS, wristY, view, frameWristStyle, index, {
        elbowOffset,
        indexScore,
        leftScore,
        rightScore,
        leftElbowZOffset,
        rightElbowZOffset,
        leftShoulderScore,
        rightShoulderScore,
        leftHipScore,
        rightHipScore,
      });
    }),
  };
}

function buildDualRecording(
  description: string,
  leftWristPath: number[],
  rightWristPath: number[],
  view: CurlView = 'front',
  options: {
    wristStyle?: WristStyle | ((index: number) => WristStyle);
    elbowOffset?: FrameValue<number>;
    indexScore?: FrameValue<number>;
    leftScore?: FrameValue<number>;
    rightScore?: FrameValue<number>;
    leftElbowZOffset?: FrameValue<number>;
    rightElbowZOffset?: FrameValue<number>;
    leftShoulderScore?: FrameValue<number>;
    rightShoulderScore?: FrameValue<number>;
    leftHipScore?: FrameValue<number>;
    rightHipScore?: FrameValue<number>;
  } = {},
): LandmarkRecording {
  const { wristStyle = 'neutral', elbowOffset, indexScore, leftScore, rightScore, leftElbowZOffset, rightElbowZOffset, leftShoulderScore, rightShoulderScore, leftHipScore, rightHipScore } = options;
  const frameCount = Math.max(leftWristPath.length, rightWristPath.length);

  return {
    exerciseName: 'Barbell Curl',
    metadata: {
      recordedAt: '2026-04-29T00:00:00.000Z',
      duration: (frameCount * FRAME_MS) / 1000,
      description,
      expectedReps: 0,
      expectedScoreRange: [0, 100],
    },
    frames: Array.from({ length: frameCount }, (_, index) => {
      const frameWristStyle = typeof wristStyle === 'function' ? wristStyle(index) : wristStyle;
      return makeDualFrame(
        index * FRAME_MS,
        leftWristPath[index] ?? EXTENDED_WRIST_Y,
        rightWristPath[index] ?? EXTENDED_WRIST_Y,
        view,
        frameWristStyle,
        index,
        { elbowOffset, indexScore, leftScore, rightScore, leftElbowZOffset, rightElbowZOffset, leftShoulderScore, rightShoulderScore, leftHipScore, rightHipScore },
      );
    }),
  };
}

function interpolate(from: number, to: number, frames: number): number[] {
  return Array.from({ length: frames }, (_, index) => {
    const p = frames <= 1 ? 1 : index / (frames - 1);
    return from + (to - from) * p;
  });
}

function fullRepPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(4).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function pulsePath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, PULSE_WRIST_Y, 10),
    ...interpolate(PULSE_WRIST_Y, EXTENDED_WRIST_Y, 10),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function fastLoweringPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
    ...Array(20).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 3),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function fastCurlUpPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 2),
    ...Array(20).fill(TOP_WRIST_Y),
    ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function halfRepPath(): number[] {
  return [
    ...Array(16).fill(EXTENDED_WRIST_Y),
    ...interpolate(EXTENDED_WRIST_Y, HALF_WRIST_Y, 16),
    ...interpolate(HALF_WRIST_Y, EXTENDED_WRIST_Y, 18),
    ...Array(8).fill(EXTENDED_WRIST_Y),
  ];
}

function mirrorFrontRecording(recording: LandmarkRecording): LandmarkRecording {
  return {
    ...recording,
    metadata: {
      ...recording.metadata,
      description: `${recording.metadata.description} mirrored`,
    },
    frames: recording.frames.map(frame => ({
      ...frame,
      keypoints: frame.keypoints.map(point => ({ ...point, x: -point.x })),
    })),
  };
}

function recordingWithExplicitSources(
  worldRecording: LandmarkRecording,
  imageRecording: LandmarkRecording,
  description: string,
): LandmarkRecording {
  return {
    ...worldRecording,
    metadata: {
      ...worldRecording.metadata,
      description,
    },
    frames: worldRecording.frames.map((worldFrame, index) => {
      const imageFrame = imageRecording.frames[index] ?? worldFrame;
      return {
        timestamp: worldFrame.timestamp,
        keypoints: imageFrame.keypoints,
        imageKeypoints: imageFrame.keypoints,
        worldKeypoints: worldFrame.keypoints,
      };
    }),
  };
}

describe('Barbell Curl synthetic replay coverage', () => {
  it('counts a clean front-facing full rep', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean front curl', fullRepPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
    expect(result.feedbackMessages).toEqual([]);
    expect(result.reps[0]?.diagnostics?.metrics.landmarkSource.label).toBe('image');
    expect(result.reps[0]?.diagnostics?.metrics.ratioDistanceMode.label).toBe('image_2d');
    expect(result.reps[0]?.diagnostics?.metrics.torsoAnchorSource.label).toBe('nose');
    expect(result.reps[0]?.diagnostics?.metrics.viewAngleDeg.value).toBeGreaterThanOrEqual(0);
    expect(result.reps[0]?.diagnostics?.metrics.smoothedViewAngleDeg.value).toBeGreaterThanOrEqual(0);
    expect(result.reps[0]?.diagnostics?.metrics.viewSupportRatio.value).toBeGreaterThan(0);
    expect(result.reps[0]?.diagnostics?.metrics.rawLeftMinCurlRatio.value).toBeLessThan(0.6);
    expect(result.reps[0]?.diagnostics?.metrics.leftValidSamples.value).toBeGreaterThan(0);
    expect(result.reps[0]?.diagnostics?.metrics.leftShoulderDelta).toBeDefined();
    expect(result.reps[0]?.diagnostics?.metrics.rightShoulderDelta).toBeDefined();
    expect(result.reps[0]?.diagnostics?.metrics.primaryShoulderDelta).toBeDefined();
    expect(result.reps[0]?.diagnostics?.viewQuality?.frontishConfirmed).toBe(true);
  });

  it('uses explicit world landmarks for curl ratios when image landmarks diverge', () => {
    const worldRecording = buildRecording('synthetic world clean front curl', fullRepPath(), 'front');
    const divergentImageRecording = buildRecording('synthetic image pulse only curl', pulsePath(), 'front');
    const result = replayRecording(
      barbellCurlDefinition,
      recordingWithExplicitSources(worldRecording, divergentImageRecording, 'world overrides divergent image ratios'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.metrics.landmarkSource.label).toBe('world');
    expect(result.reps[0]?.diagnostics?.metrics.ratioDistanceMode.label).toBe('world_3d');
    expect(result.reps[0]?.diagnostics?.metrics.rawLeftMinCurlRatio.value).toBeLessThan(0.6);
  });

  it('counts the same front-facing rep when horizontally mirrored', () => {
    const recording = buildRecording('synthetic clean front curl', fullRepPath(), 'front');
    const result = replayRecording(barbellCurlDefinition, mirrorFrontRecording(recording));

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeGreaterThanOrEqual(85);
  });

  it.each<CurlView>(['side-left', 'side-right'])(
    'counts a clean full rep from %s view using the visible arm',
    view => {
      const result = replayRecording(
        barbellCurlDefinition,
        buildRecording(`synthetic clean ${view} curl`, fullRepPath(), view),
      );

      expect(result.finalRepCount).toBe(1);
      expect(result.repScores[0]).toBeGreaterThanOrEqual(80);
      expect(result.reps[0]?.diagnostics?.metrics.ratioDistanceMode.label).toBe('image_2d');
    },
  );

  it('counts a clean oblique rep from the visible primary arm and keeps front-only cues ineligible', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean oblique-left curl', fullRepPath(), 'oblique-left'),
    );
    const cues = result.reps[0]?.diagnostics?.cues;

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.view).toBe('oblique');
    expect(cues?.['barbell-curl.asymmetry']).toMatchObject({
      eligible: false,
      skippedReason: 'not_front_view',
    });
    expect(cues?.['barbell-curl.elbow_flare']).toMatchObject({
      eligible: false,
      skippedReason: 'not_front_view',
    });
  });

  it.each<CurlView>(['side-left', 'side-right'])(
    'flags shoulder involvement from %s using the primary side',
    view => {
      const clean = replayRecording(
        barbellCurlDefinition,
        buildRecording(`synthetic clean ${view} curl`, fullRepPath(), view),
      );
      const involved = replayRecording(
        barbellCurlDefinition,
        buildRecording(`synthetic shoulder involvement ${view} curl`, fullRepPath(), view, {
          elbowOffset: index => (index >= 20 && index <= 48 ? 1.0 : 0),
        }),
      );

      expect(involved.finalRepCount).toBe(1);
      expect(involved.repScores[0]).toBeLessThan(clean.repScores[0]);
      expect(involved.feedbackMessages).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/shoulder involvement|Upper arms moving/),
        ]),
      );
      expect(involved.reps[0]?.diagnostics?.metrics.primaryShoulderDelta.value).toBeGreaterThan(
        clean.reps[0]?.diagnostics?.metrics.primaryShoulderDelta.value ?? 0,
      );
      expect(involved.reps[0]?.diagnostics?.cues['barbell-curl.shoulder_warn'].eligible).toBe(true);
    },
  );

  it('marks side shoulder cue ineligible when primary shoulder samples are unavailable', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic side-left missing shoulder samples curl', fullRepPath(), 'side-left', {
        rightShoulderScore: index => (index < 16 ? 0.99 : 0.05),
      }),
    );
    const shoulderCue = result.reps[0]?.diagnostics?.cues['barbell-curl.shoulder_warn'];

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.diagnostics?.metrics.primaryShoulderDelta.eligible).toBe(false);
    expect(shoulderCue).toMatchObject({
      eligible: false,
      skippedReason: 'primary_shoulder_unavailable',
    });
  });

  it('does not count a front-view rep when only one arm participates', () => {
    const movingArm = fullRepPath();
    const stationaryArm = Array(movingArm.length).fill(EXTENDED_WRIST_Y);
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildDualRecording('synthetic one-arm front curl', movingArm, stationaryArm, 'front'),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts desynced front-view arms once and diagnoses asymmetry', () => {
    const delayFrames = 20;
    const basePath = [
      ...Array(16).fill(EXTENDED_WRIST_Y),
      ...interpolate(EXTENDED_WRIST_Y, TOP_WRIST_Y, 16),
      ...Array(28).fill(TOP_WRIST_Y),
      ...interpolate(TOP_WRIST_Y, EXTENDED_WRIST_Y, 24),
      ...Array(8).fill(EXTENDED_WRIST_Y),
    ];
    const leftPath = [...basePath, ...Array(delayFrames).fill(EXTENDED_WRIST_Y)];
    const rightPath = [...Array(delayFrames).fill(EXTENDED_WRIST_Y), ...basePath];
    const result = replayRecording(
      barbellCurlDefinition,
      buildDualRecording('synthetic desynced front curl', leftPath, rightPath, 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Arms are uneven — curl both sides together.');
    expect(result.reps[0]?.diagnostics?.metrics.syncDelta.value).toBeGreaterThan(0.75);
    expect(result.reps[0]?.diagnostics?.cues['barbell-curl.asymmetry'].triggered).toBe(true);
  });

  it('marks bilateral-only cues ineligible from side/oblique views', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic side-left cue eligibility curl', fullRepPath(), 'side-left'),
    );
    const cues = result.reps[0]?.diagnostics?.cues;

    expect(result.finalRepCount).toBe(1);
    expect(cues?.['barbell-curl.asymmetry']).toMatchObject({
      eligible: false,
      skippedReason: 'not_front_view',
    });
    expect(cues?.['barbell-curl.elbow_flare']).toMatchObject({
      eligible: false,
      skippedReason: 'not_front_view',
    });
  });

  it('marks reps unscorable when exercise-specific view quality is insufficient', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic side-left insufficient view support curl', fullRepPath(), 'side-left'),
      {
        confidenceGating: true,
        heuristicConfig: { viewQualityThresholds: { MIN_SAMPLES: 100 } },
      },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.scorable).toBe(false);
    expect(result.reps[0]?.qualityWarnings).toContain('side_view_uncertain');
    expect(result.reps[0]?.diagnostics?.scorable).toBe(false);
    expect(result.feedbackMessages[0]).toContain("I couldn't judge your form there.");
  });

  it('marks low-confidence occluded side reps unscorable without clean-form issue ids under gating', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic occluded side-left curl', fullRepPath(), 'side-left', {
        leftScore: index => (index >= 16 && index <= 54 && index % 2 === 0 ? 0.05 : 0.99),
      }),
      { confidenceGating: true },
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.reps[0]?.scorable).toBe(false);
    expect(result.reps[0]?.qualityWarnings?.length).toBeGreaterThan(0);
    expect(result.reps[0]?.issueIds).toEqual([]);
    expect(result.feedbackMessages[0]).toContain("I couldn't judge your form there.");
  });

  it('does not count a small pulse that never reaches the top threshold', () => {
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildRecording('synthetic partial pulse', pulsePath(), 'front'),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('does not complete a rep from held smoothed ratios during active landmark dropout', () => {
    const dropoutAfterTop = (index: number) => (index >= 34 ? 0.05 : 0.99);
    const result = replayRecordingVerbose(
      barbellCurlDefinition,
      buildDualRecording('synthetic curl dropout after top', fullRepPath(), fullRepPath(), 'front', {
        leftScore: dropoutAfterTop,
        rightScore: dropoutAfterTop,
      }),
    );

    expect(result.finalRepCount).toBe(0);
    expect(result.repTraces).toEqual([]);
  });

  it('counts a meaningful partial curl and records ROM feedback', () => {
    const clean = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic clean front curl', fullRepPath(), 'front'),
    );
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic half front curl', halfRepPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(result.feedbackMessages).toContain('Flex more at the top of the curl.');
  });

  it('flags wrist curling without punishing neutral wrists', () => {
    const clean = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic neutral wrist curl', fullRepPath(), 'front'),
    );
    const curled = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic curled wrist curl', fullRepPath(), 'front', {
        wristStyle: index => (index < 16 ? 'neutral' : 'curled'),
      }),
    );

    expect(clean.feedbackMessages).not.toContain('Keep your wrists neutral — avoid curling them in.');
    expect(curled.finalRepCount).toBe(1);
    expect(curled.repScores[0]).toBeLessThan(clean.repScores[0]);
    expect(curled.feedbackMessages).toContain('Keep your wrists neutral — avoid curling them in.');
  });

  it('ignores wrist curling when hand landmarks are low-confidence', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic curled wrist with low-confidence index', fullRepPath(), 'front', {
        wristStyle: index => (index < 16 ? 'neutral' : 'curled'),
        indexScore: index => (index < 16 ? 0.99 : 0.05),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain('Keep your wrists neutral — avoid curling them in.');
  });

  it('does not flag elbow flare from a single noisy frame', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic one-frame elbow flare spike', fullRepPath(), 'front', {
        elbowOffset: index => (index === 34 ? 0.6 : 0),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).not.toContain("Keep your elbows in — don't flare them out to the sides.");
    expect(result.feedbackMessages).not.toContain("Tuck your elbows in — they're drifting outward.");
  });

  it('flags sustained elbow flare', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic sustained elbow flare', fullRepPath(), 'front', {
        elbowOffset: index => (index >= 24 && index <= 48 ? 0.28 : 0),
      }),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Tuck your elbows in — they're drifting outward.");
  });

  it('still flags a true fast curl up', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic fast curl up', fastCurlUpPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain('Slow down — control the curl.');
  });

  it('still flags a true fast lowering after a top pause', () => {
    const result = replayRecording(
      barbellCurlDefinition,
      buildRecording('synthetic fast lowering after top pause', fastLoweringPath(), 'front'),
    );

    expect(result.finalRepCount).toBe(1);
    expect(result.feedbackMessages).toContain("Control the lowering — don't drop the weight.");
  });
});
