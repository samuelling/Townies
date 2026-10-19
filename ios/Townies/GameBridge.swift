import SwiftUI
import WebKit
import UIKit

/// The few things the game asks of the app (see js/native.js): haptics and the share sheet.
/// The interface itself is the game's own Mac OS 9-style one, drawn by the page.
final class GameBridge: ObservableObject {
    @Published var shareText: String?
    weak var webView: WKWebView?

    func receive(_ raw: String) {
        guard let data = raw.data(using: .utf8),
              let msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = msg["type"] as? String else { return }
        switch type {
        case "haptic": Haptics.play(msg["kind"] as? String ?? "")
        case "share": shareText = msg["text"] as? String
        case "log": print("[Townies] \(msg["msg"] as? String ?? "")")
        default: break
        }
    }
}

// MARK: - Haptics: the same moments as the sound effects

enum Haptics {
    static func play(_ kind: String) {
        switch kind {
        case "bulldoze": UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "drill", "build", "road", "civic": UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        case "zoneR", "zoneC", "zoneI", "dezone", "zone", "park": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "gavel": UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        case "ribbon": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "alert", "siren": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "click": UISelectionFeedbackGenerator().selectionChanged()
        default: break
        }
    }
}
