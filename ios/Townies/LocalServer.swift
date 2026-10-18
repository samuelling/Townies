import Foundation
import Network

/// A tiny HTTP server on the loopback interface that serves the bundled game (the `Web` folder in the
/// app bundle). Loopback only: nothing outside the phone can reach it, and it doesn't trigger the
/// local-network permission prompt.
///
/// The port is fixed, because the page's origin (127.0.0.1:port) is what the saves and settings are
/// filed under; a different port would look like a different site with no saves.
final class LocalServer: ObservableObject {
    static let shared = LocalServer()
    static let port: UInt16 = 47131

    @Published private(set) var ready = false
    @Published private(set) var error: String?
    private(set) var baseURL = URL(string: "http://127.0.0.1:\(LocalServer.port)/")!

    private let root: URL = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
    private let queue = DispatchQueue(label: "townies.server")
    private var listener: NWListener?
    private var cache: [String: Data] = [:]

    func start() {
        queue.async { [weak self] in self?.startOnQueue() }
    }

    private func startOnQueue() {
        if let l = listener, l.state == .ready { return }
        listener?.cancel()
        let params = NWParameters.tcp
        params.requiredInterfaceType = .loopback
        params.allowLocalEndpointReuse = true
        do {
            let l = try NWListener(using: params, on: NWEndpoint.Port(rawValue: Self.port)!)
            l.newConnectionHandler = { [weak self] c in self?.serve(c) }
            l.stateUpdateHandler = { [weak self] state in
                guard let self else { return }
                switch state {
                case .ready:
                    DispatchQueue.main.async { self.error = nil; self.ready = true }
                case .failed(let e):
                    DispatchQueue.main.async { self.error = e.localizedDescription }
                    self.listener = nil
                    // try again shortly (e.g. after coming back from the background)
                    self.queue.asyncAfter(deadline: .now() + 1) { self.startOnQueue() }
                default: break
                }
            }
            listener = l
            l.start(queue: queue)
        } catch {
            DispatchQueue.main.async { self.error = error.localizedDescription }
        }
    }

    // MARK: HTTP

    private func serve(_ c: NWConnection) {
        c.start(queue: queue)
        receive(c, buffer: Data())
    }

    private func receive(_ c: NWConnection, buffer: Data) {
        c.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, done, err in
            guard let self else { return }
            var buf = buffer
            if let data { buf.append(data) }
            if let end = buf.range(of: Data("\r\n\r\n".utf8)) {
                let head = String(decoding: buf[..<end.lowerBound], as: UTF8.self)
                self.respond(c, head: head)
            } else if done || err != nil || buf.count > 256 * 1024 {
                c.cancel()
            } else {
                self.receive(c, buffer: buf)
            }
        }
    }

    private func respond(_ c: NWConnection, head: String) {
        let parts = head.split(separator: "\r\n", maxSplits: 1).first?.split(separator: " ") ?? []
        let method = parts.count > 0 ? String(parts[0]) : "GET"
        var path = parts.count > 1 ? String(parts[1]) : "/"
        if let q = path.firstIndex(where: { $0 == "?" || $0 == "#" }) { path = String(path[..<q]) }
        path = path.removingPercentEncoding ?? path
        if path.hasSuffix("/") { path += "index.html" }

        var status = "200 OK"
        var body = Data()
        var type = "text/plain; charset=utf-8"
        if let data = file(path) {
            body = data
            type = Self.mime(path)
        } else {
            status = "404 Not Found"
            body = Data("Not found".utf8)
        }
        var header = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\n"
        header += "Cache-Control: no-cache\r\nConnection: close\r\n\r\n"
        var out = Data(header.utf8)
        if method != "HEAD" { out.append(body) }
        c.send(content: out, completion: .contentProcessed { _ in c.cancel() })
    }

    private func file(_ path: String) -> Data? {
        if let d = cache[path] { return d }
        let url = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
        // stay inside the bundled game
        guard url.path.hasPrefix(root.standardizedFileURL.path + "/"),
              let d = try? Data(contentsOf: url) else { return nil }
        cache[path] = d
        return d
    }

    private static func mime(_ path: String) -> String {
        switch (path as NSString).pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json"
        case "gz": return "application/gzip" // decompressed by the game itself, so no Content-Encoding
        case "woff2": return "font/woff2"
        case "png": return "image/png"
        case "svg": return "image/svg+xml"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}
