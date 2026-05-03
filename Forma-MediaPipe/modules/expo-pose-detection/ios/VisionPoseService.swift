import AVFoundation
import ARKit
import ImageIO
import Vision

@available(iOS 17.0, *)
protocol VisionPoseServiceDelegate: AnyObject {
  func visionPoseService(
    _ service: VisionPoseService,
    didEmitFrame payload: [String: Any],
    timestampMs: Int
  )
}

@available(iOS 17.0, *)
final class VisionPoseService {
  weak var delegate: VisionPoseServiceDelegate?

  private let visionQueue = DispatchQueue(label: "expo.posedetection.vision3d", qos: .userInteractive)
  private let lifecycleLock = NSLock()
  private var closed = false
  private var inFlight = false

  init(delegate: VisionPoseServiceDelegate? = nil) {
    self.delegate = delegate
  }

  func detect(
    sampleBuffer: CMSampleBuffer,
    orientation: CGImagePropertyOrientation,
    timestampMs: Int
  ) {
    guard reserveRequest() else { return }

    visionQueue.async { [weak self] in
      guard let self = self else { return }
      defer { self.finishRequest() }
      guard !self.isClosed() else { return }

      let request = VNDetectHumanBodyPose3DRequest()
      let handler = VNImageRequestHandler(
        cmSampleBuffer: sampleBuffer,
        orientation: orientation,
        options: [:]
      )

      do {
        try handler.perform([request])
      } catch {
        print("[VisionPoseService] Vision 3D request failed: \(error)")
        return
      }

      guard let observation = request.results?.first else {
        return
      }

      let sourceQuality = ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)
        ? "lidar"
        : "estimated_height"
      guard let payload = VisionToCanonicalMapper.map(
        observation: observation,
        timestampMs: timestampMs,
        sourceQuality: sourceQuality
      ) else {
        return
      }

      self.delegate?.visionPoseService(self, didEmitFrame: payload, timestampMs: timestampMs)
    }
  }

  func close() {
    lifecycleLock.lock()
    closed = true
    delegate = nil
    lifecycleLock.unlock()
  }

  private func reserveRequest() -> Bool {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    guard !closed, !inFlight else { return false }
    inFlight = true
    return true
  }

  private func finishRequest() {
    lifecycleLock.lock()
    inFlight = false
    lifecycleLock.unlock()
  }

  private func isClosed() -> Bool {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    return closed
  }
}
