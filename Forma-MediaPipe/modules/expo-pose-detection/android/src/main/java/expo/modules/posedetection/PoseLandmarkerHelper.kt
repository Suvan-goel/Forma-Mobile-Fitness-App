package expo.modules.posedetection

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.ImageProxy
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import java.nio.ByteBuffer

class PoseLandmarkerHelper(
  private val context: Context,
  private val modelAsset: String = "pose_landmarker_heavy.task",
  private val listener: ((PoseLandmarkerResult, Int, Int) -> Unit)? = null
) {
  companion object {
    private const val TAG = "PoseLandmarkerHelper"
    private const val MIN_POSE_DETECTION_CONFIDENCE = 0.35F
    private const val MIN_POSE_TRACKING_CONFIDENCE = 0.35F
    private const val MIN_POSE_PRESENCE_CONFIDENCE = 0.35F
  }

  private var poseLandmarker: PoseLandmarker? = null
  private var hasLoggedMissingLandmarker = false
  @Volatile
  private var isClosed = false
  private var lastFrameTimestampMs: Long = Long.MIN_VALUE

  init {
    setupPoseLandmarker()
  }

  private fun setupPoseLandmarker() {
    if (isClosed) return

    Log.d(TAG, "Setting up PoseLandmarker with model asset: $modelAsset")
    try {
      context.assets.open(modelAsset).use { stream ->
        Log.d(TAG, "Pose model asset found: $modelAsset (${stream.available()} bytes)")
      }
    } catch (e: Exception) {
      Log.e(TAG, "Pose model asset is missing or unreadable: $modelAsset", e)
      return
    }

    try {
      val baseOptions = BaseOptions.builder()
        .setDelegate(Delegate.GPU)
        .setModelAssetPath(modelAsset)
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
      Log.d(TAG, "PoseLandmarker initialized with GPU delegate for $modelAsset")
    } catch (e: Exception) {
      Log.w(TAG, "GPU delegate failed, falling back to CPU: ${e.message}")
      try {
        val baseOptions = BaseOptions.builder()
          .setDelegate(Delegate.CPU)
          .setModelAssetPath(modelAsset)
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
        Log.d(TAG, "PoseLandmarker initialized with CPU delegate (fallback) for $modelAsset")
      } catch (e2: Exception) {
        Log.e(TAG, "Failed to setup PoseLandmarker with $modelAsset: ${e2.message}", e2)
      }
    }
  }

  fun detectLiveStream(imageProxy: ImageProxy, isFrontCamera: Boolean) {
    if (isClosed) {
      imageProxy.close()
      return
    }

    // Capture values before close (prevents accessing invalid ImageProxy)
    val rotationDegrees = imageProxy.imageInfo.rotationDegrees
    val imageWidth = imageProxy.width
    val imageHeight = imageProxy.height

    val bitmapBuffer = try {
      rgbaImageProxyToBitmap(imageProxy)
    } catch (e: Exception) {
      Log.e(TAG, "Failed to convert camera frame for pose detection", e)
      return
    } finally {
      imageProxy.close()
    }

    // Apply rotation and mirror for front camera
    val matrix = Matrix().apply {
      postRotate(rotationDegrees.toFloat())
      if (isFrontCamera) {
        postScale(-1f, 1f, imageWidth.toFloat(), imageHeight.toFloat())
      }
    }

    val rotatedBitmap = try {
      Bitmap.createBitmap(
        bitmapBuffer, 0, 0, bitmapBuffer.width, bitmapBuffer.height, matrix, true
      )
    } catch (e: Exception) {
      bitmapBuffer.recycle()
      Log.e(TAG, "Failed to rotate camera frame for pose detection", e)
      return
    }
    if (rotatedBitmap !== bitmapBuffer) {
      bitmapBuffer.recycle()
    }

    if (isClosed) {
      rotatedBitmap.recycle()
      return
    }

    val mpImage = BitmapImageBuilder(rotatedBitmap).build()
    val frameTime = nextFrameTimestampMs()

    detectAsync(mpImage, frameTime)
  }

  private fun rgbaImageProxyToBitmap(imageProxy: ImageProxy): Bitmap {
    val imageWidth = imageProxy.width
    val imageHeight = imageProxy.height
    val plane = imageProxy.planes.firstOrNull()
      ?: throw IllegalStateException("Camera frame has no image planes")
    val buffer = plane.buffer.duplicate()
    buffer.rewind()

    val bitmapBuffer = Bitmap.createBitmap(imageWidth, imageHeight, Bitmap.Config.ARGB_8888)
    val bytesPerPixel = 4
    val expectedRowBytes = imageWidth * bytesPerPixel
    val rowStride = plane.rowStride
    val pixelStride = plane.pixelStride

    if (pixelStride == bytesPerPixel && rowStride == expectedRowBytes) {
      bitmapBuffer.copyPixelsFromBuffer(buffer)
      return bitmapBuffer
    }

    if (pixelStride < bytesPerPixel) {
      throw IllegalStateException("Unexpected RGBA pixel stride: $pixelStride")
    }

    val packedPixels = ByteArray(imageWidth * imageHeight * bytesPerPixel)
    val rowBuffer = ByteArray(rowStride)
    var outputOffset = 0

    for (row in 0 until imageHeight) {
      val rowStart = row * rowStride
      if (rowStart >= buffer.limit()) break

      buffer.position(rowStart)
      val bytesToRead = minOf(rowStride, buffer.remaining())
      buffer.get(rowBuffer, 0, bytesToRead)

      for (col in 0 until imageWidth) {
        val inputOffset = col * pixelStride
        if (inputOffset + 3 >= bytesToRead) break

        packedPixels[outputOffset] = rowBuffer[inputOffset]
        packedPixels[outputOffset + 1] = rowBuffer[inputOffset + 1]
        packedPixels[outputOffset + 2] = rowBuffer[inputOffset + 2]
        packedPixels[outputOffset + 3] = rowBuffer[inputOffset + 3]
        outputOffset += bytesPerPixel
      }
    }

    bitmapBuffer.copyPixelsFromBuffer(ByteBuffer.wrap(packedPixels))
    return bitmapBuffer
  }

  private fun detectAsync(mpImage: com.google.mediapipe.framework.image.MPImage, frameTime: Long) {
    try {
      if (isClosed) return
      val landmarker = poseLandmarker
      if (landmarker == null) {
        if (!hasLoggedMissingLandmarker) {
          Log.w(TAG, "Skipping pose detection because PoseLandmarker is not initialized")
          hasLoggedMissingLandmarker = true
        }
        return
      }
      landmarker.detectAsync(mpImage, frameTime)
    } catch (e: Exception) {
      Log.e(TAG, "Detection error: ${e.message}", e)
    }
  }

  private fun returnLivestreamResult(result: PoseLandmarkerResult, input: com.google.mediapipe.framework.image.MPImage) {
    if (isClosed) return
    listener?.invoke(result, input.height, input.width)
  }

  private fun returnLivestreamError(error: RuntimeException) {
    if (isClosed) return
    Log.e(TAG, "Pose detection error: ${error.message}")
  }

  fun clearPoseLandmarker() {
    if (isClosed && poseLandmarker == null) return
    isClosed = true
    try {
      poseLandmarker?.close()
    } catch (e: Exception) {
      Log.w(TAG, "Error while closing PoseLandmarker", e)
    } finally {
      poseLandmarker = null
    }
  }

  private fun nextFrameTimestampMs(): Long {
    val now = SystemClock.uptimeMillis()
    val next = if (now <= lastFrameTimestampMs) lastFrameTimestampMs + 1 else now
    lastFrameTimestampMs = next
    return next
  }
}
