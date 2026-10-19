import SwiftUI
import WebKit

/// The game itself: a WKWebView pointed at the local server, with any stray alert/confirm/prompt
/// shown as a native alert (the game draws its own OS 9 ones), outside links opened in Safari, and a small message channel the game
/// uses to ask for the screen to stay awake (at the slow, day-and-night speeds).
struct GameWebView: UIViewRepresentable {
    let url: URL
    let bridge: GameBridge

    func makeCoordinator() -> Coordinator { Coordinator(home: url, bridge: bridge) }

    func makeUIView(context: Context) -> WKWebView {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default() // saves (IndexedDB) and settings (localStorage) persist
        let ucc = cfg.userContentController
        ucc.add(context.coordinator, name: "townies")
        ucc.addUserScript(WKUserScript(
            source: "document.documentElement.classList.add('ios-app'); window.TOWNIES_APP = 'ios';",
            injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.isOpaque = false
        wv.backgroundColor = .black
        wv.scrollView.backgroundColor = .black
        wv.scrollView.isScrollEnabled = false
        wv.scrollView.bounces = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never // the page handles safe areas itself
        wv.allowsBackForwardNavigationGestures = false
        wv.navigationDelegate = context.coordinator
        wv.uiDelegate = context.coordinator
        #if DEBUG
        if #available(iOS 16.4, *) { wv.isInspectable = true } // Safari › Develop on a Mac
        #endif
        context.coordinator.webView = wv
        bridge.webView = wv
        wv.load(URLRequest(url: url))
        return wv
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        let home: URL
        let bridge: GameBridge
        weak var webView: WKWebView?
        init(home: URL, bridge: GameBridge) { self.home = home; self.bridge = bridge }

        // the game's own pages load here; anything else (credits, sources) opens in Safari
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let u = action.request.url else { return decisionHandler(.cancel) }
            if u.host == home.host && u.port == home.port { return decisionHandler(.allow) }
            if action.targetFrame?.isMainFrame ?? true, ["http", "https", "mailto"].contains(u.scheme ?? "") {
                UIApplication.shared.open(u)
                return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // target="_blank" links
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let u = action.request.url { UIApplication.shared.open(u) }
            return nil
        }

        // if the web content process is killed in the background, reload rather than show a blank page
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            webView.load(URLRequest(url: home))
        }

        func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
            if let json = message.body as? String { bridge.receive(json); return } // js/native.js
            guard let body = message.body as? [String: Any] else { return }
            if let awake = body["keepAwake"] as? Bool {
                UIApplication.shared.isIdleTimerDisabled = awake
            }
        }

        // window.alert / confirm / prompt as native alerts
        private func present(_ ac: UIAlertController) {
            guard let root = webView?.window?.rootViewController else { return }
            var top = root
            while let p = top.presentedViewController { top = p }
            top.present(ac, animated: true)
        }
        func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let ac = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            ac.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
            present(ac)
        }
        func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                     initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let ac = UIAlertController(title: nil, message: message, preferredStyle: .alert)
            ac.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            ac.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
            present(ac)
        }
        func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                     defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                     completionHandler: @escaping (String?) -> Void) {
            let ac = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
            ac.addTextField { $0.text = defaultText }
            ac.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            ac.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(ac.textFields?.first?.text) })
            present(ac)
        }
    }
}
