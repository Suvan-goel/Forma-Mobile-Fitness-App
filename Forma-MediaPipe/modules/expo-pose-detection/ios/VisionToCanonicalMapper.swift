import Foundation
import Vision
import simd

@available(iOS 17.0, *)
enum VisionToCanonicalMapper {
  private struct CanonicalJointSpec {
    let canonicalName: String
    let visionName: VNHumanBodyPose3DObservation.JointName?
    let isSynthetic: Bool
  }

  private static let directJointSpecs: [CanonicalJointSpec] = [
    CanonicalJointSpec(canonicalName: "head", visionName: .centerHead, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "neck", visionName: .centerShoulder, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "chest_center", visionName: .spine, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "pelvis_center", visionName: .root, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "left_shoulder", visionName: .leftShoulder, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "right_shoulder", visionName: .rightShoulder, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "left_elbow", visionName: .leftElbow, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "right_elbow", visionName: .rightElbow, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "left_wrist", visionName: .leftWrist, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "right_wrist", visionName: .rightWrist, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "left_hip", visionName: .leftHip, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "right_hip", visionName: .rightHip, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "left_knee", visionName: .leftKnee, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "right_knee", visionName: .rightKnee, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "left_ankle", visionName: .leftAnkle, isSynthetic: false),
    CanonicalJointSpec(canonicalName: "right_ankle", visionName: .rightAnkle, isSynthetic: false)
  ]

  static func map(
    observation: VNHumanBodyPose3DObservation,
    timestampMs: Int,
    sourceQuality: String,
    viewHint: String = "unknown"
  ) -> [String: Any]? {
    var joints: [String: [String: Any]] = [:]
    var joints2D: [String: [String: Any]] = [:]
    var confidenceSum: Float = 0
    var confidenceCount: Float = 0

    for spec in directJointSpecs {
      guard let visionName = spec.visionName else { continue }
      let point3D = recognizedPoint(observation, visionName)
      let point2D = imagePoint(observation, visionName)

      joints[spec.canonicalName] = joint3DPayload(point3D, isSynthetic: spec.isSynthetic)
      joints2D[spec.canonicalName] = joint2DPayload(point2D, confidence: point3D == nil ? 0 : 1)

      if point3D != nil {
        confidenceSum += 1
        confidenceCount += 1
      }
    }

    synthesizeFoot(
      name: "left_foot",
      ankleName: "left_ankle",
      kneeName: "left_knee",
      joints: &joints,
      joints2D: &joints2D
    )
    synthesizeFoot(
      name: "right_foot",
      ankleName: "right_ankle",
      kneeName: "right_knee",
      joints: &joints,
      joints2D: &joints2D
    )

    guard !joints.isEmpty else { return nil }

    return [
      "joints": joints,
      "joints2D": joints2D,
      "profile": NSNull(),
      "source": "vision3d",
      "sourceQuality": sourceQuality,
      "timestamp": timestampMs,
      "viewHint": viewHint,
      "globalConfidence": confidenceCount > 0 ? confidenceSum / confidenceCount : 0
    ]
  }

  private static func recognizedPoint(
    _ observation: VNHumanBodyPose3DObservation,
    _ jointName: VNHumanBodyPose3DObservation.JointName
  ) -> VNHumanBodyRecognizedPoint3D? {
    guard observation.availableJointNames.contains(jointName) else { return nil }
    return try? observation.recognizedPoint(jointName)
  }

  private static func imagePoint(
    _ observation: VNHumanBodyPose3DObservation,
    _ jointName: VNHumanBodyPose3DObservation.JointName
  ) -> VNPoint? {
    guard observation.availableJointNames.contains(jointName) else { return nil }
    return try? observation.pointInImage(jointName)
  }

  private static func joint3DPayload(
    _ point: VNHumanBodyRecognizedPoint3D?,
    isSynthetic: Bool
  ) -> [String: Any] {
    guard let point = point else {
      return [
        "x": 0,
        "y": 0,
        "z": 0,
        "confidence": 0,
        "isSynthetic": isSynthetic
      ]
    }

    let position = point.localPosition.columns.3
    return [
      "x": position.x,
      "y": position.y,
      "z": position.z,
      "confidence": 1,
      "isSynthetic": isSynthetic
    ]
  }

  private static func joint2DPayload(
    _ point: VNPoint?,
    confidence: Float
  ) -> [String: Any] {
    guard let point = point else {
      return [
        "x": 0,
        "y": 0,
        "confidence": 0
      ]
    }

    return [
      "x": point.x,
      "y": point.y,
      "confidence": confidence
    ]
  }

  private static func synthesizeFoot(
    name: String,
    ankleName: String,
    kneeName: String,
    joints: inout [String: [String: Any]],
    joints2D: inout [String: [String: Any]]
  ) {
    guard
      let ankle = joints[ankleName],
      let knee = joints[kneeName],
      let ankleX = ankle["x"] as? Float,
      let ankleY = ankle["y"] as? Float,
      let ankleZ = ankle["z"] as? Float,
      let kneeX = knee["x"] as? Float,
      let kneeY = knee["y"] as? Float,
      let kneeZ = knee["z"] as? Float
    else {
      joints[name] = ["x": 0, "y": 0, "z": 0, "confidence": 0, "isSynthetic": true]
      joints2D[name] = ["x": 0, "y": 0, "confidence": 0]
      return
    }

    let dx = ankleX - kneeX
    let dy = ankleY - kneeY
    let dz = ankleZ - kneeZ
    let tibiaLength = sqrt(dx * dx + dy * dy + dz * dz)
    let confidence = min((ankle["confidence"] as? Float) ?? 0, (knee["confidence"] as? Float) ?? 0)

    joints[name] = [
      "x": ankleX,
      "y": ankleY,
      "z": ankleZ + 0.5 * tibiaLength,
      "confidence": confidence,
      "isSynthetic": true
    ]

    if let ankle2D = joints2D[ankleName] {
      joints2D[name] = [
        "x": ankle2D["x"] ?? 0,
        "y": ankle2D["y"] ?? 0,
        "confidence": confidence
      ]
    } else {
      joints2D[name] = ["x": 0, "y": 0, "confidence": 0]
    }
  }
}
