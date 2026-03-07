import ActivityKit
import Foundation

public struct WorkoutAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var isPaused: Bool
        var pausedElapsed: Int
    }

    var workoutStartDate: Date
}
