// Townies for iPhone and iPad: the web game, bundled and run offline in a full-screen web view.
// The game's files (index.html, js/, css/, data/, fonts/) are copied into the app at build time
// (see the "Bundle the game" build phase) and served from a tiny local web server, so ES modules,
// IndexedDB saves, Web Audio and fetch() all behave exactly as they do on the web.
import SwiftUI
import AVFoundation

@main
struct TowniesApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var server = LocalServer.shared

    init() {
        // Play along with whatever else is playing, and respect the silent switch, like most games.
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default)
        try? AVAudioSession.sharedInstance().setActive(true)
        LocalServer.shared.start()
    }

    // `-TowniesQuery "auto=live"` as a launch argument (or in Xcode's scheme) jumps past the title
    // screen, the same as ?auto=live on the web; used for simulator screenshots in CI
    private var startURL: URL {
        var c = URLComponents(url: server.baseURL.appendingPathComponent("index.html"), resolvingAgainstBaseURL: false)!
        if let q = UserDefaults.standard.string(forKey: "TowniesQuery"), !q.isEmpty { c.percentEncodedQuery = q }
        return c.url!
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                if server.ready {
                    GameScreen(url: startURL)
                } else if let err = server.error {
                    Text("Townies couldn't start its local server.\n\(err)")
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding()
                } else {
                    ProgressView().tint(.white)
                }
            }
            .statusBarHidden(true)
            .persistentSystemOverlays(.hidden)
        }
        .onChange(of: scenePhase) { _, phase in
            // iOS can tear down the listening socket while the app is suspended; bring it back.
            if phase == .active { LocalServer.shared.start() }
        }
    }
}
