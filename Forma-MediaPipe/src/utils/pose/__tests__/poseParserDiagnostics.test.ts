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
    aggregator.observe(parsedFrame({ landmarks: rawLandmarks({ 16: { visibility: undefined } }) }));

    const snapshot = aggregator.snapshot();
    snapshot.totalFrames = 99;
    snapshot.unknownVisibilityByJoint.right_wrist = 99;

    expect(aggregator.snapshot().totalFrames).toBe(1);
    expect(aggregator.snapshot().unknownVisibilityByJoint.right_wrist).toBe(1);

    aggregator.reset();
    expect(aggregator.snapshot().totalFrames).toBe(0);
    expect(aggregator.snapshot().unknownVisibilityByJoint).toEqual({});
  });

  it('formats a compact console summary without per-frame output', () => {
    const aggregator = createPoseParserDiagnosticsAggregator();
    aggregator.observe(parsedFrame({
      landmarks: rawLandmarks({
        16: { visibility: undefined, presence: undefined },
      }),
    }));

    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      '[PoseParserDiagnostics] frames=1 poseDetected=1 trackingLost=0',
    );
    expect(formatPoseParserDiagnosticsSummary(aggregator.snapshot())).toContain(
      'unknownVisibilityByJoint top=right_wrist:1',
    );
  });
});
