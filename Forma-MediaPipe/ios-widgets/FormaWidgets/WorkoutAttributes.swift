import ActivityKit
import Foundation

public struct WorkoutAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var isPaused: Bool
        var pausedElapsed: Int // seconds elapsed at time of pause
    }

    var workoutStartDate: Date
}
