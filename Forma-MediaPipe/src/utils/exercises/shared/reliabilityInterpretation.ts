import type {
  PoseChainStatus,
  PoseStateReliabilitySummary,
} from '../../pose/PoseState';

export interface ExerciseReliabilityProfile {
  exerciseName: string;
  relevantChains: string[];
  focusJoints: string[];
}

export type CountabilityCandidate = 'countable' | 'maybe' | 'notCountable';
export type ScoreabilityCandidate = 'fullyScoreable' | 'partiallyScoreable' | 'notScoreable';

export interface CueFamilyReliabilityRule {
  family: string;
  requiredChains?: string[];
  anyOfChains?: string[];
}

export interface ExerciseReliabilityInterpretationProfile {
  exerciseName: string;
  primaryChains: string[];
  supportChains: string[];
  minUsablePrimaryChainsForCount: number;
  fullScoreChains: string[];
  cueFamilies: CueFamilyReliabilityRule[];
}

export interface RepReliabilityInterpretation {
  countabilityCandidate: CountabilityCandidate;
  scoreabilityCandidate: ScoreabilityCandidate;
  usableChains: string[];
  weakChains: string[];
  safeCueFamilies: string[];
  unsafeCueFamilies: string[];
  reasons: string[];
}

export const FOCUS_JOINTS = [
  'left_wrist',
  'right_wrist',
  'left_elbow',
  'right_elbow',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
] as const;

export const REPORT_CHAINS = ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'torso', 'pushupBodyLine'] as const;

const ARM_TORSO_FOCUS_JOINTS = [
  'left_shoulder',
  'right_shoulder',
  'left_elbow',
  'right_elbow',
  'left_wrist',
  'right_wrist',
  'left_hip',
  'right_hip',
];

const LEG_FOCUS_JOINTS = [
  'left_hip',
  'right_hip',
  'left_knee',
  'right_knee',
  'left_ankle',
  'right_ankle',
];

const DISTAL_LEG_FOCUS_JOINTS = [
  ...LEG_FOCUS_JOINTS,
  'left_heel',
  'right_heel',
  'left_foot_index',
  'right_foot_index',
];

const EXERCISE_RELIABILITY_PROFILES: Record<string, ExerciseReliabilityProfile> = {
  barbellcurl: {
    exerciseName: 'Barbell Curl',
    relevantChains: ['leftArm', 'rightArm', 'torso'],
    focusJoints: ARM_TORSO_FOCUS_JOINTS,
  },
  cablepushdowns: {
    exerciseName: 'Cable Pushdowns',
    relevantChains: ['leftArm', 'rightArm', 'torso'],
    focusJoints: ARM_TORSO_FOCUS_JOINTS,
  },
  cablerow: {
    exerciseName: 'Cable Row',
    relevantChains: ['leftArm', 'rightArm', 'torso'],
    focusJoints: ARM_TORSO_FOCUS_JOINTS,
  },
  cablelatpulldowns: {
    exerciseName: 'Cable Lat Pulldowns',
    relevantChains: ['leftArm', 'rightArm', 'torso'],
    focusJoints: ARM_TORSO_FOCUS_JOINTS,
  },
  standingdumbbelllateralraises: {
    exerciseName: 'Standing Dumbbell Lateral Raises',
    relevantChains: ['leftArm', 'rightArm', 'torso'],
    focusJoints: ARM_TORSO_FOCUS_JOINTS,
  },
  legextensions: {
    exerciseName: 'Leg Extensions',
    relevantChains: ['leftLeg', 'rightLeg', 'torso'],
    focusJoints: LEG_FOCUS_JOINTS,
  },
  lyinglegcurl: {
    exerciseName: 'Lying Leg Curl',
    relevantChains: ['leftLeg', 'rightLeg', 'torso'],
    focusJoints: DISTAL_LEG_FOCUS_JOINTS,
  },
  machineabcrunches: {
    exerciseName: 'Machine Ab Crunches',
    relevantChains: ['torso'],
    focusJoints: [
      'left_shoulder',
      'right_shoulder',
      'left_hip',
      'right_hip',
      'left_knee',
      'right_knee',
      'left_ear',
      'right_ear',
      'left_elbow',
      'right_elbow',
      'left_wrist',
      'right_wrist',
    ],
  },
  pushup: {
    exerciseName: 'Push-Up',
    relevantChains: ['leftArm', 'rightArm', 'torso', 'pushupBodyLine'],
    focusJoints: [
      'left_shoulder',
      'right_shoulder',
      'left_elbow',
      'right_elbow',
      'left_wrist',
      'right_wrist',
      'left_hip',
      'right_hip',
      'nose',
      'left_ankle',
      'right_ankle',
    ],
  },
  barbellsquat: {
    exerciseName: 'Barbell Squat',
    relevantChains: ['leftLeg', 'rightLeg', 'torso'],
    focusJoints: [
      ...DISTAL_LEG_FOCUS_JOINTS,
      'left_shoulder',
      'right_shoulder',
    ],
  },
};

const ARM_CUE_FAMILIES: CueFamilyReliabilityRule[] = [
  { family: 'repCount', anyOfChains: ['leftArm', 'rightArm'], requiredChains: ['torso'] },
  { family: 'tempo', anyOfChains: ['leftArm', 'rightArm'], requiredChains: ['torso'] },
  { family: 'torsoControl', requiredChains: ['torso'] },
  { family: 'visibleArmRom', anyOfChains: ['leftArm', 'rightArm'] },
  { family: 'bilateralArmRom', requiredChains: ['leftArm', 'rightArm'] },
  { family: 'bilateralSymmetry', requiredChains: ['leftArm', 'rightArm'] },
  { family: 'wristSpecific', requiredChains: ['leftArm', 'rightArm'] },
];

const LEG_CUE_FAMILIES: CueFamilyReliabilityRule[] = [
  { family: 'repCount', anyOfChains: ['leftLeg', 'rightLeg'], requiredChains: ['torso'] },
  { family: 'tempo', anyOfChains: ['leftLeg', 'rightLeg'] },
  { family: 'torsoControl', requiredChains: ['torso'] },
  { family: 'visibleLegRom', anyOfChains: ['leftLeg', 'rightLeg'] },
  { family: 'kneeAngle', anyOfChains: ['leftLeg', 'rightLeg'] },
  { family: 'distalEndpoint', anyOfChains: ['leftLeg', 'rightLeg'] },
  { family: 'bilateralLegComparison', requiredChains: ['leftLeg', 'rightLeg'] },
];

const EXERCISE_INTERPRETATION_PROFILES: Record<string, ExerciseReliabilityInterpretationProfile> = {
  barbellcurl: {
    exerciseName: 'Barbell Curl',
    primaryChains: ['leftArm', 'rightArm'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftArm', 'rightArm', 'torso'],
    cueFamilies: ARM_CUE_FAMILIES,
  },
  cablepushdowns: {
    exerciseName: 'Cable Pushdowns',
    primaryChains: ['leftArm', 'rightArm'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftArm', 'rightArm', 'torso'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftArm', 'rightArm'], requiredChains: ['torso'] },
      { family: 'tempo', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'torsoControl', requiredChains: ['torso'] },
      { family: 'visibleArmPath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'handlePath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'elbowPath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'wristSpecific', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'bilateralSymmetry', requiredChains: ['leftArm', 'rightArm'] },
    ],
  },
  cablerow: {
    exerciseName: 'Cable Row',
    primaryChains: ['leftArm', 'rightArm'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['torso'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftArm', 'rightArm'], requiredChains: ['torso'] },
      { family: 'tempo', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'visibleArmPath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'handlePath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'wristSpecific', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'torsoControl', requiredChains: ['torso'] },
    ],
  },
  cablelatpulldowns: {
    exerciseName: 'Cable Lat Pulldowns',
    primaryChains: ['leftArm', 'rightArm'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftArm', 'rightArm', 'torso'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftArm', 'rightArm'], requiredChains: ['torso'] },
      { family: 'tempo', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'torsoControl', requiredChains: ['torso'] },
      { family: 'visibleArmPath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'handlePath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'elbowPath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'wristSpecific', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'bilateralSymmetry', requiredChains: ['leftArm', 'rightArm'] },
      { family: 'rangeOfMotion', anyOfChains: ['leftArm', 'rightArm'] },
    ],
  },
  standingdumbbelllateralraises: {
    exerciseName: 'Standing Dumbbell Lateral Raises',
    primaryChains: ['leftArm', 'rightArm'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftArm', 'rightArm', 'torso'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftArm', 'rightArm'], requiredChains: ['torso'] },
      { family: 'visibleArmRaise', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'shoulderElbowWristPath', requiredChains: ['leftArm', 'rightArm'] },
      { family: 'wristEndpoint', requiredChains: ['leftArm', 'rightArm'] },
      { family: 'bilateralRaiseSymmetry', requiredChains: ['leftArm', 'rightArm'] },
      { family: 'torsoControl', requiredChains: ['torso'] },
    ],
  },
  legextensions: {
    exerciseName: 'Leg Extensions',
    primaryChains: ['leftLeg', 'rightLeg'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftLeg', 'rightLeg', 'torso'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftLeg', 'rightLeg'], requiredChains: ['torso'] },
      { family: 'tempo', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'visibleLegPath', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'kneeExtension', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'rangeOfMotion', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'lockout', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'distalEndpoint', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'bilateralSymmetry', requiredChains: ['leftLeg', 'rightLeg'] },
      { family: 'torsoSetup', requiredChains: ['torso'] },
    ],
  },
  lyinglegcurl: {
    exerciseName: 'Lying Leg Curl',
    primaryChains: ['leftLeg', 'rightLeg'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftLeg', 'rightLeg', 'torso'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftLeg', 'rightLeg'], requiredChains: ['torso'] },
      { family: 'tempo', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'visibleLegPath', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'kneeFlexion', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'rangeOfMotion', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'lockoutOrExtension', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'distalEndpoint', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'heelFootFallback', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'bilateralSymmetry', requiredChains: ['leftLeg', 'rightLeg'] },
      { family: 'torsoSetup', requiredChains: ['torso'] },
    ],
  },
  machineabcrunches: {
    exerciseName: 'Machine Ab Crunches',
    primaryChains: ['torso'],
    supportChains: [],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['torso'],
    cueFamilies: [
      { family: 'repCount', requiredChains: ['torso'] },
      { family: 'tempo', requiredChains: ['torso'] },
      { family: 'torsoCrunchPath', requiredChains: ['torso'] },
      { family: 'hipAngleRange', requiredChains: ['torso'] },
      { family: 'kneeSupport', requiredChains: ['torso'] },
      { family: 'shoulderHipAlignment', requiredChains: ['torso'] },
      { family: 'setupPosture', requiredChains: ['torso'] },
      { family: 'auxiliaryArmCue', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'neckPosition', requiredChains: ['torso'] },
    ],
  },
  pushup: {
    exerciseName: 'Push-Up',
    primaryChains: ['leftArm', 'rightArm'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftArm', 'rightArm', 'torso', 'pushupBodyLine'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftArm', 'rightArm'], requiredChains: ['torso'] },
      { family: 'tempo', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'armDepth', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'elbowPath', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'wristHandPlacement', anyOfChains: ['leftArm', 'rightArm'] },
      { family: 'torsoControl', requiredChains: ['torso'] },
      { family: 'bodyLine', requiredChains: ['pushupBodyLine'] },
      { family: 'hipSag', requiredChains: ['pushupBodyLine'] },
      { family: 'kneeSupport', requiredChains: ['pushupBodyLine'] },
      { family: 'footAnklePosition', requiredChains: ['pushupBodyLine'] },
      { family: 'headNeckPosition', requiredChains: ['torso'] },
    ],
  },
  barbellsquat: {
    exerciseName: 'Barbell Squat',
    primaryChains: ['leftLeg', 'rightLeg'],
    supportChains: ['torso'],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: ['leftLeg', 'rightLeg', 'torso'],
    cueFamilies: [
      { family: 'repCount', anyOfChains: ['leftLeg', 'rightLeg'], requiredChains: ['torso'] },
      { family: 'tempo', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'visibleLegPath', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'depth', anyOfChains: ['leftLeg', 'rightLeg'], requiredChains: ['torso'] },
      { family: 'kneeTracking', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'hipKneePath', anyOfChains: ['leftLeg', 'rightLeg'], requiredChains: ['torso'] },
      { family: 'ankleFootPosition', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'heelLift', anyOfChains: ['leftLeg', 'rightLeg'] },
      { family: 'torsoLean', requiredChains: ['torso'] },
      { family: 'barPathOrUpperBody', requiredChains: ['torso'] },
      { family: 'bilateralSymmetry', requiredChains: ['leftLeg', 'rightLeg'] },
      { family: 'setupStance', requiredChains: ['leftLeg', 'rightLeg', 'torso'] },
    ],
  },
};

function exerciseProfileKey(exerciseName: string): string {
  return exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function reliabilityProfileForExercise(exerciseName: string): ExerciseReliabilityProfile {
  return EXERCISE_RELIABILITY_PROFILES[exerciseProfileKey(exerciseName)] ?? {
    exerciseName,
    relevantChains: [...REPORT_CHAINS],
    focusJoints: [...FOCUS_JOINTS],
  };
}

export function interpretationProfileForExercise(exerciseName: string): ExerciseReliabilityInterpretationProfile {
  return EXERCISE_INTERPRETATION_PROFILES[exerciseProfileKey(exerciseName)] ?? {
    exerciseName,
    primaryChains: [...REPORT_CHAINS],
    supportChains: [],
    minUsablePrimaryChainsForCount: 1,
    fullScoreChains: [...REPORT_CHAINS],
    cueFamilies: [
      { family: 'repCount', anyOfChains: [...REPORT_CHAINS] },
      { family: 'formFeedback', requiredChains: [...REPORT_CHAINS] },
    ],
  };
}

function chainStatusRates(
  frameCount: number,
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>,
  chainName: string,
): Record<PoseChainStatus, number> {
  const counts = chainStatusCounts[chainName] ?? { reliable: 0, partial: 0, unreliable: 0 };
  const denominator = Math.max(1, frameCount);
  return {
    reliable: counts.reliable / denominator,
    partial: counts.partial / denominator,
    unreliable: counts.unreliable / denominator,
  };
}

function isChainUsable(
  frameCount: number,
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>,
  chainName: string,
): boolean {
  const rates = chainStatusRates(frameCount, chainStatusCounts, chainName);
  return frameCount > 0 && rates.reliable >= 0.5 && rates.unreliable < 0.25;
}

function isChainWeak(
  frameCount: number,
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>,
  chainName: string,
): boolean {
  if (frameCount === 0) return true;
  return !isChainUsable(frameCount, chainStatusCounts, chainName);
}

function uniqueProfileChains(profile: ExerciseReliabilityInterpretationProfile): string[] {
  return Array.from(new Set([
    ...profile.primaryChains,
    ...profile.supportChains,
    ...profile.fullScoreChains,
    ...profile.cueFamilies.flatMap((rule) => [
      ...(rule.requiredChains ?? []),
      ...(rule.anyOfChains ?? []),
    ]),
  ]));
}

export function cueFamilyIsSafe(
  rule: CueFamilyReliabilityRule,
  frameCount: number,
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>,
): boolean {
  const requiredSafe = (rule.requiredChains ?? []).every((chainName) => (
    isChainUsable(frameCount, chainStatusCounts, chainName)
  ));
  const anyOfChains = rule.anyOfChains ?? [];
  const anyOfSafe = anyOfChains.length === 0 || anyOfChains.some((chainName) => (
    isChainUsable(frameCount, chainStatusCounts, chainName)
  ));
  return requiredSafe && anyOfSafe;
}

export function pairedPrimaryChainHasOneUsableAndOneWeak(
  profile: ExerciseReliabilityInterpretationProfile,
  usableChains: string[],
  weakChains: string[],
): boolean {
  const pairs: Array<[string, string]> = [
    ['leftArm', 'rightArm'],
    ['leftLeg', 'rightLeg'],
  ];
  return pairs.some(([left, right]) => (
    profile.primaryChains.includes(left) &&
    profile.primaryChains.includes(right) &&
    (
      (usableChains.includes(left) && weakChains.includes(right)) ||
      (usableChains.includes(right) && weakChains.includes(left))
    )
  ));
}

export function interpretRepReliability(args: {
  frameCount: number;
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>;
  trackingInterruptedFrames: number;
  profile: ExerciseReliabilityInterpretationProfile;
}): RepReliabilityInterpretation {
  const { frameCount, chainStatusCounts, trackingInterruptedFrames, profile } = args;
  const profileChains = uniqueProfileChains(profile);
  const usableChains = profileChains.filter((chainName) => (
    isChainUsable(frameCount, chainStatusCounts, chainName)
  ));
  const weakChains = profileChains.filter((chainName) => (
    isChainWeak(frameCount, chainStatusCounts, chainName)
  ));
  const usablePrimaryCount = profile.primaryChains.filter((chainName) => (
    usableChains.includes(chainName)
  )).length;
  const supportChainsUsable = profile.supportChains.every((chainName) => (
    usableChains.includes(chainName)
  ));
  const safeCueFamilies = profile.cueFamilies
    .filter((rule) => cueFamilyIsSafe(rule, frameCount, chainStatusCounts))
    .map((rule) => rule.family);
  const unsafeCueFamilies = profile.cueFamilies
    .filter((rule) => !safeCueFamilies.includes(rule.family))
    .map((rule) => rule.family);

  const reasons: string[] = [];
  if (frameCount === 0) reasons.push('no_frames_in_rep_window');
  if (trackingInterruptedFrames > 0) reasons.push('tracking_interrupted_inside_rep');
  if (usablePrimaryCount === 0) reasons.push('no_primary_chain_usable');
  if (usablePrimaryCount > 0 && usablePrimaryCount < profile.primaryChains.length) {
    reasons.push('only_one_primary_chain_usable');
  }
  for (const supportChain of profile.supportChains) {
    if (!usableChains.includes(supportChain)) reasons.push(`${supportChain}_weak`);
  }
  for (const weakChain of weakChains) {
    if (profile.primaryChains.includes(weakChain)) reasons.push(`${weakChain}_weak`);
  }
  if (unsafeCueFamilies.length > 0) reasons.push('some_cue_families_unsafe');

  let countabilityCandidate: CountabilityCandidate;
  if (frameCount === 0 || (usablePrimaryCount === 0 && !supportChainsUsable)) {
    countabilityCandidate = 'notCountable';
  } else if (
    usablePrimaryCount >= profile.minUsablePrimaryChainsForCount &&
    supportChainsUsable &&
    trackingInterruptedFrames === 0
  ) {
    countabilityCandidate = 'countable';
  } else {
    countabilityCandidate = 'maybe';
  }

  const hasEnoughPrimaryForFullScore = usablePrimaryCount >= profile.minUsablePrimaryChainsForCount;
  const fullScoreChainsUsable = profile.fullScoreChains.every((chainName) => usableChains.includes(chainName));
  const scoreabilityCandidate: ScoreabilityCandidate =
    countabilityCandidate === 'notCountable'
      ? 'notScoreable'
      : hasEnoughPrimaryForFullScore && fullScoreChainsUsable && unsafeCueFamilies.length === 0
        ? 'fullyScoreable'
        : 'partiallyScoreable';

  return {
    countabilityCandidate,
    scoreabilityCandidate,
    usableChains,
    weakChains,
    safeCueFamilies,
    unsafeCueFamilies,
    reasons: Array.from(new Set(reasons)),
  };
}

export function interpretPoseStateReliabilitySummary(
  exerciseName: string,
  summary: PoseStateReliabilitySummary,
): RepReliabilityInterpretation {
  return interpretRepReliability({
    frameCount: summary.totalFrames,
    chainStatusCounts: summary.chainStatusCounts,
    trackingInterruptedFrames: summary.trackingInterruptedFrames,
    profile: interpretationProfileForExercise(exerciseName),
  });
}
