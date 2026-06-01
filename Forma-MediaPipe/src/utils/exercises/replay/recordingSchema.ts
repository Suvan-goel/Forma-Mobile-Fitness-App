import type { PoseFrameGapMetadata } from '../../pose/frameGapTracker';
import type {
  KeypointScoreSource,
  MetadataValueState,
  ParsedPoseFrame,
  PoseLandmarkMetadata,
} from '../../pose/parsePoseFrame';
import type {
  LandmarkRecordingFrame,
  LandmarkRecordingFrameContext,
  LandmarkRecordingMetadataValueState,
  LandmarkRecordingPoseLandmarkMetadata,
  LandmarkRecordingPoseMetadata,
  LandmarkRecordingScoreSource,
} from './types';

function metadataStateForRecording(
  state: MetadataValueState,
): LandmarkRecordingMetadataValueState {
  if (state === 'known') return 'present';
  if (state === 'malformed') return 'unknown';
  return 'missing';
}

function scoreSourceForRecording(
  source: KeypointScoreSource,
): LandmarkRecordingScoreSource {
  if (source === 'visibility') return 'visibility';
  if (source === 'legacyScore') return 'legacy';
  if (source === 'defaultVisibility') return 'default';
  return 'unknown';
}

function landmarkMetadataForRecording(
  metadata: PoseLandmarkMetadata,
): LandmarkRecordingPoseLandmarkMetadata {
  return {
    name: metadata.name,
    source: metadata.source,
    visibility: metadata.visibility,
    presence: metadata.presence,
    visibilityState: metadataStateForRecording(metadata.visibilityState),
    presenceState: metadataStateForRecording(metadata.presenceState),
    scoreSource: scoreSourceForRecording(metadata.keypointScoreSource),
    ...(metadata.malformedFields.length > 0
      ? { malformedFields: [...metadata.malformedFields] }
      : {}),
  };
}

export function poseMetadataForRecording(
  parsedFrame: ParsedPoseFrame,
): LandmarkRecordingPoseMetadata | undefined {
  const poseMetadata: LandmarkRecordingPoseMetadata = {};
  if (parsedFrame.metadata.imageLandmarks) {
    poseMetadata.imageLandmarks = parsedFrame.metadata.imageLandmarks.map(landmarkMetadataForRecording);
  }
  if (parsedFrame.metadata.worldLandmarks) {
    poseMetadata.worldLandmarks = parsedFrame.metadata.worldLandmarks.map(landmarkMetadataForRecording);
  }
  return poseMetadata.imageLandmarks || poseMetadata.worldLandmarks ? poseMetadata : undefined;
}

function compactFrameContext(
  frameContext?: PoseFrameGapMetadata | LandmarkRecordingFrameContext,
): LandmarkRecordingFrameContext {
  return {
    trackingInterrupted: frameContext?.trackingInterrupted === true,
    ...(typeof frameContext?.silentGapMs === 'number'
      ? { silentGapMs: frameContext.silentGapMs }
      : {}),
    ...(typeof frameContext?.reacquisitionFrameIndex === 'number'
      ? { reacquisitionFrameIndex: frameContext.reacquisitionFrameIndex }
      : {}),
  };
}

export function createLandmarkRecordingFrame(args: {
  parsedFrame: ParsedPoseFrame;
  timestamp: number;
  frameContext?: PoseFrameGapMetadata | LandmarkRecordingFrameContext;
}): LandmarkRecordingFrame {
  const { parsedFrame, timestamp, frameContext } = args;
  const poseMetadata = poseMetadataForRecording(parsedFrame);
  return {
    timestamp,
    ...(parsedFrame.timestampMs !== undefined ? { timestampMs: parsedFrame.timestampMs } : {}),
    status: parsedFrame.status === 'trackingLost' ? 'trackingLost' : 'poseDetected',
    keypoints: parsedFrame.keypoints,
    ...(parsedFrame.worldKeypoints ? { worldKeypoints: parsedFrame.worldKeypoints } : {}),
    ...(parsedFrame.imageKeypoints ? { imageKeypoints: parsedFrame.imageKeypoints } : {}),
    primarySource: parsedFrame.primarySource,
    frameContext: compactFrameContext(frameContext),
    ...(poseMetadata ? { poseMetadata } : {}),
  };
}
