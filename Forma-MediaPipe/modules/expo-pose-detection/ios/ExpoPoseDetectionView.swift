import ExpoModulesCore
import AVFoundation
import MediaPipeTasksVision
import UIKit

private enum PoseBackend: String {
  case mediapipe
  case vision3d
}

class ExpoPoseDetectionView: ExpoView {
  // MARK: - Event dispatcher
  let onLandmark = EventDispatcher()
  let onVisionFrame = EventDispatcher()

  // MARK: - Subviews
  private var previewView: UIView?
  private var previewLayer: AVCaptureVideoPreviewLayer?
  private var overlayView: OverlayView?

  // MARK: - Camera
  private let captureSession = AVCaptureSession()
  private var currentCameraPosition: AVCaptureDevice.Position = .front
  private var videoOutput: AVCaptureVideoDataOutput?
  private let sessionQueue = DispatchQueue(label: "expo.posedetection.session")
  private let processingQueue = DispatchQueue(label: "expo.posedetection.processing")

  // MARK: - Pose detection
  private var poseLandmarkerService: PoseLandmarkerService?
  private var visionPoseService: AnyObject?
  private let landmarkerQueue = DispatchQueue(
    label: "expo.posedetection.landmarker",
    attributes: .concurrent
  )

  // MARK: - Configuration
  private var frameLimit: Int = 30
  private var showSkeleton: Bool = false
  private var enableVisionDualEmit: Bool = false
  private var visionDualEmitStartedAtMs: Double?
  private var poseBackend: PoseBackend = .mediapipe
  private var visionHeightPrior: Double?
  private var modelName: String = "pose_landmarker_heavy"
  private var isSessionRunning = false
  private let lifecycleLock = NSLock()
  private var disposed = false

  private static let allowedModels: Set<String> = [
    "pose_landmarker_full",
    "pose_landmarker_heavy"
  ]

  // MARK: - Frame throttling
  private var lastProcessedFrameTimeMs: Double = 0
  private var lastPoseTimestampMs: Int = 0

  // MARK: - Video resolution tracking
  private var videoWidth: CGFloat = 720
  private var videoHeight: CGFloat = 1280

  // MARK: - Init

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    setupSubviews()
    setupCamera()
    ExpoPoseDetectionModule.activeView = self
  }

  // MARK: - Layout

  override func layoutSubviews() {
    super.layoutSubviews()
    previewView?.frame = bounds
    previewLayer?.frame = bounds
    overlayView?.frame = bounds
  }

  // MARK: - Lifecycle

  override func willMove(toSuperview newSuperview: UIView?) {
    super.willMove(toSuperview: newSuperview)
    if newSuperview == nil {
      dispose()
      if ExpoPoseDetectionModule.activeView === self {
        ExpoPoseDetectionModule.activeView = nil
      }
    }
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    if superview != nil, !isDisposed() {
      startSession()
    }
  }

  // MARK: - Configuration methods (called from Module props)

  func configureFrameLimit(_ limit: Int) {
    guard !isDisposed() else { return }
    frameLimit = max(1, min(60, limit))
    sessionQueue.async { [weak self] in
      self?.applyFrameLimitToActiveCamera()
    }
  }

  func configureShowSkeleton(_ show: Bool) {
    guard !isDisposed() else { return }
    showSkeleton = show
    DispatchQueue.main.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      self.overlayView?.isHidden = !show
      if !show {
        self.overlayView?.clear()
      }
    }
  }

  func configureModelName(_ name: String) {
    guard !isDisposed() else { return }
    let validName = Self.allowedModels.contains(name) ? name : "pose_landmarker_heavy"
    processingQueue.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      guard validName != self.modelName else { return }
      self.modelName = validName
      self.reinitializePoseLandmarker()
    }
  }

  func configurePoseBackend(_ backend: String) {
    guard !isDisposed() else { return }
    processingQueue.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      let nextBackend = PoseBackend(rawValue: backend) ?? .mediapipe
      guard self.poseBackend != nextBackend else { return }
      self.poseBackend = nextBackend

      if #available(iOS 17.0, *) {
        if nextBackend == .vision3d {
          if self.visionPoseService == nil {
            self.visionPoseService = VisionPoseService(delegate: self)
          }
          if let height = self.visionHeightPrior {
            (self.visionPoseService as? VisionPoseService)?.setHeightPrior(height)
          }
        } else if !self.enableVisionDualEmit {
          (self.visionPoseService as? VisionPoseService)?.close()
          self.visionPoseService = nil
        }
      }
    }
  }

  func configureVisionHeightPrior(_ height: Double?) {
    guard !isDisposed() else { return }
    processingQueue.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      guard let height = height, height > 0 else {
        self.visionHeightPrior = nil
        return
      }
      self.visionHeightPrior = height
      if #available(iOS 17.0, *) {
        (self.visionPoseService as? VisionPoseService)?.setHeightPrior(height)
      }
    }
  }

  func configureVisionDualEmit(_ enabled: Bool) {
    guard !isDisposed() else { return }
    processingQueue.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      let nextValue = enabled
      guard self.enableVisionDualEmit != nextValue else { return }
      self.enableVisionDualEmit = nextValue
      self.visionDualEmitStartedAtMs = nextValue ? ProcessInfo.processInfo.systemUptime * 1000 : nil

      if #available(iOS 17.0, *) {
        if nextValue {
          if self.visionPoseService == nil {
            self.visionPoseService = VisionPoseService(delegate: self)
          }
          if let height = self.visionHeightPrior {
            (self.visionPoseService as? VisionPoseService)?.setHeightPrior(height)
          }
        } else {
          if self.poseBackend != .vision3d {
            (self.visionPoseService as? VisionPoseService)?.close()
            self.visionPoseService = nil
          }
        }
      }
    }
  }

  func switchCamera() {
    sessionQueue.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      self.toggleCamera()
    }
  }

  // MARK: - Setup

  private func setupSubviews() {
    // Camera preview
    let preview = UIView()
    preview.frame = bounds
    addSubview(preview)
    previewView = preview

    // Skeleton overlay
    let overlay = OverlayView()
    overlay.frame = bounds
    overlay.backgroundColor = .clear
    overlay.isHidden = !showSkeleton
    addSubview(overlay)
    overlayView = overlay
  }

  private func setupCamera() {
    sessionQueue.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      self.configureSession()
    }
    processingQueue.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      self.initializePoseLandmarker()
    }
  }

  private func configureSession() {
    guard !isDisposed() else { return }

    captureSession.beginConfiguration()
    captureSession.sessionPreset = .hd1280x720

    // Add video input (front camera by default)
    guard let camera = AVCaptureDevice.default(
      .builtInWideAngleCamera,
      for: .video,
      position: currentCameraPosition
    ) else {
      captureSession.commitConfiguration()
      return
    }

    do {
      let input = try AVCaptureDeviceInput(device: camera)
      if captureSession.canAddInput(input) {
        captureSession.addInput(input)
      }

      try applyFrameLimit(to: camera)
    } catch {
      print("[ExpoPoseDetection] Camera input error: \(error)")
    }

    // Add video output
    let output = AVCaptureVideoDataOutput()
    output.alwaysDiscardsLateVideoFrames = true
    output.videoSettings = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
    ]
    output.setSampleBufferDelegate(self, queue: processingQueue)

    if captureSession.canAddOutput(output) {
      captureSession.addOutput(output)
      videoOutput = output

      // Set video orientation
      if let connection = output.connection(with: .video) {
        if connection.isVideoOrientationSupported {
          connection.videoOrientation = .portrait
        }
        if connection.isVideoMirroringSupported {
          connection.isVideoMirrored = (currentCameraPosition == .front)
        }
      }
    }

    captureSession.commitConfiguration()

    // Setup preview layer on main thread
    DispatchQueue.main.async { [weak self] in
      guard let self = self, !self.isDisposed(), let preview = self.previewView else { return }
      let layer = AVCaptureVideoPreviewLayer(session: self.captureSession)
      layer.videoGravity = .resizeAspectFill
      layer.frame = preview.bounds
      preview.layer.addSublayer(layer)
      self.previewLayer = layer
    }
  }

  private func applyFrameLimitToActiveCamera() {
    guard !isDisposed() else { return }
    guard let input = captureSession.inputs.compactMap({ $0 as? AVCaptureDeviceInput }).first else { return }
    do {
      try applyFrameLimit(to: input.device)
    } catch {
      print("[ExpoPoseDetection] Failed to apply frame limit: \(error)")
    }
  }

  private func applyFrameLimit(to camera: AVCaptureDevice) throws {
    try camera.lockForConfiguration()
    defer { camera.unlockForConfiguration() }

    let desiredFps = Double(frameLimit)

    // The format chosen by sessionPreset .hd1280x720 typically caps at 30 fps.
    // If the caller wants more, switch to a format that actually supports it,
    // otherwise AVCaptureDevice raises NSInvalidArgumentException on setActiveVideoMinFrameDuration.
    if let upgraded = bestFormat(for: camera, desiredFps: desiredFps),
       camera.activeFormat !== upgraded {
      camera.activeFormat = upgraded
    }

    // Clamp to what the active format actually supports — never request beyond the range.
    let supportedMax = camera.activeFormat.videoSupportedFrameRateRanges
      .map { $0.maxFrameRate }
      .max() ?? 30.0
    let clampedFps = max(1.0, min(desiredFps, supportedMax))

    let frameDuration = CMTime(value: 1, timescale: CMTimeScale(clampedFps))
    camera.activeVideoMinFrameDuration = frameDuration
    camera.activeVideoMaxFrameDuration = frameDuration
  }

  // Pick the smallest-area format at >= desiredFps. Prefers 1280x720 when available
  // to match sessionPreset .hd1280x720; otherwise falls back to the smallest fps-capable format.
  private func bestFormat(for camera: AVCaptureDevice, desiredFps: Double) -> AVCaptureDevice.Format? {
    let candidates = camera.formats.filter { format in
      format.videoSupportedFrameRateRanges.contains { range in
        desiredFps <= range.maxFrameRate + 0.001
      }
    }
    if candidates.isEmpty { return nil }

    let preferred = candidates.first { format in
      let dims = CMVideoFormatDescriptionGetDimensions(format.formatDescription)
      return dims.width == 1280 && dims.height == 720
    }
    if let preferred = preferred { return preferred }

    return candidates.min { lhs, rhs in
      let l = CMVideoFormatDescriptionGetDimensions(lhs.formatDescription)
      let r = CMVideoFormatDescriptionGetDimensions(rhs.formatDescription)
      return Int(l.width) * Int(l.height) < Int(r.width) * Int(r.height)
    }
  }

  private func initializePoseLandmarker() {
    guard !isDisposed() else { return }

    let service = PoseLandmarkerService(
      modelName: modelName,
      minPoseDetectionConfidence: 0.35,
      minPosePresenceConfidence: 0.35,
      minTrackingConfidence: 0.35,
      delegate: self
    )
    if service == nil && modelName != "pose_landmarker_full" {
      print("[ExpoPoseDetection] Model '\(modelName)' not found, falling back to pose_landmarker_full")
      poseLandmarkerService = PoseLandmarkerService(
        modelName: "pose_landmarker_full",
        minPoseDetectionConfidence: 0.35,
        minPosePresenceConfidence: 0.35,
        minTrackingConfidence: 0.35,
        delegate: self
      )
    } else {
      poseLandmarkerService = service
    }
  }

  private func reinitializePoseLandmarker() {
    guard !isDisposed() else { return }

    poseLandmarkerService?.clearPoseLandmarker()
    poseLandmarkerService = nil
    lastProcessedFrameTimeMs = 0
    lastPoseTimestampMs = 0
    initializePoseLandmarker()
  }

  // MARK: - Session control

  private func startSession() {
    sessionQueue.async { [weak self] in
      guard let self = self, !self.isDisposed(), !self.isSessionRunning else { return }
      self.captureSession.startRunning()
      self.isSessionRunning = true
    }
  }

  private func stopSession() {
    sessionQueue.async { [weak self] in
      guard let self = self, self.isSessionRunning else { return }
      self.captureSession.stopRunning()
      self.isSessionRunning = false
    }
  }

  private func dispose() {
    guard markDisposed() else { return }

    sessionQueue.async { [weak self] in
      guard let self = self else { return }

      self.videoOutput?.setSampleBufferDelegate(nil, queue: nil)
      if self.captureSession.isRunning {
        self.captureSession.stopRunning()
      }
      self.isSessionRunning = false

      self.captureSession.beginConfiguration()
      for output in self.captureSession.outputs {
        self.captureSession.removeOutput(output)
      }
      for input in self.captureSession.inputs {
        self.captureSession.removeInput(input)
      }
      self.captureSession.commitConfiguration()
      self.videoOutput = nil
    }

    processingQueue.async { [weak self] in
      guard let self = self else { return }
      self.poseLandmarkerService?.clearPoseLandmarker()
      self.poseLandmarkerService = nil
      if #available(iOS 17.0, *) {
        (self.visionPoseService as? VisionPoseService)?.close()
        self.visionPoseService = nil
      }
      self.enableVisionDualEmit = false
      self.visionDualEmitStartedAtMs = nil
      self.lastProcessedFrameTimeMs = 0
      self.lastPoseTimestampMs = 0
    }

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      self.previewLayer?.removeFromSuperlayer()
      self.previewLayer = nil
      self.overlayView?.clear()
    }
  }

  private func isDisposed() -> Bool {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    return disposed
  }

  private func markDisposed() -> Bool {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    if disposed {
      return false
    }
    disposed = true
    return true
  }

  // MARK: - Camera switching

  private func toggleCamera() {
    guard !isDisposed() else { return }

    captureSession.beginConfiguration()

    // Remove existing input
    for input in captureSession.inputs {
      captureSession.removeInput(input)
    }

    // Toggle position
    currentCameraPosition = (currentCameraPosition == .front) ? .back : .front

    // Add new input
    guard let camera = AVCaptureDevice.default(
      .builtInWideAngleCamera,
      for: .video,
      position: currentCameraPosition
    ) else {
      captureSession.commitConfiguration()
      return
    }

    do {
      let input = try AVCaptureDeviceInput(device: camera)
      if captureSession.canAddInput(input) {
        captureSession.addInput(input)
      }

      try applyFrameLimit(to: camera)
    } catch {
      print("[ExpoPoseDetection] Camera switch error: \(error)")
    }

    // Update mirroring
    if let connection = videoOutput?.connection(with: .video) {
      if connection.isVideoMirroringSupported {
        connection.isVideoMirrored = (currentCameraPosition == .front)
      }
    }

    captureSession.commitConfiguration()
  }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension ExpoPoseDetectionView: AVCaptureVideoDataOutputSampleBufferDelegate {
  func captureOutput(
    _ output: AVCaptureOutput,
    didOutput sampleBuffer: CMSampleBuffer,
    from connection: AVCaptureConnection
  ) {
    guard !isDisposed() else { return }

    // Frame throttling
    let now = ProcessInfo.processInfo.systemUptime * 1000
    let minIntervalMs = 1000.0 / Double(frameLimit)
    if now - lastProcessedFrameTimeMs < minIntervalMs {
      return
    }
    lastProcessedFrameTimeMs = now
    let timestamp = nextPoseTimestampMs(now)

    // Track video resolution from the sample buffer
    if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
      let width = CVPixelBufferGetWidth(pixelBuffer)
      let height = CVPixelBufferGetHeight(pixelBuffer)
      videoWidth = CGFloat(width)
      videoHeight = CGFloat(height)
    }

    if poseBackend == .mediapipe {
      poseLandmarkerService?.detectAsync(
        sampleBuffer: sampleBuffer,
        orientation: .up,
        timeStamps: timestamp
      )
    }

    if shouldRunVision(now) {
      if #available(iOS 17.0, *) {
        (visionPoseService as? VisionPoseService)?.detect(
          sampleBuffer: sampleBuffer,
          orientation: .up,
          timestampMs: timestamp
        )
      }
    }
  }

  private func shouldRunVision(_ nowMs: Double) -> Bool {
    if poseBackend == .vision3d { return true }
    return shouldRunVisionDualEmit(nowMs)
  }

  private func shouldRunVisionDualEmit(_ nowMs: Double) -> Bool {
    guard enableVisionDualEmit else { return false }
    guard let startedAt = visionDualEmitStartedAtMs else { return false }
    if nowMs - startedAt > 5 * 60 * 1000 {
      enableVisionDualEmit = false
      visionDualEmitStartedAtMs = nil
      if #available(iOS 17.0, *) {
        if poseBackend != .vision3d {
          (visionPoseService as? VisionPoseService)?.close()
          visionPoseService = nil
        }
      }
      return false
    }
    return true
  }

  private func nextPoseTimestampMs(_ now: Double) -> Int {
    let current = Int(now)
    let next = max(current, lastPoseTimestampMs + 1)
    lastPoseTimestampMs = next
    return next
  }
}

// MARK: - PoseLandmarkerServiceDelegate

extension ExpoPoseDetectionView: PoseLandmarkerServiceDelegate {
  func poseLandmarkerService(
    _ service: PoseLandmarkerService,
    didFinishDetection result: PoseLandmarkerResult?,
    error: Error?
  ) {
    guard !isDisposed(), let result = result else { return }
    let imageSize = CGSize(width: videoWidth, height: videoHeight)

    DispatchQueue.main.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }

      // Build landmark data in the same format as @thinksys
      guard let landmarks = result.landmarks.first else { return }
      let worldLandmarks = result.worldLandmarks.first

      var landmarksArray: [[String: Any]] = []
      for landmark in landmarks {
        landmarksArray.append([
          "x": landmark.x,
          "y": landmark.y,
          "z": landmark.z,
          "visibility": landmark.visibility?.floatValue ?? 0.0,
          "presence": landmark.presence?.floatValue ?? 0.0
        ])
      }

      var worldLandmarksArray: [[String: Any]] = []
      if let worldLandmarks = worldLandmarks {
        for landmark in worldLandmarks {
          worldLandmarksArray.append([
            "x": landmark.x,
            "y": landmark.y,
            "z": landmark.z,
            "visibility": landmark.visibility?.floatValue ?? 0.0,
            "presence": landmark.presence?.floatValue ?? 0.0
          ])
        }
      }

      let payload: [String: Any] = [
        "landmarks": landmarksArray,
        "worldLandmarks": worldLandmarksArray,
        "additionalData": [
          "height": imageSize.height,
          "width": imageSize.width
        ]
      ]

      // Emit landmark data to JS
      self.onLandmark(payload)

      // Update skeleton overlay
      if self.showSkeleton, let overlayView = self.overlayView {
        let poseOverlays = overlayView.poseOverlays(
          fromLandmarks: result.landmarks,
          inferredOnImageOfSize: imageSize,
          overlayViewSize: overlayView.bounds.size,
          imageContentMode: .scaleAspectFill
        )
        overlayView.draw(
          poseOverlays: poseOverlays,
          inBoundsOfContentImageOfSize: imageSize,
          imageContentMode: .scaleAspectFill
        )
      }
    }
  }
}

// MARK: - VisionPoseServiceDelegate

@available(iOS 17.0, *)
extension ExpoPoseDetectionView: VisionPoseServiceDelegate {
  func visionPoseService(
    _ service: VisionPoseService,
    didEmitFrame payload: [String: Any],
    timestampMs: Int
  ) {
    guard !isDisposed() else { return }
    // Emit when vision3d is the primary backend, or when dual-emit (Phase 2 dark mode) is on.
    guard poseBackend == .vision3d || enableVisionDualEmit else { return }
    DispatchQueue.main.async { [weak self] in
      guard let self = self, !self.isDisposed() else { return }
      guard self.poseBackend == .vision3d || self.enableVisionDualEmit else { return }
      self.onVisionFrame(payload)
    }
  }
}
