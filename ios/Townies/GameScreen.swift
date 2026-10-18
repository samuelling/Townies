import SwiftUI
import UIKit

private let gold = Color(red: 1.0, green: 0.86, blue: 0.42)

/// The whole app screen: native status bar on top, native tool palette (a rail on iPad and in iPhone
/// landscape, a strip along the bottom on iPhone portrait), and the map in the middle.
struct GameScreen: View {
    let url: URL
    @StateObject private var bridge = GameBridge()
    @Environment(\.horizontalSizeClass) private var hsc
    @Environment(\.verticalSizeClass) private var vsc
    @State private var lastPage: String?

    private var rail: Bool { hsc == .regular || vsc == .compact }

    var body: some View {
        VStack(spacing: 0) {
            if bridge.live { StatusBar(bridge: bridge, wide: rail) }
            HStack(spacing: 0) {
                if bridge.live && rail { ToolPalette(bridge: bridge, vertical: true) }
                GameWebView(url: url, bridge: bridge)
                    .ignoresSafeArea(edges: bridge.live ? [] : .all)
            }
            if bridge.live && !rail { ToolPalette(bridge: bridge, vertical: false) }
        }
        .background(Color.black.ignoresSafeArea())
        .overlay(alignment: .top) { Notices(bridge: bridge).padding(.top, bridge.live ? (rail ? 52 : 92) : 12) }
        .sheet(item: $bridge.sheet, onDismiss: pageClosed) { s in
            switch s {
            case .modal(let m): ModalSheet(m: m, bridge: bridge)
            case .page(let p): PageSheet(page: p, bridge: bridge).onAppear { lastPage = p.id }
            case .search: SearchSheet(bridge: bridge)
            }
        }
        .sheet(isPresented: Binding(get: { bridge.shareText != nil }, set: { if !$0 { bridge.shareText = nil } })) {
            ShareSheet(items: [bridge.shareText ?? ""]).presentationDetents([.medium, .large])
        }
        .tint(gold)
        .animation(.snappy, value: bridge.live)
    }

    private func pageClosed() {
        if let id = lastPage { bridge.send(["type": "sheetClosed", "id": id]); lastPage = nil }
    }
}

// MARK: - Status bar

struct StatusBar: View {
    @ObservedObject var bridge: GameBridge
    let wide: Bool
    private var h: HUD { bridge.hud }

    var body: some View {
        VStack(spacing: 6) {
            HStack(spacing: 10) {
                MainMenu(bridge: bridge)
                OverlayMenu(bridge: bridge)
                Button { bridge.sheet = .search } label: { Image(systemName: "magnifyingglass") }
                if wide { stats } else { Spacer(minLength: 0) }
                SpeedMenu(bridge: bridge)
                Button { bridge.send(["type": "music"]) } label: {
                    Image(systemName: h.music ? "music.note" : "speaker.slash")
                }
            }
            if !wide {
                ScrollView(.horizontal, showsIndicators: false) { stats }
            }
            Button { bridge.open("news") } label: {
                Text(h.ticker).font(.footnote.italic()).lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(.secondary)
            }
        }
        .font(.subheadline)
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .padding(.bottom, 6)
        .background(.bar)
        .environment(\.colorScheme, .dark)
    }

    private var stats: some View {
        HStack(spacing: 12) {
            Text("\(h.date)\(h.clock.isEmpty ? "" : "  " + h.clock)").fontWeight(.semibold)
            Text(h.funds).fontWeight(.semibold).foregroundStyle(h.fundsNeg ? .red : .green)
            Label(h.pop, systemImage: "person.2.fill").labelStyle(.titleAndIcon)
            Button { bridge.open("council") } label: {
                Label("\(h.approval)%", systemImage: "hand.thumbsup.fill").foregroundStyle(h.approvalNeg ? .red : .primary)
            }
            Button { bridge.open("mainstreet") } label: {
                Label("\(h.vib)\(h.vibDir > 0 ? " ▲" : h.vibDir < 0 ? " ▼" : "")", systemImage: "cup.and.saucer.fill")
                    .foregroundStyle(h.vibDir > 0 ? .green : h.vibDir < 0 ? .red : .primary)
            }
            Button { bridge.open("crews") } label: {
                Label(h.inc, systemImage: "wrench.and.screwdriver.fill").foregroundStyle(h.incLate ? .orange : .primary)
            }
            RCI(values: h.rci)
        }
        .monospacedDigit()
        .lineLimit(1)
    }
}

/// Demand for Residential, Commercial and Industrial, as three little bars around a midline.
struct RCI: View {
    let values: [Double]
    var body: some View {
        HStack(alignment: .center, spacing: 3) {
            ForEach(0..<3, id: \.self) { k in
                let v = k < values.count ? values[k] : 0
                VStack(spacing: 0) {
                    ZStack(alignment: .bottom) { Color.clear; if v > 0 { bar(k).frame(height: 10 * v) } }.frame(height: 10)
                    ZStack(alignment: .top) { Color.clear; if v < 0 { bar(k).frame(height: 10 * -v) } }.frame(height: 10)
                }
                .frame(width: 7)
            }
        }
        .overlay(Rectangle().fill(.secondary).frame(height: 1))
        .accessibilityLabel("Demand: residential, commercial, industrial")
    }
    private func bar(_ k: Int) -> some View {
        Rectangle().fill([Color.green, Color.blue, Color.yellow][k])
    }
}

struct MainMenu: View {
    @ObservedObject var bridge: GameBridge
    var body: some View {
        Menu {
            section("windows", "Windows")
            section("file", "Game")
            section("help", "Help")
        } label: { Image(systemName: "line.3.horizontal") }
    }
    @ViewBuilder private func section(_ key: String, _ title: String) -> some View {
        let items = bridge.setup?.menus[key] ?? []
        Section(title) {
            ForEach(Array(items.enumerated()), id: \.offset) { i, label in
                Button(label) { bridge.menu(key, i) }
            }
        }
    }
}

struct OverlayMenu: View {
    @ObservedObject var bridge: GameBridge
    var body: some View {
        Menu {
            Section("Overlay") {
                ForEach(bridge.setup?.overlays ?? []) { o in
                    Button { bridge.setOverlay(o.id) } label: {
                        if bridge.hud.overlay == o.id { Label(o.label, systemImage: "checkmark") } else { Text(o.label) }
                    }
                }
            }
            Button { bridge.send(["type": "names"]) } label: {
                Label(bridge.hud.names ? "Hide street names" : "Show street names", systemImage: "character.cursor.ibeam")
            }
        } label: {
            Image(systemName: bridge.hud.overlay == "none" ? "square.3.layers.3d" : "square.3.layers.3d.top.filled")
        }
    }
}

struct SpeedMenu: View {
    @ObservedObject var bridge: GameBridge
    var body: some View {
        let speeds = bridge.setup?.speeds ?? []
        Menu {
            ForEach(Array(speeds.enumerated()).reversed(), id: \.offset) { i, sp in
                Button { bridge.setSpeed(i) } label: {
                    Text("\(sp.icon)  \(sp.name)\(sp.cycles ? " · day & night" : "")\(bridge.hud.speed == i ? "  ✓" : "")")
                }
            }
        } label: {
            Text(bridge.hud.speed < speeds.count ? speeds[bridge.hud.speed].icon : "▶").font(.title3)
        }
    }
}

// MARK: - Tool palette

struct ToolPalette: View {
    @ObservedObject var bridge: GameBridge
    let vertical: Bool
    @State private var groupCur: [String: String] = [:]

    var body: some View {
        let s = bridge.setup
        ScrollView(vertical ? .vertical : .horizontal, showsIndicators: false) {
            stack {
                ForEach(s?.loose ?? [], id: \.self) { id in toolButton(id) }
                ForEach(s?.groups ?? []) { g in groupButton(g) }
                option
                divider
                ForEach(s?.extras ?? []) { x in
                    if vertical || x.id == "undo" || x.id.hasPrefix("rot") {
                        Button { bridge.extra(x.id) } label: { tile(bridge.icon(x.id), on: false) }
                            .disabled(x.id == "undo" && !bridge.hud.canUndo)
                            .opacity(x.id == "undo" && !bridge.hud.canUndo ? 0.4 : 1)
                            .accessibilityLabel(x.label)
                    }
                }
            }
            .padding(8)
        }
        .frame(width: vertical ? 64 : nil)
        .background(.bar)
        .environment(\.colorScheme, .dark)
        .onChange(of: bridge.hud.tool) { _, t in
            if let g = bridge.setup?.groups.first(where: { $0.members.contains(t) }) { groupCur[g.id] = t }
        }
    }

    @ViewBuilder private func stack<C: View>(@ViewBuilder _ c: () -> C) -> some View {
        if vertical { VStack(spacing: 8, content: c) } else { HStack(spacing: 8, content: c) }
    }
    private var divider: some View {
        Rectangle().fill(.secondary.opacity(0.4)).frame(width: vertical ? 36 : 1, height: vertical ? 1 : 36)
    }

    private func tile(_ img: UIImage?, on: Bool, badge: String? = nil) -> some View {
        ZStack(alignment: .bottom) {
            RoundedRectangle(cornerRadius: 10).fill(on ? gold.opacity(0.9) : Color.white.opacity(0.12))
            if let img { Image(uiImage: img).resizable().interpolation(.none).scaledToFit().padding(badge == nil ? 7 : 6).padding(.bottom, badge == nil ? 0 : 6) }
            if let badge { Text(badge).font(.system(size: 8, weight: .bold)).foregroundStyle(on ? .black : .white).padding(.bottom, 2) }
        }
        .frame(width: 46, height: 46)
    }

    private func toolButton(_ id: String) -> some View {
        Button { bridge.setTool(id) } label: { tile(bridge.icon(id), on: bridge.hud.tool == id) }
            .accessibilityLabel(bridge.tool(id)?.label ?? id)
    }

    private func groupButton(_ g: GroupDef) -> some View {
        let cur = groupCur[g.id] ?? g.members.first ?? ""
        let on = g.members.contains(bridge.hud.tool)
        return Menu {
            ForEach(g.members, id: \.self) { m in
                if let t = bridge.tool(m) {
                    Button { bridge.setTool(m) } label: {
                        if let img = bridge.icon(m) { Image(uiImage: img) }
                        Text(t.label)
                        Text(t.note)
                    }
                }
            }
        } label: {
            tile(bridge.icon(on ? bridge.hud.tool : cur), on: on, badge: g.id == "zone" ? "ZONE" : g.id == "roads" ? "ROADS" : "CIVIC")
        } primaryAction: {
            bridge.setTool(on ? bridge.hud.tool : cur)
        }
        .accessibilityLabel(g.label)
    }

    // the current tool's switch: light/dense zoning, street/avenue roads, what the bulldozer takes
    @ViewBuilder private var option: some View {
        let t = bridge.hud.tool
        if t.hasPrefix("zone") {
            chip(bridge.hud.dense ? "DENSE" : "LIGHT") { bridge.send(["type": "toolOpt", "opt": "dense"]) }
        } else if t == "road" || t == "curve" {
            chip(bridge.hud.avenue ? "AVENUE" : "STREET") { bridge.send(["type": "toolOpt", "opt": "avenue"]) }
        } else if t == "bulldoze" {
            chip(bridge.hud.bd.uppercased()) { bridge.send(["type": "toolOpt", "opt": "bd"]) }
        }
    }
    private func chip(_ text: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(text).font(.system(size: 10, weight: .heavy)).foregroundStyle(.black)
                .frame(width: 46, height: 26).background(gold, in: Capsule())
        }
    }
}

// MARK: - Toasts and the approval chip

struct Notices: View {
    @ObservedObject var bridge: GameBridge
    var body: some View {
        VStack(spacing: 8) {
            if let a = bridge.approval {
                HStack(spacing: 8) {
                    ForEach(a.moves) { m in
                        Text("\(m.label) \(m.d > 0 ? "▲" : "▼")\(abs(m.d))").foregroundStyle(m.d > 0 ? .green : .red)
                    }
                    if !a.why.isEmpty { Text("· \(a.why)").foregroundStyle(.secondary) }
                }
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(.thinMaterial, in: Capsule())
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { bridge.open("council") }
            }
            if let t = bridge.toast {
                Text(t).font(.subheadline.weight(.medium)).multilineTextAlignment(.center)
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .background(.thinMaterial, in: Capsule())
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .environment(\.colorScheme, .dark)
        .allowsHitTesting(bridge.approval != nil)
    }
}

// MARK: - Sheets

/// A Council agenda item, a mission result or game over. The game waits until you choose.
struct ModalSheet: View {
    let m: Modal
    @ObservedObject var bridge: GameBridge

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    if !m.date.isEmpty { Text(m.date.uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary) }
                    if !m.heading.isEmpty { Text(m.heading).font(.title2.bold()) }
                    ForEach(Array(m.paras.enumerated()), id: \.offset) { _, p in Text(p) }
                    ForEach(Array(m.lines.enumerated()), id: \.offset) { _, l in Text(l).font(.subheadline) }
                    if m.showWhere {
                        Button { bridge.send(["type": "modalWhere"]) } label: { Label("Show me where", systemImage: "mappin.and.ellipse") }
                    }
                    ForEach(Array(m.choices.enumerated()), id: \.offset) { i, c in
                        Button {
                            bridge.send(["type": "modalChoose", "i": i])
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(c.label).font(.headline).foregroundStyle(.primary)
                                if !c.sub.isEmpty { Text(c.sub).font(.footnote).foregroundStyle(.secondary) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                    }
                    if !m.fine.isEmpty { Text(m.fine).font(.footnote).foregroundStyle(.secondary) }
                }
                .padding()
            }
            .navigationTitle(m.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents(m.kind == "agenda" ? [.medium, .large] : [.large])
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
        .interactiveDismissDisabled()
    }
}

/// The lot inspector, the newspaper and your term, laid out natively from the game's own content.
struct PageSheet: View {
    let page: Sheet
    @ObservedObject var bridge: GameBridge
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(page.blocks) { b in block(b) }
                }
                .padding()
            }
            .navigationTitle(page.id == "query" ? "" : page.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationBackgroundInteraction(.enabled(upThrough: .medium))
    }

    @ViewBuilder private func block(_ b: Block) -> some View {
        switch b.t {
        case "mast":
            Text(b.text ?? "").font(.custom("Georgia", size: 30)).frame(maxWidth: .infinity)
        case "h2":
            Text(b.text ?? "").font(page.id == "news" ? Font.custom("Georgia-Bold", size: 24) : Font.title2.bold())
        case "h3":
            Text(b.text ?? "").font(.title3.bold())
        case "h4":
            Text((b.text ?? "").uppercased()).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.top, 6)
        case "fine":
            Text(b.text ?? "").font(.footnote).foregroundStyle(.secondary)
        case "kv":
            HStack(alignment: .firstTextBaseline) {
                Text(b.k ?? "").foregroundStyle(.secondary)
                Spacer(minLength: 12)
                Text(b.v ?? "").multilineTextAlignment(.trailing)
            }
            .font(.subheadline)
            Divider()
        case "story":
            VStack(alignment: .leading, spacing: 4) {
                Text(b.date ?? "").font(.caption).foregroundStyle(.secondary)
                Text(b.title ?? "").font(.custom("Georgia-Bold", size: 17))
                if let t = b.text, !t.isEmpty { Text(t).font(.custom("Georgia", size: 15)) }
                comments(b.comments ?? [])
            }
            .padding(.vertical, 4)
            Divider()
        case "comments":
            comments(b.comments ?? [])
        case "btn":
            Button {
                bridge.send(["type": "sheetButton", "id": page.id, "i": b.i ?? 0])
                dismiss()
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text(b.label ?? "").font(.headline)
                    if let s = b.sub, !s.isEmpty { Text(s).font(.footnote).foregroundStyle(.secondary) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.bordered)
        default:
            Text(b.text ?? "")
        }
    }

    @ViewBuilder private func comments(_ list: [Comment]) -> some View {
        if !list.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(list) { c in
                    (Text(c.who).bold() + Text(" " + c.text)).font(.footnote)
                }
            }
            .padding(.leading, 10)
            .overlay(alignment: .leading) { Rectangle().fill(.secondary.opacity(0.4)).frame(width: 3) }
        }
    }
}

/// Find a street, address, business or landmark (the game's own search) and fly there.
struct SearchSheet: View {
    @ObservedObject var bridge: GameBridge
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var hits: [SearchHit] = []

    var body: some View {
        NavigationStack {
            List(hits) { h in
                Button {
                    bridge.send(["type": "goto", "i": h.i])
                    dismiss()
                } label: {
                    Label {
                        VStack(alignment: .leading) {
                            Text(h.label)
                            if !h.sub.isEmpty { Text(h.sub).font(.footnote).foregroundStyle(.secondary) }
                        }
                    } icon: {
                        Image(systemName: h.kind == "street" ? "road.lanes" : h.kind == "address" ? "house" : "mappin")
                    }
                }
            }
            .overlay { if hits.isEmpty && !q.isEmpty { ContentUnavailableView.search(text: q) } }
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: "Street, address, place")
            .onChange(of: q) { _, v in bridge.search(v) { hits = $0 } }
            .navigationTitle("Find")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
