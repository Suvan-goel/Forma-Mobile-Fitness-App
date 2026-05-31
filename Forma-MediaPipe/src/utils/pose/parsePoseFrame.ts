import type { Keypoint } from '../poseAnalysis';

export type PoseFrameStatus = 'poseDetected' | 'trackingLost';
export type PoseFramePrimarySource = 'world' | 'image';
export type PoseFrameInputKind =
  | 'jsonString'
  | 'nativeObject'
  | 'nativeLandmarkArray'
  | 'legacyKeypointArray'
  | 'unknown';
export type MetadataValueState = 'known' | 'unknown' | 'malformed';
export type KeypointScoreSource = 'visibility' | 'legacyScore' | 'defaultVisibility';
export type LandmarkSource = 'image' | 'world';

export interface RawPoseLandmark {
  x?: number | null;
  y?: number | null;
  z?: number | null;
  visibility?: number | null;
  presence?: number | null;
}

export interface RawPoseFrame {
  status?: PoseFrameStatus;
  landmarks?: RawPoseLandmark[];
  worldLandmarks?: RawPoseLandmark[];
  timestampMs?: number;
  additionalData?: {
    timestampMs?: number;
    height?: number;
    width?: number;
  };
}

export interface PoseLandmarkMetadata {
  source: LandmarkSource;
  index: number;
  name: string;
  x: number | null;
  y: number | null;
  z: number | null;
  visibility: number | null;
  presence: number | null;
  visibilityState: MetadataValueState;
  presenceState: MetadataValueState;
  malformedFields: string[];
  keypointScore: number;
  keypointScoreSource: KeypointScoreSource;
}

export interface PoseSourceDiagnostics {
  count: number;
  malformedCount: number;
  visibilityUnknownCount: number;
  presenceUnknownCount: number;
}

export interface PoseFrameDiagnostics {
  inputKind: PoseFrameInputKind;
  status: PoseFrameStatus;
  warnings: string[];
  malformedLandmarkCount: number;
  visibilityUnknownCount: number;
  presenceUnknownCount: number;
  sources: Partial<Record<LandmarkSource, PoseSourceDiagnostics>>;
}

export interface PoseFrameMetadata {
  status: PoseFrameStatus;
  inputKind: PoseFrameInputKind;
  imageLandmarks?: PoseLandmarkMetadata[];
  worldLandmarks?: PoseLandmarkMetadata[];
}

export interface ParsedPoseFrame {
  status: PoseFrameStatus;
  keypoints: Keypoint[];
  worldKeypoints?: Keypoint[];
  imageKeypoints?: Keypoint[];
  primarySource: PoseFramePrimarySource;
  timestampMs?: number;
  metadata: PoseFrameMetadata;
  diagnostics: PoseFrameDiagnostics;
}

const MEDIAPIPE_LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee',
  'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
];

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function coordinateValue(value: unknown, fallback: number): number {
  const parsed = finiteNumber(value);
  return parsed === null ? fallback : parsed;
}

function metadataNumber(value: unknown): { value: number | null; state: MetadataValueState } {
  if (value === undefined || value === null) return { value: null, state: 'unknown' };
  const parsed = finiteNumber(value);
  return parsed === null ? { value: null, state: 'malformed' } : { value: parsed, state: 'known' };
}

function timestampFromPayload(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as RawPoseFrame;
  const rawTimestamp = record.timestampMs ?? record.additionalData?.timestampMs;
  return finiteNumber(rawTimestamp) ?? undefined;
}

function isLegacyKeypointArray(value: unknown): value is Keypoint[] {
  return Array.isArray(value) && value.every((item) => (
    item &&
    typeof item === 'object' &&
    typeof (item as Partial<Keypoint>).name === 'string' &&
    'score' in item
  ));
}

function sourceDiagnostics(metadata: PoseLandmarkMetadata[]): PoseSourceDiagnostics {
  return {
    count: metadata.length,
    malformedCount: metadata.filter((item) => item.malformedFields.length > 0).length,
    visibilityUnknownCount: metadata.filter((item) => item.visibilityState !== 'known').length,
    presenceUnknownCount: metadata.filter((item) => item.presenceState !== 'known').length,
  };
}

function buildDiagnostics(
  inputKind: PoseFrameInputKind,
  status: PoseFrameStatus,
  imageMetadata?: PoseLandmarkMetadata[],
  worldMetadata?: PoseLandmarkMetadata[],
): PoseFrameDiagnostics {
  const all = [...(imageMetadata ?? []), ...(worldMetadata ?? [])];
  const warnings: string[] = [];
  const malformedLandmarkCount = all.filter((item) => item.malformedFields.length > 0).length;
  const visibilityUnknownCount = all.filter((item) => item.visibilityState !== 'known').length;
  const presenceUnknownCount = all.filter((item) => item.presenceState !== 'known').length;

  if (status === 'trackingLost') warnings.push('tracking_lost');
  if (malformedLandmarkCount > 0) warnings.push('malformed_landmarks');
  if (visibilityUnknownCount > 0) warnings.push('visibility_unknown');
  if (presenceUnknownCount > 0) warnings.push('presence_unknown');

  return {
    inputKind,
    status,
    warnings,
    malformedLandmarkCount,
    visibilityUnknownCount,
    presenceUnknownCount,
    sources: {
      ...(imageMetadata ? { image: sourceDiagnostics(imageMetadata) } : {}),
      ...(worldMetadata ? { world: sourceDiagnostics(worldMetadata) } : {}),
    },
  };
}

function rawLandmarkRecord(landmark: unknown): RawPoseLandmark {
  return landmark && typeof landmark === 'object' ? landmark as RawPoseLandmark : {};
}

function metadataForRawLandmark(
  rawLandmark: unknown,
  index: number,
  source: LandmarkSource,
): PoseLandmarkMetadata {
  const landmark = rawLandmarkRecord(rawLandmark);
  const visibility = metadataNumber(landmark.visibility);
  const presence = metadataNumber(landmark.presence);
  const x = metadataNumber(landmark.x);
  const y = metadataNumber(landmark.y);
  const z = metadataNumber(landmark.z);
  const malformedFields: string[] = [];

  if (x.state === 'malformed' || x.state === 'unknown') malformedFields.push('x');
  if (y.state === 'malformed' || y.state === 'unknown') malformedFields.push('y');
  if (z.state === 'malformed') malformedFields.push('z');
  if (visibility.state === 'malformed') malformedFields.push('visibility');
  if (presence.state === 'malformed') malformedFields.push('presence');

  return {
    source,
    index,
    name: MEDIAPIPE_LANDMARK_NAMES[index] || `landmark_${index}`,
    x: x.value,
    y: y.value,
    z: z.value,
    visibility: visibility.value,
    presence: presence.value,
    visibilityState: visibility.state,
    presenceState: presence.state,
    malformedFields,
    keypointScore: visibility.state === 'known' && visibility.value !== null ? visibility.value : 1.0,
    keypointScoreSource: visibility.state === 'known' ? 'visibility' : 'defaultVisibility',
  };
}

function keypointFromRawLandmark(rawLandmark: unknown, index: number): Keypoint {
  const landmark = rawLandmarkRecord(rawLandmark);
  const visibility = metadataNumber(landmark.visibility);
  return {
    name: MEDIAPIPE_LANDMARK_NAMES[index] || `landmark_${index}`,
    x: coordinateValue(landmark.x, 0),
    y: coordinateValue(landmark.y, 0),
    z: coordinateValue(landmark.z, 0),
    score: visibility.state === 'known' && visibility.value !== null ? visibility.value : 1.0,
  };
}

function metadataForLegacyKeypoint(keypoint: Keypoint, index: number): PoseLandmarkMetadata {
  const x = metadataNumber(keypoint.x);
  const y = metadataNumber(keypoint.y);
  const z = metadataNumber(keypoint.z);
  const score = metadataNumber(keypoint.score);
  const malformedFields: string[] = [];

  if (x.state === 'malformed' || x.state === 'unknown') malformedFields.push('x');
  if (y.state === 'malformed' || y.state === 'unknown') malformedFields.push('y');
  if (z.state === 'malformed') malformedFields.push('z');
  if (score.state === 'malformed' || score.state === 'unknown') malformedFields.push('score');

  return {
    source: 'image',
    index,
    name: keypoint.name,
    x: x.value,
    y: y.value,
    z: z.value,
    visibility: score.value,
    presence: null,
    visibilityState: score.state,
    presenceState: 'unknown',
    malformedFields,
    keypointScore: score.state === 'known' && score.value !== null ? score.value : 1.0,
    keypointScoreSource: score.state === 'known' ? 'legacyScore' : 'defaultVisibility',
  };
}

function normalizeLegacyKeypoint(keypoint: Keypoint): Keypoint {
  const score = metadataNumber(keypoint.score);
  return {
    name: keypoint.name,
    x: coordinateValue(keypoint.x, 0),
    y: coordinateValue(keypoint.y, 0),
    z: coordinateValue(keypoint.z, 0),
    score: score.state === 'known' && score.value !== null ? score.value : 1.0,
  };
}

function parseJsonIfNeeded(input: unknown): { payload: unknown; inputKindOverride?: PoseFrameInputKind } {
  if (typeof input !== 'string') return { payload: input };
  try {
    return { payload: JSON.parse(input), inputKindOverride: 'jsonString' };
  } catch {
    return { payload: null, inputKindOverride: 'jsonString' };
  }
}

function emptyFrame(inputKind: PoseFrameInputKind, timestampMs?: number): ParsedPoseFrame {
  const diagnostics = buildDiagnostics(inputKind, 'trackingLost');
  return {
    status: 'trackingLost',
    keypoints: [],
    primarySource: 'image',
    timestampMs,
    metadata: {
      status: 'trackingLost',
      inputKind,
    },
    diagnostics,
  };
}

export function parsePoseFrame(input: unknown): ParsedPoseFrame | null {
  const { payload, inputKindOverride } = parseJsonIfNeeded(input);
  if (payload === null || payload === undefined) return null;

  if (isLegacyKeypointArray(payload)) {
    const imageMetadata = payload.map(metadataForLegacyKeypoint);
    const keypoints = payload.map(normalizeLegacyKeypoint);
    const inputKind = inputKindOverride ?? 'legacyKeypointArray';
    return {
      status: keypoints.length > 0 ? 'poseDetected' : 'trackingLost',
      keypoints,
      imageKeypoints: keypoints,
      primarySource: 'image',
      metadata: {
        status: keypoints.length > 0 ? 'poseDetected' : 'trackingLost',
        inputKind,
        imageLandmarks: imageMetadata,
      },
      diagnostics: buildDiagnostics(inputKind, keypoints.length > 0 ? 'poseDetected' : 'trackingLost', imageMetadata),
    };
  }

  const timestampMs = timestampFromPayload(payload);
  if (Array.isArray(payload)) {
    const rawLandmarks = payload as RawPoseLandmark[];
    const imageMetadata = rawLandmarks.map((landmark, index) => metadataForRawLandmark(landmark, index, 'image'));
    const keypoints = rawLandmarks.slice(0, 33).map(keypointFromRawLandmark);
    const inputKind = inputKindOverride ?? 'nativeLandmarkArray';
    const status: PoseFrameStatus = keypoints.length > 0 ? 'poseDetected' : 'trackingLost';
    return {
      status,
      keypoints,
      imageKeypoints: keypoints,
      primarySource: 'image',
      timestampMs,
      metadata: {
        status,
        inputKind,
        imageLandmarks: imageMetadata,
      },
      diagnostics: buildDiagnostics(inputKind, status, imageMetadata),
    };
  }

  if (typeof payload !== 'object') return null;

  const rawFrame = payload as RawPoseFrame;
  const imageLandmarksArray = Array.isArray(rawFrame.landmarks) ? rawFrame.landmarks : undefined;
  const worldLandmarksArray = Array.isArray(rawFrame.worldLandmarks) ? rawFrame.worldLandmarks : undefined;
  const hasImage = Boolean(imageLandmarksArray && imageLandmarksArray.length >= 33);
  const hasWorld = Boolean(
    worldLandmarksArray &&
    worldLandmarksArray.length >= 33 &&
    typeof worldLandmarksArray[0]?.x === 'number',
  );
  const explicitStatus = rawFrame.status;
  const status: PoseFrameStatus = explicitStatus === 'trackingLost' || (!hasImage && !hasWorld)
    ? 'trackingLost'
    : 'poseDetected';
  const inputKind = inputKindOverride ?? 'nativeObject';

  if (status === 'trackingLost') {
    if (!imageLandmarksArray && !worldLandmarksArray) return emptyFrame(inputKind, timestampMs);
  }

  const imageMetadata = imageLandmarksArray
    ? imageLandmarksArray.map((landmark, index) => metadataForRawLandmark(landmark, index, 'image'))
    : undefined;
  const worldMetadata = worldLandmarksArray
    ? worldLandmarksArray.map((landmark, index) => metadataForRawLandmark(landmark, index, 'world'))
    : undefined;

  const imageKeypoints = hasImage
    ? imageLandmarksArray!.slice(0, 33).map(keypointFromRawLandmark)
    : undefined;
  const worldKeypoints = hasWorld
    ? worldLandmarksArray!.slice(0, 33).map(keypointFromRawLandmark)
    : undefined;
  const keypoints = worldKeypoints ?? imageKeypoints ?? [];
  const primarySource: PoseFramePrimarySource = worldKeypoints ? 'world' : 'image';

  return {
    status,
    keypoints,
    worldKeypoints,
    imageKeypoints,
    primarySource,
    timestampMs,
    metadata: {
      status,
      inputKind,
      imageLandmarks: imageMetadata,
      worldLandmarks: worldMetadata,
    },
    diagnostics: buildDiagnostics(inputKind, status, imageMetadata, worldMetadata),
  };
}
