package expo.modules.posedetection

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarkerResult
import kotlin.math.max

class OverlayView @JvmOverloads constructor(
  context: Context,
  attrs: AttributeSet? = null,
  defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

  companion object {
    private const val LANDMARK_STROKE_WIDTH = 10F
  }

  private var results: PoseLandmarkerResult? = null
  private var imageHeight: Int = 1
  private var imageWidth: Int = 1
  private var scaleFactor: Float = 1f
  private var offsetX: Float = 0f
  private var offsetY: Float = 0f

  private val linePaint = Paint().apply {
    color = Color.WHITE
    strokeWidth = LANDMARK_STROKE_WIDTH
    style = Paint.Style.STROKE
    isAntiAlias = true
  }

  fun setResults(
    poseLandmarkerResults: PoseLandmarkerResult,
    inputImageHeight: Int,
    inputImageWidth: Int
  ) {
    results = poseLandmarkerResults
    imageHeight = inputImageHeight
    imageWidth = inputImageWidth

    // FILL_CENTER scaling (same as @thinksys LIVE_STREAM mode)
    scaleFactor = max(width * 1f / imageWidth, height * 1f / imageHeight)
    offsetX = (width - imageWidth * scaleFactor) / 2f
    offsetY = (height - imageHeight * scaleFactor) / 2f

    invalidate()
  }

  fun clear() {
    results = null
    invalidate()
  }

  override fun draw(canvas: Canvas) {
    super.draw(canvas)

    val poseLandmarkerResult = results ?: return
    val landmarks = poseLandmarkerResult.landmarks()
    if (landmarks.isEmpty()) return

    val pose = landmarks[0]
    val connections = PoseLandmarker.POSE_LANDMARKS

    for (conn in connections) {
      val startIdx = conn.start()
      val endIdx = conn.end()

      if (startIdx < pose.size && endIdx < pose.size) {
        val startX = lx(pose[startIdx].x())
        val startY = ly(pose[startIdx].y())
        val endX = lx(pose[endIdx].x())
        val endY = ly(pose[endIdx].y())

        canvas.drawLine(startX, startY, endX, endY, linePaint)
      }
    }
  }

  private fun lx(normalizedX: Float): Float =
    normalizedX * imageWidth * scaleFactor + offsetX

  private fun ly(normalizedY: Float): Float =
    normalizedY * imageHeight * scaleFactor + offsetY
}
