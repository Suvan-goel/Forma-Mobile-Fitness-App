import type { Keypoint } from '../poseAnalysis';
import type { PoseFramePrimarySource } from './parsePoseFrame';

export type PoseStateStatus = 'tracked' | 'partial' | 'lost';

export type PoseJointReliability =
  | 'reliable'
  | 'lowVisibility'
  | 'lowPresence'
  | 'missing'
  | 'malformed'
  | 'stale'
  | 'outlierCandidate';

export type PoseJointReliabilityReason =
  | 'missing'
  | 'malformed_coordinate'
  | 'malformed_visibility'
  | 'malformed_presence'
  | 'visibility_unknown'
  | 'presence_unknown'
  | 'low_visibility'
  | 'low_presence'
  | 'tracking_interrupted'
  | 'reacquisition_frame'
  | 'large_delta'
  | 'bone_length_jump';

export interface PoseJoint {
  name: string;
  raw: Keypoint | null;
  visibility: number | null;
  presence: number | null;
  confidence: number | null;
  reliability: PoseJointReliability;
  reasons: PoseJointReliabilityReason[];
  source: PoseFramePrimarySource | 'unknown';
  ageMs: number | null;
  previousFrameDelta: number | null;
}

export type PoseChainStatus = 'reliable' | 'partial' | 'unreliable';

export interface PoseChainSummary {
  name: string;
  joints: string[];
  reliableJoints: string[];
  lowConfidenceJoints: string[];
  missingJoints: string[];
  malformedJoints: string[];
  staleJoints: string[];
  outlierCandidateJoints: string[];
  status: PoseChainStatus;
}

export interface PoseStateDiagnostics {
  reliabilityCounts: Record<PoseJointReliability, number>;
  reasonCounts: Partial<Record<PoseJointReliabilityReason, number>>;
  malformedJoints: string[];
  missingJoints: string[];
  lowConfidenceJoints: string[];
  staleJoints: string[];
  outlierCandidateJoints: string[];
  trackingInterrupted: boolean;
  silentGapMs?: number;
  reacquisitionFrameIndex?: number;
}

export interface PoseState {
  timestampMs?: number;
  status: PoseStateStatus;
  primarySource: PoseFramePrimarySource;
  keypoints: Keypoint[];
  joints: Record<string, PoseJoint>;
  chains: Record<string, PoseChainSummary>;
  diagnostics: PoseStateDiagnostics;
}

export interface PoseStateFrameContext {
  silentGapMs?: number;
  trackingInterrupted?: boolean;
  reacquisitionFrameIndex?: number;
}

export interface PoseStateReliabilitySummary {
  totalFrames: number;
  statusCounts: Record<PoseStateStatus, number>;
  reliabilityCounts: Record<PoseJointReliability, number>;
  reasonCounts: Partial<Record<PoseJointReliabilityReason, number>>;
  unreliableJointCounts: Record<string, number>;
  outlierCandidateByJoint: Record<string, number>;
  chainStatusCounts: Record<string, Record<PoseChainStatus, number>>;
  trackingInterruptedFrames: number;
  reacquisitionFrames: number;
}
