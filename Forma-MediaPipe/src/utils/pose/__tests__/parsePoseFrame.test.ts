import type { Keypoint } from '../../poseAnalysis';
import {
  parsePoseFrame,
  type ParsedPoseFrame,
  type RawPoseLandmark,
} from '../parsePoseFrame';

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

function legacyConverter(landmarkData: any): Omit<ParsedPoseFrame, 'status' | 'metadata' | 'diagnostics'> | null {
  let parsedData = landmarkData;
  if (typeof landmarkData === 'string') {
    parsedData = JSON.parse(landmarkData);
  }

  const worldLandmarksArray = parsedData?.worldLandmarks;
  const imageLandmarksArray = parsedData?.landmarks || parsedData;
  const rawTimestampMs = parsedData?.timestampMs ?? parsedData?.additionalData?.timestampMs;
  const timestampMs = typeof rawTimestampMs === 'number' && Number.isFinite(rawTimestampMs)
    ? rawTimestampMs
    : undefined;

  const hasWorld =
    Array.isArray(worldLandmarksArray) &&
    worldLandmarksArray.length >= 33 &&
    typeof worldLandmarksArray[0]?.x === 'number';
  const hasImage = Array.isArray(imageLandmarksArray) && imageLandmarksArray.length >= 33;
  const landmarkToKeypoint = (landmark: any, index: number): Keypoint => ({
    name: [
      'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
      'right_eye_inner', 'right_eye', 'right_eye_outer',
      'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
      'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
      'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
      'left_index', 'right_index', 'left_thumb', 'right_thumb',
      'left_hip', 'right_hip', 'left_knee', 'right_knee',
      'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
      'left_foot_index', 'right_foot_index',
    ][index] || `landmark_${index}`,
    x: landmark.x ?? 0,
    y: landmark.y ?? 0,
    z: typeof landmark.z === 'number' ? landmark.z : 0,
    score: landmark.visibility !== undefined ? landmark.visibility : 1.0,
  });

  const worldKeypoints = hasWorld
    ? worldLandmarksArray.slice(0, 33).map(landmarkToKeypoint)
    : null;
  const imageKeypoints = hasImage
    ? imageLandmarksArray.slice(0, 33).map(landmarkToKeypoint)
    : null;
  const keypoints = worldKeypoints ?? imageKeypoints;

  if (!keypoints) return null;

  return {
    keypoints,
    worldKeypoints: worldKeypoints ?? undefined,
    imageKeypoints: imageKeypoints ?? undefined,
    primarySource: worldKeypoints ? 'world' : 'image',
    timestampMs,
  };
}

describe('parsePoseFrame', () => {
  it('parses a valid raw pose frame into backwards-compatible keypoints', () => {
    const payload = {
      timestampMs: 1234,
      landmarks: rawLandmarks({
        0: { x: 0.11, y: 0.22, z: 0.33, visibility: 0.44, presence: 0.55 },
      }),
    };

    const parsed = parsePoseFrame(payload);

    expect(parsed?.status).toBe('poseDetected');
    expect(parsed?.primarySource).toBe('image');
    expect(parsed?.timestampMs).toBe(1234);
    expect(parsed?.keypoints).toHaveLength(33);
    expect(parsed?.keypoints[0]).toEqual({
      name: 'nose',
      x: 0.11,
      y: 0.22,
      z: 0.33,
      score: 0.44,
    });
  });

  it('preserves visibility and presence metadata', () => {
    const parsed = parsePoseFrame({
      landmarks: rawLandmarks({
        15: { visibility: 0.31, presence: 0.42 },
      }),
    });

    const wrist = parsed?.metadata.imageLandmarks?.[15];
    expect(wrist).toMatchObject({
      name: 'left_wrist',
      visibility: 0.31,
      presence: 0.42,
      visibilityState: 'known',
      presenceState: 'known',
      keypointScore: 0.31,
      keypointScoreSource: 'visibility',
    });
  });

  it('treats missing visibility as unknown diagnostics while keeping legacy score compatibility', () => {
    const parsed = parsePoseFrame({
      landmarks: rawLandmarks({
        16: { visibility: undefined },
      }),
    });

    const wrist = parsed?.metadata.imageLandmarks?.[16];
    expect(parsed?.keypoints[16].score).toBe(1.0);
    expect(wrist).toMatchObject({
      name: 'right_wrist',
      visibility: null,
      visibilityState: 'unknown',
      keypointScore: 1.0,
      keypointScoreSource: 'defaultVisibility',
    });
    expect(parsed?.diagnostics.warnings).toContain('visibility_unknown');
    expect(parsed?.diagnostics.sources.image?.visibilityUnknownCount).toBe(1);
  });

  it('treats missing presence as null/unknown diagnostics', () => {
    const parsed = parsePoseFrame({
      landmarks: rawLandmarks({
        24: { presence: undefined },
      }),
    });

    const hip = parsed?.metadata.imageLandmarks?.[24];
    expect(hip).toMatchObject({
      name: 'right_hip',
      presence: null,
      presenceState: 'unknown',
    });
    expect(parsed?.diagnostics.warnings).toContain('presence_unknown');
    expect(parsed?.diagnostics.sources.image?.presenceUnknownCount).toBe(1);
  });

  it('flags malformed non-finite coordinates in diagnostics', () => {
    const parsed = parsePoseFrame({
      landmarks: rawLandmarks({
        25: { x: Infinity, y: NaN, z: -Infinity },
      }),
    });

    const knee = parsed?.metadata.imageLandmarks?.[25];
    expect(knee).toMatchObject({
      name: 'left_knee',
      x: null,
      y: null,
      z: null,
      malformedFields: ['x', 'y', 'z'],
    });
    expect(parsed?.keypoints[25]).toMatchObject({
      name: 'left_knee',
      x: 0,
      y: 0,
      z: 0,
    });
    expect(parsed?.diagnostics.warnings).toContain('malformed_landmarks');
    expect(parsed?.diagnostics.malformedLandmarkCount).toBe(1);
  });

  it('flags malformed landmark entries without throwing', () => {
    const landmarks = rawLandmarks();
    (landmarks as unknown[])[12] = null;

    const parsed = parsePoseFrame({ landmarks });

    expect(parsed?.keypoints[12]).toMatchObject({
      name: 'right_shoulder',
      x: 0,
      y: 0,
      z: 0,
      score: 1.0,
    });
    expect(parsed?.metadata.imageLandmarks?.[12].malformedFields).toEqual(['x', 'y']);
    expect(parsed?.diagnostics.malformedLandmarkCount).toBe(1);
  });

  it('handles explicit trackingLost frames and empty landmarks without crashing', () => {
    const parsed = parsePoseFrame({
      status: 'trackingLost',
      timestampMs: 999,
      landmarks: [],
      worldLandmarks: [],
    });

    expect(parsed?.status).toBe('trackingLost');
    expect(parsed?.timestampMs).toBe(999);
    expect(parsed?.keypoints).toEqual([]);
    expect(parsed?.diagnostics.warnings).toContain('tracking_lost');
  });

  it('keeps old-style Keypoint[] compatibility distinct from raw native visibility', () => {
    const legacyKeypoints: Keypoint[] = [
      { name: 'left_shoulder', x: 0.4, y: 0.5, z: 0, score: 0.72 },
      { name: 'left_elbow', x: 0.45, y: 0.6, z: 0, score: 0.63 },
    ];

    const parsed = parsePoseFrame(legacyKeypoints);

    expect(parsed?.keypoints).toEqual(legacyKeypoints);
    expect(parsed?.metadata.inputKind).toBe('legacyKeypointArray');
    expect(parsed?.metadata.imageLandmarks?.[0]).toMatchObject({
      name: 'left_shoulder',
      visibility: 0.72,
      presence: null,
      keypointScoreSource: 'legacyScore',
      presenceState: 'unknown',
    });
  });

  it('matches the existing CameraScreen converter for valid native payloads', () => {
    const payload = {
      timestampMs: 321,
      landmarks: rawLandmarks({
        0: { x: 0.2, y: 0.3, z: 0.4, visibility: 0.5, presence: 0.6 },
      }),
      worldLandmarks: rawLandmarks({
        0: { x: 1.2, y: 1.3, z: 1.4, visibility: 0.7, presence: 0.8 },
      }),
    };

    const parsed = parsePoseFrame(payload);
    const legacy = legacyConverter(payload);

    expect(legacy).not.toBeNull();
    expect(parsed?.keypoints).toEqual(legacy?.keypoints);
    expect(parsed?.worldKeypoints).toEqual(legacy?.worldKeypoints);
    expect(parsed?.imageKeypoints).toEqual(legacy?.imageKeypoints);
    expect(parsed?.primarySource).toBe(legacy?.primarySource);
    expect(parsed?.timestampMs).toBe(legacy?.timestampMs);
  });

  it('parses valid existing-style JSON string payloads', () => {
    const payload = {
      additionalData: { timestampMs: 456 },
      landmarks: rawLandmarks(),
    };

    const parsed = parsePoseFrame(JSON.stringify(payload));
    const legacy = legacyConverter(JSON.stringify(payload));

    expect(parsed?.metadata.inputKind).toBe('jsonString');
    expect(parsed?.keypoints).toEqual(legacy?.keypoints);
    expect(parsed?.timestampMs).toBe(456);
  });
});
