import AppIntents
import Capacitor
import UIKit

/// Siri and Spotlight, for the one thing this app is for.
///
/// "Hey Siri, start my Daily Minute" opens Elovox on the recording screen with
/// the day's topic already loaded. That is the whole app in one sentence, and
/// it is the only intent worth shipping: an app that does one thing a day
/// should expose exactly that, not a menu.
///
/// WHY IT ROUTES THROUGH A URL. The screens live in a webview, so an intent
/// cannot push a view controller — there aren't any. Capacitor already turns
/// an incoming `elovox://` URL into an `appUrlOpen` event that
/// components/NativeRuntime.tsx routes with the Next router, so the intent
/// posts the URL through the same door rather than inventing a second one.
/// `ApplicationDelegateProxy` is Capacitor's own entry point for this; using
/// it means a deep link from Siri, from a widget, and from a tapped link are
/// literally the same code path on both sides of the bridge.
///
/// Availability: AppIntents is iOS 16, the app deploys to 15. Everything here
/// is behind `@available`, so on iOS 15 the app simply has no shortcut —
/// nothing to feature-detect at runtime, nothing that can crash.
@available(iOS 16.0, *)
struct StartDailyMinuteIntent: AppIntent {
    static var title: LocalizedStringResource = "Start my Daily Minute"

    static var description = IntentDescription(
        "Opens Elovox on today's sixty-second speaking topic, ready to record."
    )

    /// The app must come to the front: the point of this shortcut is the
    /// recording screen, and recording needs the microphone and a person
    /// looking at a timer.
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        ElovoxDeepLink.open("elovox:///practice?daily=1")
        return .result()
    }
}

/// Offered to Siri and Spotlight without the user building anything in the
/// Shortcuts app. The phrases must each contain the app name — Siri rejects
/// the whole provider at build time otherwise, and `applicationName` is the
/// token that expands to whatever the app is called on the device.
@available(iOS 16.0, *)
struct ElovoxShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartDailyMinuteIntent(),
            phrases: [
                "Start my Daily Minute in \(.applicationName)",
                "Start my daily minute with \(.applicationName)",
                "Practice with \(.applicationName)",
                "Record a rep in \(.applicationName)"
            ],
            shortTitle: "Daily Minute",
            systemImageName: "mic.fill"
        )
    }
}

/// One place that knows how to hand a URL to the webview.
///
/// Shared by the intent above and by the widget's tap targets, so there is a
/// single answer to "how does native tell the web app to go somewhere".
enum ElovoxDeepLink {
    static func open(_ string: String) {
        guard let url = URL(string: string) else { return }
        // The proxy posts `.capacitorOpenURL`, which @capacitor/app turns into
        // the `appUrlOpen` JS event. Deliberately NOT UIApplication.open(),
        // which would bounce out to the system and back in and race the launch
        // this intent has already started.
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared,
            open: url,
            options: [:]
        )
    }
}
