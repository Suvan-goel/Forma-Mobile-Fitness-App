import ExpoModulesCore

public class ExpoPoseDetectionModule: Module {
  static weak var activeView: ExpoPoseDetectionView?

  public func definition() -> ModuleDefinition {
    Name("ExpoPoseDetection")

    Function("switchCamera") {
      DispatchQueue.main.async {
        ExpoPoseDetectionModule.activeView?.switchCamera()
      }
    }

    View(ExpoPoseDetectionView.self) {
      Events("onLandmark", "onVisionFrame")

      Prop("frameLimit") { (view: ExpoPoseDetectionView, limit: Int) in
        view.configureFrameLimit(limit)
      }

      Prop("showSkeleton") { (view: ExpoPoseDetectionView, show: Bool) in
        view.configureShowSkeleton(show)
      }

      Prop("modelName") { (view: ExpoPoseDetectionView, name: String) in
        view.configureModelName(name)
      }

      Prop("enableVisionDualEmit") { (view: ExpoPoseDetectionView, enabled: Bool) in
        view.configureVisionDualEmit(enabled)
      }
    }
  }
}
