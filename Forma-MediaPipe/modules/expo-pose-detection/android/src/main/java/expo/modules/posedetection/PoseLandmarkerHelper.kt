package expo.modules.posedetection

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.util.Log
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult

class PoseLandmarkerHelper(
  private val context: Context,
  private val listener: ((PoseLandmarkerResult, Int, Int) -> Unit)? = null
) {
  companion object {
    private const val TAG = "PoseLandmarkerHelper"
    private const val MODEL_ASSET = "pose_landmarker_full.task"
    private const val MIN_POSE_DETECTION_CONFIDENCE = 0.35F
    private const val MIN_POSE_TRACKING_CONFIDENCE = 0.35F
    private const val MIN_POSE_PRESENCE_CONFIDENCE = 0.35F
  }

  private var poseLandmarker: PoseLandmarker? = null

  init {
    setupPoseLandmarker()
  }

  private fun setupPoseLandmarker() {
    try {
      val baseOptions = BaseOptions.builder()
        .setDelegate(Delegate.CPU)
        .setModelAssetPath(MODEL_ASSET)
        .build()

      val options = PoseLandmarker.PoseLandmarkerOptions.builder()
        .setBaseOptions(baseOptions)
        .setRunningMode(RunningMode.LIVE_STREAM)
        .setNumPoses(1)
        .setMinPoseDetectionConfidence(MIN_POSE_DETECTION_CONFIDENCE)
        .setMinTrackingConfidence(MIN_POSE_TRACKING_CONFIDENCE)
        .setMinPosePresenceConfidence(MIN_POSE_PRESENCE_CONFIDENCE)
        .setResultListener(this::returnLivestreamResult)
        .setErrorListener(this::returnLivestreamError)
        .build()

      poseLandmarker = PoseLandmarker.createFromOptions(context, options)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to setup PoseLandmarker: ${e.message}")
    }
  }

  fun detectLiveStream(imageProxy: ImageProxy, isFrontCamera: Boolean) {
    // Capture values before close (prevents accessing invalid ImageProxy)
    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
    val imageWidth = imageProxy.width
    val imageHeight = imageProxy.height

    val bitmapBuffer = Bitmap.createBitmap(imageWidth, imageHeight, Bitmap.Config.ARGB_8888)
    imageProxy.use { bitmapBuffer.copyPixelsFromBuffer(imageProxy.planes[0].buffer) }

    // Apply rotation and mirror for front camera
    val matrix = Matrix().apply {
      postRotate(rotationDegrees.toFloat())
      if (isFrontCamera) {
        postScale(-1f, 1f, imageWidth.toFloat(), imageHeight.toFloat())
      }
    }

    val rotatedBitmap = Bitmap.createBitmap(
      bitmapBuffer, 0, 0, bitmapBuffer.width, bitmapBuffer.height, matrix, true
    )

    val mpImage = BitmapImageBuilder(rotatedBitmap).build()
    val frameTime = System.currentTimeMillis()

    detectAsync(mpImage, frameTime)
  }

  private fun detectAsync(mpImage: com.google.mediapipe.framework.image.MPImage, frameTime: Long) {
    try {
      poseLandmarker?.detectAsync(mpImage, frameTime)
    } catch (e: Exception) {
      Log.e(TAG, "Detection error: ${e.message}")
    }
  }

  private fun returnLivestreamResult(result: PoseLandmarkerResult, input: com.google.mediapipe.framework.image.MPImage) {
    val finishTimeMs = System.currentTimeMillis()
    listener?.invoke(result, input.height, input.width)
  }

  private fun returnLivestreamError(error: RuntimeException) {
    Log.e(TAG, "Pose detection error: ${error.message}")
  }

  fun clearPoseLandmarker() {
    poseLandmarker?.close()
    poseLandmarker = null
  }
}
