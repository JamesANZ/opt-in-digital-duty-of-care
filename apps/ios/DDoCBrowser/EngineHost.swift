import CryptoKit
import Foundation
import Security
import WebKit

/// Runs the shared DDoC engine (ddoc-engine.js) in a hidden WKWebView with an https base URL
/// (so WebCrypto is available). State is encrypted with AES-GCM using a key held in the Keychain.
/// JEV HTTP goes through URLSession here, so the API key never enters a page context.
@MainActor
final class EngineHost: NSObject, WKScriptMessageHandler {
    static let shared = EngineHost()

    private var web: WKWebView!
    private var ready = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private let stateURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("engine.enc")

    func start() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()
        cfg.userContentController.add(self, name: "native")
        web = WKWebView(frame: .zero, configuration: cfg)
        guard let url = Bundle.main.url(forResource: "ddoc-engine", withExtension: "js", subdirectory: "ddoc"),
              let js = try? String(contentsOf: url) else { fatalError("engine bundle missing; run npm run build") }
        let html = "<!doctype html><html><head><meta charset=utf-8><script>\(js)</script></head><body></body></html>"
        web.navigationDelegate = self
        web.loadHTMLString(html, baseURL: URL(string: "https://engine.ddoc.invalid/"))
    }

    private func waitReady() async {
        if ready { return }
        await withCheckedContinuation { waiters.append($0) }
    }

    /// RPC into the engine. Returns the engine's JSON string `{ ok, result | error }`.
    func call(_ msgJSON: String, trusted: Bool) async -> String {
        await waitReady()
        do {
            let r = try await web.callAsyncJavaScript("return await DDoCHost.handle(msg, trusted)", arguments: ["msg": msgJSON, "trusted": trusted], contentWorld: .page)
            return (r as? String) ?? #"{"ok":false,"error":"no result"}"#
        } catch {
            return #"{"ok":false,"error":"engine error"}"#
        }
    }

    func hostPolicy(_ host: String) async -> Bool {
        await waitReady()
        let r = try? await web.callAsyncJavaScript("return DDoCHost.hostPolicy(h)", arguments: ["h": host], contentWorld: .page)
        guard let s = r as? String, let d = s.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return false }
        return (o["blocked"] as? Bool) ?? false
    }

    func activeProfile() async -> [String: Any] {
        await waitReady()
        let r = try? await web.callAsyncJavaScript("return DDoCHost.activeProfile()", arguments: [:], contentWorld: .page)
        guard let s = r as? String, let d = s.data(using: .utf8) else { return [:] }
        return (try? JSONSerialization.jsonObject(with: d) as? [String: Any]) ?? [:]
    }

    // MARK: native messages from the engine (save, fetch)

    nonisolated func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        Task { @MainActor in
            if type == "save", let json = body["json"] as? String { self.save(json) }
            if type == "fetch", let id = body["id"] as? Int, let url = body["url"] as? String, let initObj = body["init"] as? [String: Any] {
                await self.fetch(id: id, url: url, init: initObj)
            }
        }
    }

    private func fetch(id: Int, url: String, init initObj: [String: Any]) async {
        var ok = false, status = 0, text = ""
        if let u = URL(string: url), u.scheme == "https", u.path.hasSuffix("/v1/systemone") {
            var req = URLRequest(url: u, timeoutInterval: 8)
            req.httpMethod = (initObj["method"] as? String) ?? "POST"
            (initObj["headers"] as? [String: String])?.forEach { req.setValue($1, forHTTPHeaderField: $0) }
            req.httpBody = (initObj["body"] as? String)?.data(using: .utf8)
            if let (data, resp) = try? await URLSession.shared.data(for: req), let h = resp as? HTTPURLResponse {
                status = h.statusCode; ok = (200..<300).contains(status); text = String(data: data, encoding: .utf8) ?? ""
            } else { text = "network error" }
        } else { text = "only the JEV endpoint is allowed" }
        _ = try? await web.callAsyncJavaScript("DDoCHost.fetchResult(id, ok, status, body)", arguments: ["id": id, "ok": ok, "status": status, "body": text], contentWorld: .page)
    }

    // MARK: encrypted persistence

    private func key() -> SymmetricKey {
        let tag = "au.ddoc.browser.engine-key"
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: tag, kSecReturnData as String: true]
        var out: CFTypeRef?
        if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data { return SymmetricKey(data: d) }
        let k = SymmetricKey(size: .bits256)
        let data = k.withUnsafeBytes { Data($0) }
        let add: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: tag, kSecValueData as String: data,
                                  kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        SecItemAdd(add as CFDictionary, nil)
        return k
    }

    private func save(_ json: String) {
        guard let sealed = try? AES.GCM.seal(Data(json.utf8), using: key()).combined else { return }
        try? FileManager.default.createDirectory(at: stateURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? sealed.write(to: stateURL, options: [.atomic, .completeFileProtection])
    }

    private func load() -> String? {
        guard let d = try? Data(contentsOf: stateURL), let box = try? AES.GCM.SealedBox(combined: d),
              let plain = try? AES.GCM.open(box, using: key()) else { return nil }
        return String(data: plain, encoding: .utf8)
    }
}

extension EngineHost: WKNavigationDelegate {
    nonisolated func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            let saved: Any = self.load() ?? NSNull()
            _ = try? await self.web.callAsyncJavaScript("return DDoCHost.init(s)", arguments: ["s": saved], contentWorld: .page)
            self.ready = true
            self.waiters.forEach { $0.resume() }
            self.waiters.removeAll()
        }
    }
}
