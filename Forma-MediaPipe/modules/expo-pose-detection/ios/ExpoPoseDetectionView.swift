import ExpoModulesCore
import AVFoundation
import MediaPipeTasksVision
import UIKit

class ExpoPoseDetectionView: ExpoView {
  // MARK: - Event dispatcher
  let onLandmark = EventDispatcher()

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
  private let landmarkerQueue = DispatchQueue(
    label: "expo.posedetection.landmarker",
    attributes: .concurrent
  )

  // MARK: - Configuration
  private var frameLimit: Int = 20
  private var showSkeleton: Bool = false
  private var modelName: String = "pose_landmarker_heavy"
  private var isSessionRunning = false

  private static let allowedModels: Set<String> = [
    "pose_landmarker_full",
    "pose_landmarker_heavy"
  ]

  // MARK: - Frame throttling
  private var lastProcessedFrameTimeMs: Double = 0

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
      stopSession()
      if ExpoPoseDetectionModule.activeView === self {
        ExpoPoseDetectionModule.activeView = nil
      }
    }
  }

  override func didMoveToSuperview() {
    super.didMoveToSuperview()
    if superview != nil {
      startSession()
    }
  }

  // MARK: - Configuration methods (called from Module props)

  func configureFrameLimit(_ limit: Int) {
    frameLimit = max(1, min(60, limit))
  }

  func configureShowSkeleton(_ show: Bool) {
    showSkeleton = show
    DispatchQueue.main.async { [weak self] in
      self?.overlayView?.isHidden = !show
      if !show {
        self?.overlayView?.clear()
      }
    }
  }

  func configureModelName(_ name: String) {
    let validName = Self.allowedModels.contains(name) ? name : "pose_landmarker_heavy"
    guard validName != modelName else { return }
    modelName = validName
    sessionQueue.async { [weak self] in
      self?.reinitializePoseLandmarker()
    }
  }

  func switchCamera() {
    sessionQueue.async { [weak self] in
      self?.toggleCamera()
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
      self?.configureSession()
      self?.initializePoseLandmarker()
    }
  }

  private func configureSession() {
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

      // Configure frame rate
      try camera.lockForConfiguration()
      let frameDuration = CMTimeMake(value: 1, timescale: Int32(frameLimit))
      camera.activeVideoMinFrameDuration = frameDuration
      camera.activeVideoMaxFrameDuration = frameDuration
      camera.unlockForConfiguration()
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
      guard let self = self, let preview = self.previewView else { return }
      let layer = AVCaptureVideoPreviewLayer(session: self.captureSession)
      layer.videoGravity = .resizeAspectFill
      layer.frame = preview.bounds
      preview.layer.addSublayer(layer)
      self.previewLayer = layer
    }
  }

  private func initializePoseLandmarker() {
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
    poseLandmarkerService?.clearPoseLandmarker()
    poseLandmarkerService = nil
    lastProcessedFrameTimeMs = 0
    initializePoseLandmarker()
  }

  // MARK: - Session control

  private func startSession() {
    sessionQueue.async { [weak self] in
      guard let self = self, !self.isSessionRunning else { return }
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

  // MARK: - Camera switching

  private func toggleCamera() {
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

      // Update frame rate
      try camera.lockForConfiguration()
      let frameDuration = CMTimeMake(value: 1, timescale: Int32(frameLimit))
      camera.activeVideoMinFrameDuration = frameDuration
      camera.activeVideoMaxFrameDuration = frameDuration
      camera.unlockForConfiguration()
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
    // Frame throttling
    let now = Date().timeIntervalSince1970 * 1000
    let minIntervalMs = 1000.0 / Double(frameLimit)
    if now - lastProcessedFrameTimeMs < minIntervalMs {
      return
    }
    lastProcessedFrameTimeMs = now

    // Track video resolution from the sample buffer
    if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
      let width = CVPixelBufferGetWidth(pixelBuffer)
      let height = CVPixelBufferGetHeight(pixelBuffer)
      videoWidth = CGFloat(width)
      videoHeight = CGFloat(height)
    }

    // Send to pose detection
    let timestamp = Int(now)
    poseLandmarkerService?.detectAsync(
      sampleBuffer: sampleBuffer,
      orientation: .up,
      timeStamps: timestamp
    )
  }
}

// MARK: - PoseLandmarkerServiceDelegate

extension ExpoPoseDetectionView: PoseLandmarkerServiceDelegate {
  func poseLandmarkerService(
    _ service: PoseLandmarkerService,
    didFinishDetection result: PoseLandmarkerResult?,
    error: Error?
  ) {
    guard let result = result else { return }

    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }

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
          "height": self.videoHeight,
          "width": self.videoWidth
        ]
      ]

      // Emit landmark data to JS
      self.onLandmark(payload)

      // Update skeleton overlay
      if self.showSkeleton, let overlayView = self.overlayView {
        let imageSize = CGSize(width: self.videoWidth, height: self.videoHeight)
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
