package expo.modules.posedetection

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import androidx.camera.core.AspectRatio
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class ExpoPoseDetectionView(
  context: Context,
  appContext: AppContext
) : ExpoView(context, appContext) {

  // ExpoView extends LinearLayout and defaults to Yoga-only layout.
  // Override to enable Android-native layout so child views get measured/laid out.
  override val shouldUseAndroidLayout: Boolean = true

  companion object {
    private const val TAG = "ExpoPoseDetection"
    private val ALLOWED_MODELS = setOf("pose_landmarker_full", "pose_landmarker_heavy")

    @JvmStatic
    var activeInstance: ExpoPoseDetectionView? = null
  }

  // Event dispatcher for landmark data
  val onLandmark by EventDispatcher()

  // Configuration
  private var frameLimit: Int = 30
  private var showSkeleton: Boolean = false
  @Volatile
  private var currentModelName: String = "pose_landmarker_heavy"
  @Volatile
  private var isDisposed = false

  // Camera
  private var cameraProvider: ProcessCameraProvider? = null
  @Volatile
  private var cameraFacing = CameraSelector.LENS_FACING_FRONT
  private val backgroundExecutor = Executors.newSingleThreadExecutor()
  private val previewView: PreviewView
  private val overlayView: OverlayView

  // Pose detection
  private var poseLandmarkerHelper: PoseLandmarkerHelper? = null

  // Frame throttling
  private var lastProcessedFrameTimeMs: Long = 0

  init {
    activeInstance = this

    // Use a FrameLayout container so PreviewView and OverlayView overlap (stack)
    // rather than being arranged vertically by the LinearLayout parent.
    val container = FrameLayout(context).apply {
      layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    }

    previewView = PreviewView(context).apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    }
    container.addView(previewView)

    overlayView = OverlayView(context).apply {
      layoutParams = FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT
      )
      visibility = if (showSkeleton) VISIBLE else GONE
    }
    container.addView(overlayView)

    addView(container)

    // Initialize pose helper on background thread
    runOnBackground {
      if (isDisposed) return@runOnBackground
      poseLandmarkerHelper = PoseLandmarkerHelper(
        context = context,
        modelAsset = "${currentModelName}.task",
        listener = ::handlePoseResult
      )
    }

    // Start camera
    setupCamera()
  }

  // MARK: - Configuration

  fun configureFrameLimit(limit: Int) {
    if (isDisposed) return
    frameLimit = limit.coerceIn(1, 60)
  }

  fun configureShowSkeleton(show: Boolean) {
    if (isDisposed) return
    showSkeleton = show
    post {
      if (isDisposed) return@post
      overlayView.visibility = if (show) VISIBLE else GONE
      if (!show) overlayView.clear()
    }
  }

  fun configureModelName(name: String) {
    if (isDisposed) return
    val validName = if (ALLOWED_MODELS.contains(name)) name else "pose_landmarker_heavy"
    if (validName == currentModelName) return
    currentModelName = validName
    val modelAsset = "${validName}.task"
    runOnBackground {
      if (isDisposed) return@runOnBackground
      poseLandmarkerHelper?.clearPoseLandmarker()
      lastProcessedFrameTimeMs = 0
      if (isDisposed) return@runOnBackground
      poseLandmarkerHelper = PoseLandmarkerHelper(
        context = context,
        modelAsset = modelAsset,
        listener = ::handlePoseResult
      )
    }
  }

  fun configureVisionDualEmit(enabled: Boolean) {
    // Vision 3D is iOS-only. Android remains MediaPipe-only in Phase 2.
  }

  fun switchCamera() {
    // Must run on main thread — switchCamera() is called from the JS thread
    // via Expo Module Function, but CameraX requires the main thread.
    if (isDisposed) return
    post {
      if (isDisposed) return@post
      cameraFacing = if (cameraFacing == CameraSelector.LENS_FACING_FRONT)
        CameraSelector.LENS_FACING_BACK
      else
        CameraSelector.LENS_FACING_FRONT
      bindCameraUseCases()
    }
  }

  // MARK: - Camera Setup

  private fun setupCamera() {
    val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
    cameraProviderFuture.addListener({
      if (isDisposed) {
        try {
          cameraProviderFuture.get().unbindAll()
        } catch (_: Exception) {}
        return@addListener
      }
      cameraProvider = try {
        cameraProviderFuture.get()
      } catch (e: Exception) {
        Log.e(TAG, "Failed to get camera provider", e)
        return@addListener
      }
      bindCameraUseCases()
    }, ContextCompat.getMainExecutor(context))
  }

  private fun bindCameraUseCases() {
    if (isDisposed) return
    val rawActivity = appContext.currentActivity
    if (rawActivity == null) {
      Log.w(TAG, "bindCameraUseCases: currentActivity is null, deferring")
      return
    }
    val activity = rawActivity as? FragmentActivity
    if (activity == null) {
      Log.e(TAG, "bindCameraUseCases: activity is not FragmentActivity: ${rawActivity.javaClass.name}")
      return
    }
    val provider = cameraProvider
    if (provider == null) {
      Log.w(TAG, "bindCameraUseCases: cameraProvider is null")
      return
    }

    val preview = Preview.Builder()
      .setTargetAspectRatio(AspectRatio.RATIO_4_3)
      .build()

    val imageAnalysis = ImageAnalysis.Builder()
      .setTargetAspectRatio(AspectRatio.RATIO_4_3)
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .build()
      .also {
        it.setAnalyzer(backgroundExecutor) { imageProxy ->
          if (isDisposed) {
            imageProxy.close()
          } else {
            detectPose(imageProxy)
          }
        }
      }

    val cameraSelector = CameraSelector.Builder()
      .requireLensFacing(cameraFacing)
      .build()

    try {
      provider.unbindAll()
      provider.bindToLifecycle(activity, cameraSelector, preview, imageAnalysis)
      preview.setSurfaceProvider(previewView.surfaceProvider)
      Log.d(TAG, "Camera bound successfully, facing=${if (cameraFacing == CameraSelector.LENS_FACING_FRONT) "FRONT" else "BACK"}")
    } catch (e: Exception) {
      Log.e(TAG, "Camera binding failed", e)
    }
  }

  // MARK: - Pose Detection

  private fun detectPose(imageProxy: ImageProxy) {
    if (isDisposed) {
      imageProxy.close()
      return
    }

    // Frame throttling (built in — no patch needed)
    val minIntervalMs = 1000L / frameLimit.coerceIn(1, 60)
    val now = System.currentTimeMillis()
    if (now - lastProcessedFrameTimeMs < minIntervalMs) {
      imageProxy.close()
      return
    }
    lastProcessedFrameTimeMs = now

    // Capture values before close (the imageProxy lifecycle fix from patch #4)
    val helper = poseLandmarkerHelper
    if (helper == null) {
      imageProxy.close()
      return
    }

    try {
      helper.detectLiveStream(
        imageProxy = imageProxy,
        isFrontCamera = cameraFacing == CameraSelector.LENS_FACING_FRONT
      )
    } catch (e: Exception) {
      Log.e(TAG, "Pose detection failed for camera frame", e)
      try {
        imageProxy.close()
      } catch (_: Exception) {}
    }
  }

  // MARK: - Pose Result Handler

  private fun handlePoseResult(
    result: PoseLandmarkerResult,
    inputImageHeight: Int,
    inputImageWidth: Int
  ) {
    if (isDisposed) return

    // Build landmark data on background thread (off main thread — patch #6 built in)
    val landmarks = result.landmarks()
    if (landmarks.isEmpty()) return

    val firstPose = landmarks[0]
    val worldLandmarks = result.worldLandmarks()
    val firstWorldPose = if (worldLandmarks.isNotEmpty()) worldLandmarks[0] else null

    val landmarksArray = mutableListOf<Map<String, Any>>()
    for (lm in firstPose) {
      landmarksArray.add(mapOf(
        "x" to lm.x(),
        "y" to lm.y(),
        "z" to lm.z(),
        "visibility" to (lm.visibility().orElse(0f)),
        "presence" to (lm.presence().orElse(0f))
      ))
    }

    val worldLandmarksArray = mutableListOf<Map<String, Any>>()
    if (firstWorldPose != null) {
      for (lm in firstWorldPose) {
        worldLandmarksArray.add(mapOf(
          "x" to lm.x(),
          "y" to lm.y(),
          "z" to lm.z(),
          "visibility" to (lm.visibility().orElse(0f)),
          "presence" to (lm.presence().orElse(0f))
        ))
      }
    }

    val payload = mapOf(
      "landmarks" to landmarksArray,
      "worldLandmarks" to worldLandmarksArray,
      "additionalData" to mapOf(
        "height" to inputImageHeight,
        "width" to inputImageWidth
      )
    )

    // Emit to JS and update overlay on main thread
    post {
      if (isDisposed || !isAttachedToWindow) return@post
      onLandmark(payload)

      if (showSkeleton) {
        overlayView.setResults(
          result,
          inputImageHeight,
          inputImageWidth
        )
      }
    }
  }

  // MARK: - Lifecycle

  override fun onDetachedFromWindow() {
    if (isDisposed) {
      super.onDetachedFromWindow()
      return
    }
    isDisposed = true
    if (activeInstance === this) {
      activeInstance = null
    }

    super.onDetachedFromWindow()
    try {
      cameraProvider?.unbindAll()
    } catch (_: Exception) {}
    runOnBackground {
      poseLandmarkerHelper?.clearPoseLandmarker()
      poseLandmarkerHelper = null
      backgroundExecutor.shutdown()
    }
  }

  private fun runOnBackground(action: () -> Unit) {
    if (backgroundExecutor.isShutdown || backgroundExecutor.isTerminated) return
    try {
      backgroundExecutor.execute(action)
    } catch (e: RejectedExecutionException) {
      Log.w(TAG, "Background executor rejected work during teardown", e)
    }
  }
}
