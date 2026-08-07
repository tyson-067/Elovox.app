import SwiftUI
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit
#endif

// The app's palette, as the widget sees it. The widget is SwiftUI, not the
// webview, so it cannot read a CSS token — these are the modern pass's three
// values copied deliberately and named the same, so a change on one side is
// findable from the other.
private enum Ink {
    static let stage = Color(red: 0.090, green: 0.075, blue: 0.149) // #171326
    static let ember = Color(red: 1.000, green: 0.353, blue: 0.122) // #ff5a1f
    static let mint = Color(red: 0.055, green: 0.486, blue: 0.420)  // #0e7c6b
    static let onStage2 = Color.white.opacity(0.62)
    static let onStage3 = Color.white.opacity(0.45)
}

/* --- Home Screen: today, at a glance -------------------------------------
   One job: tell you whether you have spoken today, and what about. The streak
   is the number people actually protect, so it leads; the topic is the reason
   to tap. Small family only — a medium widget would be the same two facts in
   more space. */

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: ElovoxShared.Snapshot
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(TodayEntry(date: Date(), snapshot: .load()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        // One entry, and a refresh at the next local midnight — which is
        // exactly when the topic changes and the streak becomes stale. The app
        // reloads the timeline itself the moment anything changes (see
        // ElovoxNativePlugin), so this is only the backstop for a phone whose
        // owner hasn't opened Elovox all day.
        let now = Date()
        let midnight = Calendar.current.nextDate(
            after: now,
            matching: DateComponents(hour: 0, minute: 0),
            matchingPolicy: .nextTime
        ) ?? now.addingTimeInterval(3600)

        completion(Timeline(
            entries: [TodayEntry(date: now, snapshot: .load())],
            policy: .after(midnight)
        ))
    }
}

struct TodayWidgetView: View {
    var entry: TodayEntry

    private var done: Bool { entry.snapshot.bestToday != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 5) {
                Image(systemName: done ? "checkmark.circle.fill" : "flame.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(done ? Ink.mint : Ink.ember)
                Text(done ? "Done today" : "\(entry.snapshot.streak) day streak")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Ink.onStage2)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)

            Text(entry.snapshot.topic)
                .font(.system(size: 16, weight: .heavy))
                .foregroundStyle(.white)
                .lineLimit(3)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 8)

            Text(done
                 ? "Best today · \(entry.snapshot.bestToday ?? 0)"
                 : "\(entry.snapshot.attemptsLeft) takes left")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Ink.onStage3)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(ElovoxShared.Link.daily)
    }
}

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ElovoxToday", provider: TodayProvider()) { entry in
            if #available(iOS 17.0, *) {
                TodayWidgetView(entry: entry)
                    .containerBackground(for: .widget) { Ink.stage }
            } else {
                // Pre-17 widgets paint their own background and get padding
                // from the system; `containerBackground` does not exist there.
                ZStack {
                    Ink.stage
                    TodayWidgetView(entry: entry).padding(16)
                }
            }
        }
        .configurationDisplayName("Today")
        .description("Today's topic, your streak, and how many takes are left.")
        .supportedFamilies([.systemSmall])
    }
}

/* --- Dynamic Island: the take, while it runs ------------------------------
   A sixty-second timer is the one thing in this app that genuinely belongs in
   the Island: it is time-critical, it is short, and the phone is very likely
   face-down or in a hand while it runs. Nothing here is interactive — tapping
   returns to the booth, which is the only action a recording screen has. */

#if canImport(ActivityKit)
@available(iOS 16.2, *)
struct RecordingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: RecordingAttributes.self) { context in
            // Lock Screen / banner presentation.
            HStack(spacing: 14) {
                Image(systemName: "waveform")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Ink.ember)
                VStack(alignment: .leading, spacing: 3) {
                    Text(context.attributes.topic)
                        .font(.system(size: 14, weight: .heavy))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    Text("Attempt \(context.state.attempt) of \(context.state.totalAttempts)")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Ink.onStage3)
                }
                Spacer(minLength: 6)
                Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                    .font(.system(size: 26, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    .frame(width: 78, alignment: .trailing)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .activityBackgroundTint(Ink.stage)
            .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "waveform")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundStyle(Ink.ember)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .frame(width: 62, alignment: .trailing)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.topic)
                            .font(.system(size: 14, weight: .heavy))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                        Text("Attempt \(context.state.attempt) of \(context.state.totalAttempts)")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(Ink.onStage3)
                    }
                    // The Island's bottom corners are rounded and they clip:
                    // without this the "A" of "Attempt" is cut in half by the
                    // curve. Verified on device, not guessed.
                    .padding(.horizontal, 6)
                    .padding(.bottom, 2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } compactLeading: {
                Image(systemName: "waveform")
                    .foregroundStyle(Ink.ember)
            } compactTrailing: {
                Text(timerInterval: Date()...context.state.endsAt, countsDown: true)
                    .monospacedDigit()
                    .foregroundStyle(.white)
                    // The compact slot is narrow and the system will not
                    // truncate a timer gracefully; 44pt fits "0:59".
                    .frame(width: 44)
            } minimal: {
                Image(systemName: "waveform")
                    .foregroundStyle(Ink.ember)
            }
            .widgetURL(ElovoxShared.Link.daily)
            .keylineTint(Ink.ember)
        }
    }
}
#endif

@main
struct ElovoxWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TodayWidget()
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            RecordingLiveActivity()
        }
        #endif
    }
}
