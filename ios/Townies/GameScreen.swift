import SwiftUI
import UIKit

/// The whole app screen: the game, edge to edge. Its menus, windows and tool palette are the game's
/// own Mac OS 9-style ones (the page keeps clear of the notch and home indicator itself).
struct GameScreen: View {
    let url: URL
    @StateObject private var bridge = GameBridge()

    var body: some View {
        GameWebView(url: url, bridge: bridge)
            .ignoresSafeArea()
            .background(Color.black.ignoresSafeArea())
            .sheet(isPresented: Binding(get: { bridge.shareText != nil }, set: { if !$0 { bridge.shareText = nil } })) {
                ShareSheet(items: [bridge.shareText ?? ""]).presentationDetents([.medium, .large])
            }
    }
}

/// The report card's "Copy summary" opens this in the app.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
