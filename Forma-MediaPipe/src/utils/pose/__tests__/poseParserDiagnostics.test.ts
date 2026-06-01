import {
  createPoseParserDiagnosticsAggregator,
  formatPoseParserDiagnosticsSummary,
} from '../poseParserDiagnostics';
import { parsePoseFrame, type RawPoseLandmark } from '../parsePoseFrame';

const LANDMARK_COUNT = 33;

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
  return Array.from({ length: LANDMARK_COUNT }, (_, index) => rawLandmark(index, overrides[index]));
}

function parsedFrame(payload: unknown) {
  const parsed = parsePoseFrame(payload);
  expect(parsed).not.toBeNull();
  return parsed!;
}

describe('PoseParserDiagnosticsAggregator', () => {
  it('aggregates frame status and primary source counts', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    aggregator.observe(parsedFrame({ landmarks: rawLandmarks() }));
    aggregator.observe(parsedFrame({ landmarks: rawLandmarks(), worldLandmarks: rawLandmarks() }));
    aggregator.observe(parsedFrame({ status: 'trackingLost', landmarks: [], worldLandmarks: [] }));

    const summary = aggregator.snapshot();
    expect(summary.totalFrames).toBe(3);
    expect(summary.poseDetectedFrames).toBe(2);
    expect(summary.trackingLostFrames).toBe(1);
    expect(summary.primarySourceCounts).toEqual({ image: 2, world: 1 });
    expect(summary.warningCounts.tracking_lost).toBe(1);
  });

  it('aggregates missing visibility, missing presence, and malformed landmarks by joint name', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        15: { visibility: undefined, presence: undefined },
        25: { x: Infinity, y: NaN, z: -Infinity },
      }),
    }));

    const summary = aggregator.snapshot();
    expect(summary.framesWithMissingVisibility).toBe(1);
    expect(summary.framesWithMissingPresence).toBe(1);
    expect(summary.framesWithMalformedLandmarks).toBe(1);
    expect(summary.unknownVisibilityByJoint.left_wrist).toBe(1);
    expect(summary.missingPresenceByJoint.left_wrist).toBe(1);
    expect(summary.malformedLandmarksByJoint.left_knee).toBe(1);
  });

  it('aggregates low visibility and presence values by joint threshold', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        13: { visibility: 0.45, presence: 0.34 },
        15: { visibility: 0.12, presence: 0.18 },
        16: { visibility: 0.32, presence: 0.49 },
      }),
    }));

    const summary = aggregator.snapshot();
    expect(summary.framesWithMissingVisibility).toBe(0);
    expect(summary.framesWithMissingPresence).toBe(0);

    expect(summary.lowVisibilityByJoint.lt015.left_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt020.left_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt035.left_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt050.left_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt015.right_wrist).toBeUndefined();
    expect(summary.lowVisibilityByJoint.lt020.right_wrist).toBeUndefined();
    expect(summary.lowVisibilityByJoint.lt035.right_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt050.right_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt050.left_elbow).toBe(1);

    expect(summary.lowPresenceByJoint.lt015.left_wrist).toBeUndefined();
    expect(summary.lowPresenceByJoint.lt020.left_wrist).toBe(1);
    expect(summary.lowPresenceByJoint.lt035.left_wrist).toBe(1);
    expect(summary.lowPresenceByJoint.lt050.left_wrist).toBe(1);
    expect(summary.lowPresenceByJoint.lt035.left_elbow).toBe(1);
    expect(summary.lowPresenceByJoint.lt050.right_wrist).toBe(1);
  });

  it('tracks running visibility and presence statistics by joint', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        15: { visibility: 0.1, presence: 0.2 },
        16: { visibility: 0.8, presence: 0.9 },
      }),
    }));
    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        15: { visibility: 0.3, presence: 0.6 },
        16: { visibility: 0.7, presence: 0.8 },
      }),
    }));

    const summary = aggregator.snapshot();
    expect(summary.visibilityStatsByJoint.left_wrist).toEqual({
      sampleCount: 2,
      min: 0.1,
      max: 0.3,
      mean: 0.2,
    });
    expect(summary.presenceStatsByJoint.left_wrist).toEqual({
      sampleCount: 2,
      min: 0.2,
      max: 0.6,
      mean: 0.4,
    });
    expect(summary.visibilityStatsByJoint.right_wrist).toEqual({
      sampleCount: 2,
      min: 0.7,
      max: 0.8,
      mean: 0.75,
    });
  });

  it('tracks source-separated and primary-source-only confidence stats', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        15: { visibility: 0.8, presence: 0.9 },
      }),
      worldLandmarks: rawLandmarks({
        15: { visibility: 0.2, presence: 0.3 },
      }),
    }));

    const summary = aggregator.snapshot();
    expect(summary.primarySourceCounts).toEqual({ image: 0, world: 1 });

    expect(summary.visibilityStatsByJoint.left_wrist).toEqual({
      sampleCount: 2,
      min: 0.2,
      max: 0.8,
      mean: 0.5,
    });
    expect(summary.jointStatsBySource.allSources.visibilityStatsByJoint.left_wrist).toEqual({
      sampleCount: 2,
      min: 0.2,
      max: 0.8,
      mean: 0.5,
    });
    expect(summary.jointStatsBySource.primarySource.visibilityStatsByJoint.left_wrist).toEqual({
      sampleCount: 1,
      min: 0.2,
      max: 0.2,
      mean: 0.2,
    });
    expect(summary.jointStatsBySource.world.visibilityStatsByJoint.left_wrist).toEqual({
      sampleCount: 1,
      min: 0.2,
      max: 0.2,
      mean: 0.2,
    });
    expect(summary.jointStatsBySource.image.visibilityStatsByJoint.left_wrist).toEqual({
      sampleCount: 1,
      min: 0.8,
      max: 0.8,
      mean: 0.8,
    });
    expect(summary.jointStatsBySource.primarySource.lowVisibilityByJoint.lt035.left_wrist).toBe(1);
    expect(summary.jointStatsBySource.image.lowVisibilityByJoint.lt035.left_wrist).toBeUndefined();
  });

  it('distinguishes missing visibility from present-but-low visibility', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        15: { visibility: 0.1, presence: 0.1 },
        16: { visibility: undefined, presence: undefined },
      }),
    }));

    const summary = aggregator.snapshot();
    expect(summary.framesWithMissingVisibility).toBe(1);
    expect(summary.framesWithMissingPresence).toBe(1);
    expect(summary.unknownVisibilityByJoint.right_wrist).toBe(1);
    expect(summary.missingPresenceByJoint.right_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt020.left_wrist).toBe(1);
    expect(summary.lowPresenceByJoint.lt020.left_wrist).toBe(1);
    expect(summary.lowVisibilityByJoint.lt050.right_wrist).toBeUndefined();
    expect(summary.lowPresenceByJoint.lt050.right_wrist).toBeUndefined();
    expect(summary.visibilityStatsByJoint.right_wrist).toBeUndefined();
    expect(summary.presenceStatsByJoint.right_wrist).toBeUndefined();
  });

  it('tracks timestamp gaps and possible silent tracking loss', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    for (const timestampMs of [0, 33, 300, 900, 2200, 2250, 2300, 2350, 2400]) {
      aggregator.observe(parsedFrame({ timestampMs, landmarks: rawLandmarks() }));
    }

    const summary = aggregator.snapshot();
    expect(summary.timestampGaps.totalDurationMs).toBe(2400);
    expect(summary.timestampGaps.intervalCount).toBe(8);
    expect(summary.timestampGaps.minFrameIntervalMs).toBe(33);
    expect(summary.timestampGaps.meanFrameIntervalMs).toBe(300);
    expect(summary.timestampGaps.maxFrameIntervalMs).toBe(1300);
    expect(summary.timestampGaps.gapsOver250Ms).toBe(3);
    expect(summary.timestampGaps.gapsOver500Ms).toBe(2);
    expect(summary.timestampGaps.gapsOver1000Ms).toBe(1);
    expect(summary.timestampGaps.gapsOver2000Ms).toBe(0);
    expect(summary.timestampGaps.possibleSilentTrackingLossCount).toBe(1);
    expect(summary.timestampGaps.reacquisitionFrameCount).toBe(5);
  });

  it('tracks image and world landmark availability', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();

    aggregator.observe(parsedFrame({ landmarks: rawLandmarks() }));
    aggregator.observe(parsedFrame({ landmarks: rawLandmarks(), worldLandmarks: rawLandmarks() }));
    aggregator.observe(parsedFrame({ status: 'trackingLost', landmarks: [], worldLandmarks: [] }));

    const summary = aggregator.snapshot();
    expect(summary.imageLandmarks.presentFrames).toBe(2);
    expect(summary.imageLandmarks.missingFrames).toBe(1);
    expect(summary.worldLandmarks.presentFrames).toBe(1);
    expect(summary.worldLandmarks.missingFrames).toBe(2);
    expect(summary.imageLandmarks.totalLandmarks).toBe(66);
    expect(summary.worldLandmarks.totalLandmarks).toBe(33);
  });

  it('can reset and returns immutable snapshots', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();
    aggregator.observe(parsedFrame({ landmarks: rawLandmarks({ 16: { visibility: undefined }, 15: { visibility: 0.1 } }) }));

    const snapshot = aggregator.snapshot();
    snapshot.totalFrames = 99;
    snapshot.unknownVisibilityByJoint.right_wrist = 99;
    snapshot.lowVisibilityByJoint.lt020.left_wrist = 99;
    snapshot.visibilityStatsByJoint.left_wrist.mean = 99;
    snapshot.jointStatsBySource.allSources.lowVisibilityByJoint.lt020.left_wrist = 99;
    snapshot.jointStatsBySource.allSources.visibilityStatsByJoint.left_wrist.mean = 99;

    expect(aggregator.snapshot().totalFrames).toBe(1);
    expect(aggregator.snapshot().unknownVisibilityByJoint.right_wrist).toBe(1);
    expect(aggregator.snapshot().lowVisibilityByJoint.lt020.left_wrist).toBe(1);
    expect(aggregator.snapshot().visibilityStatsByJoint.left_wrist.mean).toBe(0.1);
    expect(aggregator.snapshot().jointStatsBySource.allSources.lowVisibilityByJoint.lt020.left_wrist).toBe(1);
    expect(aggregator.snapshot().jointStatsBySource.allSources.visibilityStatsByJoint.left_wrist.mean).toBe(0.1);

    aggregator.reset();
    expect(aggregator.snapshot().totalFrames).toBe(0);
    expect(aggregator.snapshot().unknownVisibilityByJoint).toEqual({});
    expect(aggregator.snapshot().lowVisibilityByJoint.lt020).toEqual({});
    expect(aggregator.snapshot().visibilityStatsByJoint).toEqual({});
    expect(aggregator.snapshot().jointStatsBySource.primarySource.visibilityStatsByJoint).toEqual({});
    expect(aggregator.snapshot().timestampGaps.intervalCount).toBe(0);
  });

  it('formats a compact console summary without per-frame output', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();
    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        15: { visibility: 0.12, presence: 0.18 },
        16: { visibility: undefined, presence: undefined },
      }),
    }));

    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      '[PoseParserDiagnostics] frames=1 poseDetected=1 trackingLost=0',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      'unknownVisibilityByJoint top=right_wrist:1',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      'visibility<0.20 top=left_wrist:1',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      'presence<0.35 top=left_wrist:1',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      'wrists visibility left_wrist=n=1 min=0.12 mean=0.12 max=0.12 right_wrist=n/a',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      'primarySource wrists visibility left_wrist=n=1 min=0.12 mean=0.12 max=0.12 right_wrist=n/a',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      'timestampGaps gaps>250ms=0 gaps>500ms=0 gaps>1000ms=0 gaps>2000ms=0 possibleSilentTrackingLoss=0 reacquisitionFrames=0',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot(), {
      totalReps: 4,
      completedRepCount: 4,
      analyzerRepCount: 6,
      uiRepCount: 6,
      scoredRepCount: 3,
      unscoredRepCount: 1,
    })).toContain(
      'reps total=4 completed=4 analyzer=6 ui=6 scored=3 unscored=1',
    );
  });
});
