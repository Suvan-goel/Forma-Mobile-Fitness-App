import UIKit
import MediaPipeTasksVision

struct SkeletonLine {
  let from: CGPoint
  let to: CGPoint
}

struct PoseOverlay {
  let lines: [SkeletonLine]
}

struct Connection {
  let start: Int
  let end: Int
}

class OverlayView: UIView {
  private var currentOverlays: [PoseOverlay] = []
  private var contentImageSize: CGSize = .zero
  private var imageContentMode: UIView.ContentMode = .scaleAspectFill

  // Drawing constants (matching @thinksys)
  private static let lineWidth: CGFloat = 4.0
  private static let lineColor = UIColor.white

  // All connections for full skeleton
  private static let allConnections: [Connection] = {
    var c: [Connection] = []
    // Face (0-10)
    c.append(contentsOf: [
      Connection(start: 0, end: 1),
      Connection(start: 1, end: 2),
      Connection(start: 2, end: 3),
      Connection(start: 3, end: 7),
      Connection(start: 0, end: 4),
      Connection(start: 4, end: 5),
      Connection(start: 5, end: 6),
      Connection(start: 6, end: 8),
      Connection(start: 9, end: 10)
    ])
    // Left arm
    c.append(contentsOf: [
      Connection(start: 11, end: 13),
      Connection(start: 13, end: 15)
    ])
    // Right arm
    c.append(contentsOf: [
      Connection(start: 12, end: 14),
      Connection(start: 14, end: 16)
    ])
    // Left wrist
    c.append(contentsOf: [
      Connection(start: 15, end: 17),
      Connection(start: 15, end: 19),
      Connection(start: 15, end: 21)
    ])
    // Right wrist
    c.append(contentsOf: [
      Connection(start: 16, end: 18),
      Connection(start: 16, end: 20),
      Connection(start: 16, end: 22)
    ])
    // Torso
    c.append(contentsOf: [
      Connection(start: 11, end: 12),
      Connection(start: 11, end: 23),
      Connection(start: 12, end: 24),
      Connection(start: 23, end: 24)
    ])
    // Left leg
    c.append(contentsOf: [
      Connection(start: 23, end: 25),
      Connection(start: 25, end: 27)
    ])
    // Right leg
    c.append(contentsOf: [
      Connection(start: 24, end: 26),
      Connection(start: 26, end: 28)
    ])
    // Left ankle
    c.append(contentsOf: [
      Connection(start: 27, end: 29),
      Connection(start: 27, end: 31)
    ])
    // Right ankle
    c.append(contentsOf: [
      Connection(start: 28, end: 30),
      Connection(start: 28, end: 32)
    ])
    return c
  }()

  // MARK: - Public

  func draw(
    poseOverlays: [PoseOverlay],
    inBoundsOfContentImageOfSize imageSize: CGSize,
    imageContentMode: UIView.ContentMode
  ) {
    clear()
    self.currentOverlays = poseOverlays
    self.contentImageSize = imageSize
    self.imageContentMode = imageContentMode
    setNeedsDisplay()
  }

  func clear() {
    currentOverlays = []
    contentImageSize = .zero
    setNeedsDisplay()
  }

  override func draw(_ rect: CGRect) {
    for overlay in currentOverlays {
      drawLines(overlay.lines)
    }
  }

  // MARK: - Drawing

  private func drawLines(_ lines: [SkeletonLine]) {
    let path = UIBezierPath()
    for line in lines {
      path.move(to: line.from)
      path.addLine(to: line.to)
    }
    path.lineWidth = OverlayView.lineWidth
    OverlayView.lineColor.setStroke()
    path.stroke()
  }

  // MARK: - Coordinate transform

  func poseOverlays(
    fromLandmarks landmarkSets: [[NormalizedLandmark]],
    inferredOnImageOfSize imageSize: CGSize,
    overlayViewSize: CGSize,
    imageContentMode: UIView.ContentMode
  ) -> [PoseOverlay] {
    guard !landmarkSets.isEmpty else { return [] }

    let scale = OverlayView.scaleAndOffset(
      forImageOfSize: imageSize,
      inViewOfSize: overlayViewSize,
      contentMode: imageContentMode
    )

    var overlays: [PoseOverlay] = []

    for landmarks in landmarkSets {
      // Transform normalized coordinates to view coordinates
      let points: [CGPoint] = landmarks.map { lm in
        let x = CGFloat(lm.x) * imageSize.width * scale.scaleFactor + scale.xOffset
        let y = CGFloat(lm.y) * imageSize.height * scale.scaleFactor + scale.yOffset
        return CGPoint(x: x, y: y)
      }

      // Build lines from connections
      let lines: [SkeletonLine] = OverlayView.allConnections.compactMap { conn in
        guard conn.start < points.count, conn.end < points.count else { return nil }
        return SkeletonLine(from: points[conn.start], to: points[conn.end])
      }

      overlays.append(PoseOverlay(lines: lines))
    }

    return overlays
  }

  // MARK: - Scale helpers

  private static func scaleAndOffset(
    forImageOfSize imageSize: CGSize,
    inViewOfSize viewSize: CGSize,
    contentMode: UIView.ContentMode
  ) -> (xOffset: CGFloat, yOffset: CGFloat, scaleFactor: CGFloat) {
    let widthScale = viewSize.width / imageSize.width
    let heightScale = viewSize.height / imageSize.height

    let scaleFactor: CGFloat
    switch contentMode {
    case .scaleAspectFill:
      scaleFactor = max(widthScale, heightScale)
    case .scaleAspectFit:
      scaleFactor = min(widthScale, heightScale)
    default:
      scaleFactor = 1.0
    }

    let scaledSize = CGSize(
      width: imageSize.width * scaleFactor,
      height: imageSize.height * scaleFactor
    )
    let xOffset = (viewSize.width - scaledSize.width) / 2
    let yOffset = (viewSize.height - scaledSize.height) / 2

    return (xOffset, yOffset, scaleFactor)
  }
}
