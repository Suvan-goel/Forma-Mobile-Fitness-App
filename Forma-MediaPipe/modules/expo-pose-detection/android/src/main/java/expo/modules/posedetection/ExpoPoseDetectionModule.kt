package expo.modules.posedetection

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoPoseDetectionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoPoseDetection")

    Function("switchCamera") {
      ExpoPoseDetectionView.activeInstance?.switchCamera()
    }

    View(ExpoPoseDetectionView::class) {
      Events("onLandmark")

      Prop("frameLimit") { view: ExpoPoseDetectionView, limit: Int ->
        view.configureFrameLimit(limit)
      }

      Prop("showSkeleton") { view: ExpoPoseDetectionView, show: Boolean ->
        view.configureShowSkeleton(show)
      }

      Prop("modelName") { view: ExpoPoseDetectionView, name: String ->
        view.configureModelName(name)
      }
    }
  }
}
