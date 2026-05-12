import UIKit
import MediaPipeTasksVision
import AVFoundation

protocol PoseLandmarkerServiceDelegate: AnyObject {
  func poseLandmarkerService(
    _ service: PoseLandmarkerService,
    didFinishDetection result: PoseLandmarkerResult?,
    timestampInMilliseconds: Int,
    error: Error?
  )
}

class PoseLandmarkerService: NSObject {
  weak var delegate: PoseLandmarkerServiceDelegate?

  private var poseLandmarker: PoseLandmarker?
  private let lifecycleLock = NSLock()
  private var closed = false
  private let minPoseDetectionConfidence: Float
  private let minPosePresenceConfidence: Float
  private let minTrackingConfidence: Float

  init?(
    modelName: String,
    minPoseDetectionConfidence: Float = 0.35,
    minPosePresenceConfidence: Float = 0.35,
    minTrackingConfidence: Float = 0.35,
    delegate: PoseLandmarkerServiceDelegate? = nil
  ) {
    self.minPoseDetectionConfidence = minPoseDetectionConfidence
    self.minPosePresenceConfidence = minPosePresenceConfidence
    self.minTrackingConfidence = minTrackingConfidence
    self.delegate = delegate
    super.init()

    guard let modelPath = Bundle.main.path(forResource: modelName, ofType: "task") else {
      print("[PoseLandmarkerService] Model file not found: \(modelName).task")
      return nil
    }

    let options = PoseLandmarkerOptions()
    options.runningMode = .liveStream
    options.numPoses = 1
    options.minPoseDetectionConfidence = minPoseDetectionConfidence
    options.minPosePresenceConfidence = minPosePresenceConfidence
    options.minTrackingConfidence = minTrackingConfidence
    options.baseOptions.modelAssetPath = modelPath
    options.baseOptions.delegate = .GPU
    options.poseLandmarkerLiveStreamDelegate = self

    do {
      poseLandmarker = try PoseLandmarker(options: options)
      print("[PoseLandmarkerService] Initialized with GPU delegate")
    } catch {
      print("[PoseLandmarkerService] GPU delegate failed, falling back to CPU: \(error)")
      options.baseOptions.delegate = .CPU
      do {
        poseLandmarker = try PoseLandmarker(options: options)
        print("[PoseLandmarkerService] Initialized with CPU delegate (fallback)")
      } catch {
        print("[PoseLandmarkerService] Failed to create PoseLandmarker: \(error)")
        return nil
      }
    }
  }

  func detectAsync(
    sampleBuffer: CMSampleBuffer,
    orientation: UIImage.Orientation,
    timeStamps: Int
  ) {
    guard !isClosed(), let poseLandmarker = poseLandmarker else {
      return
    }
    guard let image = try? MPImage(sampleBuffer: sampleBuffer, orientation: orientation) else {
      return
    }
    do {
      try poseLandmarker.detectAsync(image: image, timestampInMilliseconds: timeStamps)
    } catch {
      print("[PoseLandmarkerService] Detection error: \(error)")
    }
  }

  func clearPoseLandmarker() {
    markClosed()
    delegate = nil
    poseLandmarker = nil
  }

  private func isClosed() -> Bool {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    return closed
  }

  private func markClosed() {
    lifecycleLock.lock()
    closed = true
    lifecycleLock.unlock()
  }
}

// MARK: - PoseLandmarkerLiveStreamDelegate

extension PoseLandmarkerService: PoseLandmarkerLiveStreamDelegate {
  func poseLandmarker(
    _ poseLandmarker: PoseLandmarker,
    didFinishDetection result: PoseLandmarkerResult?,
    timestampInMilliseconds: Int,
    error: (any Error)?
  ) {
    guard !isClosed() else { return }
    delegate?.poseLandmarkerService(
      self,
      didFinishDetection: result,
      timestampInMilliseconds: timestampInMilliseconds,
      error: error
    )
  }
}
