import Capacitor
import Foundation
import WidgetKit

#if canImport(ActivityKit)
import ActivityKit
#endif

/// The one bridge between the webview and the things only native can do.
///
/// The app's screens are HTML, so everything WidgetKit and ActivityKit need
/// has to be handed across. Four methods, all of them fire-and-forget from
/// JavaScript's point of view: none of this is load-bearing for the app
/// working, and every one of them resolves rather than rejecting when the
/// platform says no. A user on iOS 15, or on a phone with no Dynamic Island,
/// or with the App Group unregistered, gets an app that behaves exactly as it
/// did before any of this existed.
@objc(ElovoxNativePlugin)
public class ElovoxNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ElovoxNativePlugin"
    public let jsName = "ElovoxNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setWidgetData", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startTake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endTake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "capabilities", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "prepareAudioSession", returnType: CAPPluginReturnPromise)
    ]

    /// What the caller is allowed to expect from this device. The web side
    /// checks this once and skips the rest when it comes back false, so an
    /// unsupported phone never makes a bridge call that would only no-op.
    @objc func capabilities(_ call: CAPPluginCall) {
        var liveActivities = false
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            liveActivities = ActivityAuthorizationInfo().areActivitiesEnabled
        }
        #endif
        call.resolve([
            "widgets": true,
            "liveActivities": liveActivities,
            // Whether the App Group is actually reachable. False here is the
            // signature of a group that was never registered on the bundle ID,
            // and it is the difference between "the widget is blank" and "the
            // widget is broken" when someone reports it.
            "sharedStorage": ElovoxShared.defaults != nil
        ])
    }

    /// Put the audio session where Felix can be heard. The web side calls
    /// this in the tap that starts him talking, because WebKit re-chooses
    /// the category as media starts and stops and the app's own choice at
    /// launch (AppDelegate) does not survive a recording. See ElovoxAudio.
    @objc func prepareAudioSession(_ call: CAPPluginCall) {
        let result = ElovoxAudio.preparePlayback()
        call.resolve(["category": result.category, "changed": result.changed])
    }

    /// Push what the Home Screen widget draws into the shared container.
    ///
    /// Called on every meaningful change rather than on a timer: the widget's
    /// own timeline only refreshes at midnight, because WidgetKit's budget is
    /// finite and the app knows precisely when the numbers moved.
    @objc func setWidgetData(_ call: CAPPluginCall) {
        guard let d = ElovoxShared.defaults else {
            // No App Group. Nothing to write to, and nothing the user can do
            // about it — resolve quietly rather than surfacing an error into a
            // UI that has no way to explain it.
            call.resolve(["written": false])
            return
        }
        d.set(call.getInt("streak") ?? 0, forKey: ElovoxShared.Key.streak)
        d.set(call.getString("topic") ?? "", forKey: ElovoxShared.Key.topic)
        d.set(call.getInt("attemptsLeft") ?? 3, forKey: ElovoxShared.Key.attemptsLeft)
        // -1 means "nothing recorded today". A missing key reads back as 0
        // from integerForKey, and 0 is a score.
        d.set(call.getInt("bestToday") ?? -1, forKey: ElovoxShared.Key.bestToday)
        d.set(Date().timeIntervalSince1970, forKey: ElovoxShared.Key.updatedAt)

        WidgetCenter.shared.reloadTimelines(ofKind: "ElovoxToday")
        call.resolve(["written": true])
    }

    /// Put the running take in the Dynamic Island.
    @objc func startTake(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["started": false]); return
            }
            // One at a time. A take that ended badly (app killed mid-record)
            // can leave an activity behind, and two countdowns in the Island
            // is worse than none.
            Task { await Self.endAll() }

            let seconds = call.getDouble("seconds") ?? 60
            let attributes = RecordingAttributes(
                topic: call.getString("topic") ?? "Your take"
            )
            let state = RecordingAttributes.ContentState(
                endsAt: Date().addingTimeInterval(seconds),
                attempt: call.getInt("attempt") ?? 1,
                totalAttempts: call.getInt("totalAttempts") ?? 3
            )
            do {
                _ = try Activity.request(
                    attributes: attributes,
                    content: .init(state: state, staleDate: Date().addingTimeInterval(seconds + 30)),
                    pushType: nil
                )
                call.resolve(["started": true])
            } catch {
                // Throttled by the system, or the user disabled Live
                // Activities for this app. Neither is worth an error path in
                // the recorder.
                call.resolve(["started": false])
            }
            return
        }
        #endif
        call.resolve(["started": false])
    }

    /// Take the activity down. Called on finish, on discard, and on unmount —
    /// the recorder has three ways out and all of them end here.
    @objc func endTake(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                await Self.endAll()
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    #if canImport(ActivityKit)
    @available(iOS 16.2, *)
    private static func endAll() async {
        for activity in Activity<RecordingAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
    #endif
}
