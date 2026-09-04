import UIKit
import AVFoundation
import Capacitor

/// The app's audio session, so that Felix is heard.
///
/// Under the default category (`soloAmbient`) everything the webview plays
/// through the Web Audio API obeys the ringer switch, and a phone on silent
/// is a Felix with his mouth moving and no sound coming out. `.playback` is
/// the category for content the user asked to hear; it plays through the
/// switch. `.duckOthers` turns the user's music down under him rather than
/// stopping it, and brings it back when he is done.
///
/// `.playAndRecord` is left alone: it is what WebKit sets while the booth
/// records, it also plays through the switch, and replacing it mid-take
/// would cut the microphone.
enum ElovoxAudio {
    @discardableResult
    static func preparePlayback() -> (category: String, changed: Bool) {
        let session = AVAudioSession.sharedInstance()
        let before = session.category
        if before == .playback || before == .playAndRecord {
            return (before.rawValue, false)
        }
        do {
            try session.setCategory(.playback, mode: .default, options: [.duckOthers])
        } catch {
            NSLog("[elovox] audio session category not set: %@", error.localizedDescription)
        }
        let after = session.category
        NSLog("[elovox] audio session %@ -> %@", before.rawValue, after.rawValue)
        return (after.rawValue, after != before)
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        ElovoxAudio.preparePlayback()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
        // A phone call or another app's audio can leave the session in a
        // category of the system's choosing; re-choose ours on the way back.
        ElovoxAudio.preparePlayback()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
