import Capacitor

/// The bridge, with one extra plugin bolted on.
///
/// Capacitor 8 registers plugins from `packageClassList` in the generated
/// capacitor.config.json, and `cap sync` builds that list from the npm
/// packages in node_modules. A plugin that lives in the APP target — which
/// ElovoxNativePlugin does, because it drives this app's own widget and Live
/// Activity and has no business being a published package — is therefore
/// never in that list and never registers. The symptom is silent: the JS
/// proxy resolves, nothing happens, and the Dynamic Island stays empty.
///
/// `capacitorDidLoad()` is the hook Capacitor provides for exactly this. The
/// storyboard points at this class instead of CAPBridgeViewController.
class ElovoxViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(ElovoxNativePlugin())
    }
}
