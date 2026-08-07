import Foundation

#if canImport(ActivityKit)
import ActivityKit
#endif

/// The contract between the app and its widget extension.
///
/// Compiled into BOTH targets. They are separate processes that share nothing
/// but an App Group container and these type definitions, so every key and
/// every field lives here exactly once — a widget reading "streak" while the
/// app writes "streakDays" fails silently and forever, and that is precisely
/// the bug this file exists to make impossible.
enum ElovoxShared {

    /// The App Group both targets are entitled to.
    ///
    /// MUST be registered in the Apple Developer account and enabled on both
    /// bundle IDs, or `UserDefaults(suiteName:)` returns nil at runtime. Every
    /// read below treats that nil as "no data yet" rather than crashing, so an
    /// unregistered group costs a blank widget, never a broken app.
    static let appGroup = "group.app.elovox.ios"

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroup)
    }

    enum Key {
        static let streak = "elovox.widget.streak"
        static let topic = "elovox.widget.topic"
        static let theme = "elovox.widget.theme"
        static let attemptsLeft = "elovox.widget.attemptsLeft"
        static let bestToday = "elovox.widget.bestToday"
        static let updatedAt = "elovox.widget.updatedAt"
    }

    /// What the Home Screen widget draws. Decoded defensively: a widget whose
    /// container is empty (first install, or an App Group that was never
    /// registered) shows the placeholder, which is a legitimate state and not
    /// an error.
    struct Snapshot {
        var streak: Int
        var topic: String
        var attemptsLeft: Int
        /// Today's best score, or nil when nothing has been recorded yet.
        var bestToday: Int?

        static let placeholder = Snapshot(
            streak: 0,
            topic: "A new topic every day",
            attemptsLeft: 3,
            bestToday: nil
        )

        static func load() -> Snapshot {
            guard let d = defaults, d.object(forKey: Key.updatedAt) != nil else {
                return .placeholder
            }
            let topic = d.string(forKey: Key.topic) ?? Snapshot.placeholder.topic
            // -1 is the app's way of writing "no score today". A plain
            // integerForKey would read a missing key as 0, which is a score.
            let best = d.integer(forKey: Key.bestToday)
            return Snapshot(
                streak: d.integer(forKey: Key.streak),
                topic: topic.isEmpty ? Snapshot.placeholder.topic : topic,
                attemptsLeft: d.object(forKey: Key.attemptsLeft) == nil
                    ? 3
                    : d.integer(forKey: Key.attemptsLeft),
                bestToday: best < 0 ? nil : best
            )
        }
    }

    /// Deep links the widget's tap targets use. Same scheme the Siri shortcut
    /// posts, so every native entry point lands in the same web router.
    enum Link {
        static let daily = URL(string: "elovox:///practice?daily=1")!
        static let home = URL(string: "elovox:///dashboard")!
    }
}

#if canImport(ActivityKit)
/// The live recording, as the Dynamic Island and the Lock Screen see it.
///
/// Requires iOS 16.2: the `content:`-based Activity.request lands there, and
/// pinning the attributes to the same floor keeps one number in play.
/// `ActivityAttributes` is the shape ActivityKit persists across processes, so
/// it too must be identical in both targets — hence its home in this file
/// rather than beside the views that draw it.
@available(iOS 16.2, *)
struct RecordingAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// Seconds left in the take. The Island renders a countdown from this.
        var endsAt: Date
        /// Which of the day's three attempts this is.
        var attempt: Int
        var totalAttempts: Int
    }

    /// Fixed for the life of the activity: what is being practised.
    var topic: String
}
#endif
