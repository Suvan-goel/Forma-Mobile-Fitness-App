import ExpoModulesCore
import ActivityKit

public class ExpoLiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ExpoLiveActivity")

        Function("startWorkoutActivity") { (elapsedSeconds: Int) -> Bool in
            guard #available(iOS 16.2, *) else { return false }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return false }

            // End any existing workout activities first
            for activity in Activity<WorkoutAttributes>.activities {
                Task {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }

            let startDate = Date().addingTimeInterval(-Double(elapsedSeconds))
            let attributes = WorkoutAttributes(workoutStartDate: startDate)
            let state = WorkoutAttributes.ContentState(isPaused: false, pausedElapsed: 0)

            do {
                let content = ActivityContent(state: state, staleDate: nil)
                _ = try Activity.request(
                    attributes: attributes,
                    content: content,
                    pushType: nil
                )
                return true
            } catch {
                return false
            }
        }

        Function("updateWorkoutActivity") { (isPaused: Bool, elapsedSeconds: Int) -> Void in
            guard #available(iOS 16.2, *) else { return }

            let state = WorkoutAttributes.ContentState(
                isPaused: isPaused,
                pausedElapsed: elapsedSeconds
            )

            Task {
                for activity in Activity<WorkoutAttributes>.activities {
                    if isPaused {
                        // When pausing, just update the state to show frozen time
                        await activity.update(ActivityContent(state: state, staleDate: nil))
                    } else {
                        // When resuming, we need to restart with a new start date
                        // so the .timer text counts from the right point
                        await activity.end(nil, dismissalPolicy: .immediate)
                    }
                }

                if !isPaused {
                    // Restart the activity with adjusted start date
                    let startDate = Date().addingTimeInterval(-Double(elapsedSeconds))
                    let attributes = WorkoutAttributes(workoutStartDate: startDate)
                    let newState = WorkoutAttributes.ContentState(isPaused: false, pausedElapsed: 0)
                    let content = ActivityContent(state: newState, staleDate: nil)
                    do {
                        _ = try Activity.request(
                            attributes: attributes,
                            content: content,
                            pushType: nil
                        )
                    } catch {}
                }
            }
        }

        Function("endWorkoutActivity") { () -> Void in
            guard #available(iOS 16.2, *) else { return }

            Task {
                for activity in Activity<WorkoutAttributes>.activities {
                    await activity.end(nil, dismissalPolicy: .immediate)
                }
            }
        }

        Function("isAvailable") { () -> Bool in
            guard #available(iOS 16.2, *) else { return false }
            return ActivityAuthorizationInfo().areActivitiesEnabled
        }
    }
}
