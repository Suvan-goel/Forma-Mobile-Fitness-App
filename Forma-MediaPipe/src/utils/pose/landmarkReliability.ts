import type { Keypoint } from '../poseAnalysis';
import type { PoseFramePrimarySource, PoseLandmarkMetadata } from './parsePoseFrame';
import type {
  PoseJoint,
  PoseJointReliability,
  PoseJointReliabilityReason,
  PoseStateFrameContext,
} from './PoseState';

export const POSE_LANDMARK_NAMES = [
  'nose', 'left_eye_inner', 'left_eye', 'left_eye_outer',
  'right_eye_inner', 'right_eye', 'right_eye_outer',
  'left_ear', 'right_ear', 'mouth_left', 'mouth_right',
  'left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow',
  'left_wrist', 'right_wrist', 'left_pinky', 'right_pinky',
  'left_index', 'right_index', 'left_thumb', 'right_thumb',
  'left_hip', 'right_hip', 'left_knee', 'right_knee',
  'left_ankle', 'right_ankle', 'left_heel', 'right_heel',
  'left_foot_index', 'right_foot_index',
] as const;

export const POSE_RELIABILITY_THRESHOLDS = {
  lowVisibility: 0.5,
  lowPresence: 0.5,
  largeDelta: 0.35,
  boneLengthRelativeChange: 0.6,
} as const;

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pointIsMalformed(keypoint: Keypoint | null, metadata?: PoseLandmarkMetadata): boolean {
  if (!keypoint) return false;
  if (!finite(keypoint.x) || !finite(keypoint.y) || (keypoint.z !== undefined && !finite(keypoint.z))) {
    return true;
  }
  return Boolean(metadata?.malformedFields.some(field => field === 'x' || field === 'y' || field === 'z'));
}

export function keypointDistance(a: Keypoint | null, b: Keypoint | null): number | null {
  if (!a || !b) return null;
  if (!finite(a.x) || !finite(a.y) || !finite(b.x) || !finite(b.y)) return null;
  const dz = (a.z ?? 0) - (b.z ?? 0);
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function pushUnique(reasons: PoseJointReliabilityReason[], reason: PoseJointReliabilityReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function reliabilityFromReasons(reasons: PoseJointReliabilityReason[]): PoseJointReliability {
  if (reasons.includes('missing')) return 'missing';
  if (
    reasons.includes('malformed_coordinate') ||
    reasons.includes('malformed_visibility') ||
    reasons.includes('malformed_presence')
  ) {
    return 'malformed';
  }
  if (reasons.includes('tracking_interrupted') || reasons.includes('reacquisition_frame')) return 'stale';
  if (reasons.includes('large_delta') || reasons.includes('bone_length_jump')) return 'outlierCandidate';
  if (reasons.includes('low_presence') || reasons.includes('presence_unknown')) return 'lowPresence';
  if (reasons.includes('low_visibility') || reasons.includes('visibility_unknown')) return 'lowVisibility';
  return 'reliable';
}

export function createPoseJoint(input: {
  name: string;
  keypoint: Keypoint | null;
  metadata?: PoseLandmarkMetadata;
  source: PoseFramePrimarySource | 'unknown';
  frameContext?: PoseStateFrameContext;
  previousJoint?: PoseJoint;
  timestampMs?: number;
  previousTimestampMs?: number;
}): PoseJoint {
  const { name, keypoint, metadata, source, frameContext, previousJoint, timestampMs, previousTimestampMs } = input;
  const reasons: PoseJointReliabilityReason[] = [];

  if (!keypoint) {
    pushUnique(reasons, 'missing');
  }

  if (keypoint && pointIsMalformed(keypoint, metadata)) {
    pushUnique(reasons, 'malformed_coordinate');
  }
  if (metadata?.malformedFields.includes('visibility')) {
    pushUnique(reasons, 'malformed_visibility');
  }
  if (metadata?.malformedFields.includes('presence')) {
    pushUnique(reasons, 'malformed_presence');
  }

  const visibility = metadata?.visibility ?? (keypoint && finite(keypoint.score) ? keypoint.score : null);
  const presence = metadata?.presence ?? null;
  const confidence = keypoint && finite(keypoint.score) ? keypoint.score : visibility;

  if (keypoint && metadata && metadata.visibilityState !== 'known' && !metadata.malformedFields.includes('visibility')) {
    pushUnique(reasons, 'visibility_unknown');
  }
  if (keypoint && metadata && metadata.presenceState !== 'known' && !metadata.malformedFields.includes('presence')) {
    pushUnique(reasons, 'presence_unknown');
  }
  if (visibility !== null && visibility < POSE_RELIABILITY_THRESHOLDS.lowVisibility) {
    pushUnique(reasons, 'low_visibility');
  }
  if (presence !== null && presence < POSE_RELIABILITY_THRESHOLDS.lowPresence) {
    pushUnique(reasons, 'low_presence');
  }
  if (keypoint && frameContext?.trackingInterrupted) {
    pushUnique(reasons, 'tracking_interrupted');
  }
  if (keypoint && frameContext?.reacquisitionFrameIndex !== undefined) {
    pushUnique(reasons, 'reacquisition_frame');
  }

  const previousFrameDelta = keypointDistance(keypoint, previousJoint?.raw ?? null);
  if (
    keypoint &&
    previousFrameDelta !== null &&
    previousFrameDelta > POSE_RELIABILITY_THRESHOLDS.largeDelta
  ) {
    pushUnique(reasons, 'large_delta');
  }

  const ageMs =
    previousJoint?.raw &&
    timestampMs !== undefined &&
    previousTimestampMs !== undefined &&
    Number.isFinite(timestampMs) &&
    Number.isFinite(previousTimestampMs)
      ? Math.max(0, timestampMs - previousTimestampMs)
      : null;

  return {
    name,
    raw: keypoint,
    visibility,
    presence,
    confidence,
    reliability: reliabilityFromReasons(reasons),
    reasons,
    source,
    ageMs,
    previousFrameDelta,
  };
}

export function addJointReliabilityReason(
  joint: PoseJoint,
  reason: PoseJointReliabilityReason,
): void {
  pushUnique(joint.reasons, reason);
  joint.reliability = reliabilityFromReasons(joint.reasons);
}
