export enum CanonicalJoint {
  HEAD = 'head',
  NECK = 'neck',
  CHEST_CENTER = 'chest_center',
  PELVIS_CENTER = 'pelvis_center',
  LEFT_SHOULDER = 'left_shoulder',
  RIGHT_SHOULDER = 'right_shoulder',
  LEFT_ELBOW = 'left_elbow',
  RIGHT_ELBOW = 'right_elbow',
  LEFT_WRIST = 'left_wrist',
  RIGHT_WRIST = 'right_wrist',
  LEFT_HIP = 'left_hip',
  RIGHT_HIP = 'right_hip',
  LEFT_KNEE = 'left_knee',
  RIGHT_KNEE = 'right_knee',
  LEFT_ANKLE = 'left_ankle',
  RIGHT_ANKLE = 'right_ankle',
  LEFT_FOOT = 'left_foot',
  RIGHT_FOOT = 'right_foot',
}

export const CANONICAL_JOINTS: readonly CanonicalJoint[] = [
  CanonicalJoint.HEAD,
  CanonicalJoint.NECK,
  CanonicalJoint.CHEST_CENTER,
  CanonicalJoint.PELVIS_CENTER,
  CanonicalJoint.LEFT_SHOULDER,
  CanonicalJoint.RIGHT_SHOULDER,
  CanonicalJoint.LEFT_ELBOW,
  CanonicalJoint.RIGHT_ELBOW,
  CanonicalJoint.LEFT_WRIST,
  CanonicalJoint.RIGHT_WRIST,
  CanonicalJoint.LEFT_HIP,
  CanonicalJoint.RIGHT_HIP,
  CanonicalJoint.LEFT_KNEE,
  CanonicalJoint.RIGHT_KNEE,
  CanonicalJoint.LEFT_ANKLE,
  CanonicalJoint.RIGHT_ANKLE,
  CanonicalJoint.LEFT_FOOT,
  CanonicalJoint.RIGHT_FOOT,
] as const;

export type SkeletonSegment =
  | 'head_neck'
  | 'neck_chest'
  | 'chest_pelvis'
  | 'shoulder_width'
  | 'hip_width'
  | 'upper_arm'
  | 'forearm'
  | 'femur'
  | 'tibia'
  | 'foot';

export interface CanonicalJointMetadata {
  parent: CanonicalJoint | null;
  defaultSegment: SkeletonSegment | null;
  isSynthetic: boolean;
}

export const CANONICAL_JOINT_METADATA: Record<CanonicalJoint, CanonicalJointMetadata> = {
  [CanonicalJoint.HEAD]: {
    parent: CanonicalJoint.NECK,
    defaultSegment: 'head_neck',
    isSynthetic: false,
  },
  [CanonicalJoint.NECK]: {
    parent: CanonicalJoint.CHEST_CENTER,
    defaultSegment: 'neck_chest',
    isSynthetic: true,
  },
  [CanonicalJoint.CHEST_CENTER]: {
    parent: CanonicalJoint.PELVIS_CENTER,
    defaultSegment: 'chest_pelvis',
    isSynthetic: true,
  },
  [CanonicalJoint.PELVIS_CENTER]: {
    parent: null,
    defaultSegment: null,
    isSynthetic: true,
  },
  [CanonicalJoint.LEFT_SHOULDER]: {
    parent: CanonicalJoint.CHEST_CENTER,
    defaultSegment: 'shoulder_width',
    isSynthetic: false,
  },
  [CanonicalJoint.RIGHT_SHOULDER]: {
    parent: CanonicalJoint.CHEST_CENTER,
    defaultSegment: 'shoulder_width',
    isSynthetic: false,
  },
  [CanonicalJoint.LEFT_ELBOW]: {
    parent: CanonicalJoint.LEFT_SHOULDER,
    defaultSegment: 'upper_arm',
    isSynthetic: false,
  },
  [CanonicalJoint.RIGHT_ELBOW]: {
    parent: CanonicalJoint.RIGHT_SHOULDER,
    defaultSegment: 'upper_arm',
    isSynthetic: false,
  },
  [CanonicalJoint.LEFT_WRIST]: {
    parent: CanonicalJoint.LEFT_ELBOW,
    defaultSegment: 'forearm',
    isSynthetic: false,
  },
  [CanonicalJoint.RIGHT_WRIST]: {
    parent: CanonicalJoint.RIGHT_ELBOW,
    defaultSegment: 'forearm',
    isSynthetic: false,
  },
  [CanonicalJoint.LEFT_HIP]: {
    parent: CanonicalJoint.PELVIS_CENTER,
    defaultSegment: 'hip_width',
    isSynthetic: false,
  },
  [CanonicalJoint.RIGHT_HIP]: {
    parent: CanonicalJoint.PELVIS_CENTER,
    defaultSegment: 'hip_width',
    isSynthetic: false,
  },
  [CanonicalJoint.LEFT_KNEE]: {
    parent: CanonicalJoint.LEFT_HIP,
    defaultSegment: 'femur',
    isSynthetic: false,
  },
  [CanonicalJoint.RIGHT_KNEE]: {
    parent: CanonicalJoint.RIGHT_HIP,
    defaultSegment: 'femur',
    isSynthetic: false,
  },
  [CanonicalJoint.LEFT_ANKLE]: {
    parent: CanonicalJoint.LEFT_KNEE,
    defaultSegment: 'tibia',
    isSynthetic: false,
  },
  [CanonicalJoint.RIGHT_ANKLE]: {
    parent: CanonicalJoint.RIGHT_KNEE,
    defaultSegment: 'tibia',
    isSynthetic: false,
  },
  [CanonicalJoint.LEFT_FOOT]: {
    parent: CanonicalJoint.LEFT_ANKLE,
    defaultSegment: 'foot',
    isSynthetic: false,
  },
  [CanonicalJoint.RIGHT_FOOT]: {
    parent: CanonicalJoint.RIGHT_ANKLE,
    defaultSegment: 'foot',
    isSynthetic: false,
  },
};
