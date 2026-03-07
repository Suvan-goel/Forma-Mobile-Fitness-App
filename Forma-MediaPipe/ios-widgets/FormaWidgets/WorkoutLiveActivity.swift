import ActivityKit
import SwiftUI
import WidgetKit

@available(iOS 16.2, *)
struct WorkoutLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutAttributes.self) { context in
            // Lock Screen banner
            HStack {
                Image("forma_logo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 36, height: 36)

                Spacer()

                Image(systemName: "figure.strengthtraining.traditional")
                    .foregroundColor(.purple)
                    .font(.system(size: 16))

                timerView(context: context)
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .foregroundColor(.white)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .activityBackgroundTint(.black)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded: leading
                DynamicIslandExpandedRegion(.leading) {
                    Image("forma_logo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 32, height: 32)
                        .padding(.leading, 4)
                }
                // Expanded: trailing
                DynamicIslandExpandedRegion(.trailing) {
                    timerView(context: context)
                        .font(.system(size: 22, weight: .bold, design: .monospaced))
                        .foregroundColor(.white)
                        .padding(.trailing, 4)
                }
                // Expanded: center
                DynamicIslandExpandedRegion(.center) {
                    Text("Workout")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.purple)
                }
                // Expanded: bottom
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Image(systemName: "figure.strengthtraining.traditional")
                            .foregroundColor(.purple)
                        Text(context.state.isPaused ? "Paused" : "In Progress")
                            .font(.system(size: 13))
                            .foregroundColor(.gray)
                    }
                }
            } compactLeading: {
                Image("forma_logo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 20, height: 20)
            } compactTrailing: {
                timerView(context: context)
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundColor(.purple)
            } minimal: {
                Image("forma_logo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 16, height: 16)
            }
        }
    }

    @ViewBuilder
    private func timerView(context: ActivityViewContext<WorkoutAttributes>) -> some View {
        if context.state.isPaused {
            // Show frozen time when paused
            Text(formatSeconds(context.state.pausedElapsed))
        } else {
            // Live counting timer — iOS handles this natively, no JS updates needed
            Text(context.attributes.workoutStartDate, style: .timer)
        }
    }

    private func formatSeconds(_ total: Int) -> String {
        let h = total / 3600
        let m = (total % 3600) / 60
        let s = total % 60
        if h > 0 {
            return String(format: "%d:%02d:%02d", h, m, s)
        }
        return String(format: "%02d:%02d", m, s)
    }
}
