import SwiftUI
import WebKit
import UIKit

// MARK: - What the game sends (see js/native.js)

struct ToolDef: Decodable, Identifiable { let id: String; let label: String; let note: String; let icon: String }
struct GroupDef: Decodable, Identifiable { let id: String; let label: String; let members: [String] }
struct ExtraDef: Decodable, Identifiable { let id: String; let label: String; let icon: String }
struct NamedID: Decodable, Identifiable { let id: String; let label: String }
struct SpeedDef: Decodable { let name: String; let icon: String; let cycles: Bool }

struct Setup: Decodable {
    let tools: [ToolDef]
    let groups: [GroupDef]
    let loose: [String]
    let extras: [ExtraDef]
    let overlays: [NamedID]
    let speeds: [SpeedDef]
    let menus: [String: [String]]
}

struct HUD: Decodable {
    var date = "", clock = "", funds = "", pop = ""
    var fundsNeg = false, approvalNeg = false, incLate = false
    var approval = 0, vib = 0, vibDir = 0
    var inc = "0", ticker = ""
    var rci: [Double] = [0, 0, 0]
    var speed = 4, tool = "query", bd = "auto", overlay = "none"
    var dense = false, avenue = false, names = false, canUndo = false, music = false, sfxOn = true, cycles = false

    init() {}
    private enum K: String, CodingKey {
        case date, clock, funds, pop, fundsNeg, approvalNeg, incLate, approval, vib, vibDir, inc, ticker, rci
        case speed, tool, bd, overlay, dense, avenue, names, canUndo, music, sfxOn, cycles
    }
    // every field optional on the wire, so an older or newer game page never breaks the bar
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: K.self)
        func s(_ k: K, _ v: String) -> String { (try? c.decodeIfPresent(String.self, forKey: k)) ?? v }
        func b(_ k: K) -> Bool { (try? c.decodeIfPresent(Bool.self, forKey: k)) ?? false }
        func i(_ k: K, _ v: Int) -> Int { (try? c.decodeIfPresent(Int.self, forKey: k)) ?? v }
        date = s(.date, ""); clock = s(.clock, ""); funds = s(.funds, ""); pop = s(.pop, "")
        fundsNeg = b(.fundsNeg); approvalNeg = b(.approvalNeg); incLate = b(.incLate)
        approval = i(.approval, 0); vib = i(.vib, 0); vibDir = i(.vibDir, 0)
        inc = s(.inc, "0"); ticker = s(.ticker, "")
        rci = (try? c.decodeIfPresent([Double].self, forKey: .rci)) ?? [0, 0, 0]
        speed = i(.speed, 4); tool = s(.tool, "query"); bd = s(.bd, "auto"); overlay = s(.overlay, "none")
        dense = b(.dense); avenue = b(.avenue); names = b(.names); canUndo = b(.canUndo)
        music = b(.music); sfxOn = b(.sfxOn); cycles = b(.cycles)
    }
}

struct Block: Decodable, Identifiable {
    var id = UUID()
    let t: String
    var text: String? = nil, k: String? = nil, v: String? = nil
    var label: String? = nil, sub: String? = nil, i: Int? = nil
    var date: String? = nil, title: String? = nil
    var comments: [Comment]? = nil
    private enum CodingKeys: String, CodingKey { case t, text, k, v, label, sub, i, date, title, comments }
}
struct Comment: Decodable, Identifiable { var id = UUID(); let who: String; let text: String
    private enum CodingKeys: String, CodingKey { case who, text } }

struct Sheet: Decodable, Identifiable { let id: String; let title: String; let blocks: [Block] }

struct Choice: Decodable, Identifiable { var id = UUID(); let label: String; let sub: String
    private enum CodingKeys: String, CodingKey { case label, sub } }
struct Modal: Decodable, Identifiable {
    var id = UUID()
    let kind: String, title: String, date: String, heading: String
    let paras: [String], lines: [String], fine: String, showWhere: Bool
    let choices: [Choice]
    private enum CodingKeys: String, CodingKey { case kind, title, date, heading, paras, lines, fine, choices, showWhere = "where" }
}
struct ApprovalMove: Decodable, Identifiable { var id = UUID(); let label: String; let d: Int
    private enum CodingKeys: String, CodingKey { case label, d } }
struct SearchHit: Decodable, Identifiable { let i: Int; let label: String; let kind: String; let sub: String; var id: Int { i } }

/// The one sheet showing at a time: an agenda item or event (which the game waits on) wins over a page.
enum ActiveSheet: Identifiable {
    case modal(Modal), page(Sheet), search
    var id: String {
        switch self {
        case .modal(let m): return "modal-\(m.id)"
        case .page(let s): return "page-\(s.id)"
        case .search: return "search"
        }
    }
}

// MARK: - The bridge

/// Holds the game's state for the native interface and sends commands back into the page.
final class GameBridge: ObservableObject {
    @Published var setup: Setup?
    @Published var hud = HUD()
    @Published var sheet: ActiveSheet?
    @Published var toast: String?
    @Published var approval: (moves: [ApprovalMove], why: String)?
    @Published var shareText: String?
    weak var webView: WKWebView?

    private var icons: [String: UIImage] = [:]
    private var toastTask: DispatchWorkItem?
    private var approvalTask: DispatchWorkItem?

    var live: Bool { setup != nil }

    func icon(_ id: String) -> UIImage? { icons[id] }
    func tool(_ id: String) -> ToolDef? { setup?.tools.first { $0.id == id } }

    // a new page load (title screen, restart) starts without native chrome until the game sends its setup
    func reset() { setup = nil; sheet = nil }

    func receive(_ raw: String) {
        guard let data = raw.data(using: .utf8),
              let head = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = head["type"] as? String else { return }
        let dec = JSONDecoder()
        switch type {
        case "setup":
            guard let s = try? dec.decode(Setup.self, from: data) else { return }
            for t in s.tools { icons[t.id] = Self.image(t.icon) }
            for x in s.extras { icons[x.id] = Self.image(x.icon) }
            setup = s
        case "hud":
            if let h = try? dec.decode(HUD.self, from: data) { hud = h }
        case "sheet":
            guard let s = try? dec.decode(Sheet.self, from: data) else { return }
            if case .modal = sheet { return } // never cover a decision
            sheet = .page(s)
        case "modal":
            if let m = try? dec.decode(Modal.self, from: data) { sheet = .modal(m) }
        case "modalClose":
            if case .modal = sheet { sheet = nil }
        case "toast":
            showToast(head["msg"] as? String ?? "")
        case "approval":
            struct A: Decodable { let moves: [ApprovalMove]; let why: String }
            if let a = try? dec.decode(A.self, from: data) { showApproval(a.moves, a.why) }
        case "haptic":
            Haptics.play(head["kind"] as? String ?? "")
        case "share":
            shareText = head["text"] as? String
        default: break
        }
    }

    // MARK: commands into the page

    func send(_ cmd: [String: Any]) {
        guard let wv = webView,
              let data = try? JSONSerialization.data(withJSONObject: cmd),
              let json = String(data: data, encoding: .utf8) else { return }
        wv.evaluateJavaScript("window.townies && window.townies.native && window.townies.native.cmd(\(json))")
    }
    func setTool(_ id: String) { send(["type": "tool", "id": id]) }
    func setSpeed(_ v: Int) { send(["type": "speed", "v": v]) }
    func setOverlay(_ id: String) { send(["type": "overlay", "id": id]) }
    func extra(_ id: String) { send(["type": "extra", "id": id]) }
    func menu(_ menu: String, _ i: Int) { send(["type": "menu", "menu": menu, "i": i]) }
    func open(_ id: String) { send(["type": "open", "id": id]) }

    func search(_ q: String, done: @escaping ([SearchHit]) -> Void) {
        guard let wv = webView, !q.trimmingCharacters(in: .whitespaces).isEmpty else { return done([]) }
        wv.callAsyncJavaScript("return window.townies.native.search(q)", arguments: ["q": q], in: nil, in: .page) { result in
            guard case .success(let v) = result, let arr = v as? [[String: Any]],
                  let data = try? JSONSerialization.data(withJSONObject: arr),
                  let hits = try? JSONDecoder().decode([SearchHit].self, from: data) else { return done([]) }
            done(hits)
        }
    }

    // MARK: transient overlays

    private func showToast(_ msg: String) {
        toastTask?.cancel()
        withAnimation(.snappy) { toast = msg }
        let t = DispatchWorkItem { [weak self] in withAnimation(.easeOut) { self?.toast = nil } }
        toastTask = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2, execute: t)
    }
    private func showApproval(_ moves: [ApprovalMove], _ why: String) {
        approvalTask?.cancel()
        withAnimation(.snappy) { approval = (moves, why) }
        let t = DispatchWorkItem { [weak self] in withAnimation(.easeOut) { self?.approval = nil } }
        approvalTask = t
        DispatchQueue.main.asyncAfter(deadline: .now() + 6, execute: t)
    }

    private static func image(_ dataURL: String) -> UIImage? {
        guard let comma = dataURL.firstIndex(of: ","),
              let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])) else { return nil }
        return UIImage(data: data, scale: 3)
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
