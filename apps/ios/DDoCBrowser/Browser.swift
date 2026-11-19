import SwiftUI
import UniformTypeIdentifiers
import WebKit

/// Serves the bundled dashboard and internal pages at ddoc://ui/...
final class DDoCSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url,
              let file = Bundle.main.url(forResource: url.deletingPathExtension().lastPathComponent, withExtension: url.pathExtension, subdirectory: "ddoc"),
              let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist)); return
        }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "text/plain"
        task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// The isolated JavaScript world the page agent runs in. Page scripts cannot see or call into it.
let ddocWorld = WKContentWorld.world(name: "ddoc")

/// Page-agent channel (isolated world) and dashboard channel (ddoc:// pages only).
final class PageBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var tabs: TabManager?

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let raw = message.body as? String, let data = raw.data(using: .utf8),
              var msg = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { replyHandler(nil, "bad message"); return }
        let origin = message.frameInfo.securityOrigin
        Task { @MainActor in
            if message.name == "ddoc" {
                // Page agent: host comes from WebKit, never from the page.
                var params = (msg["params"] as? [String: Any]) ?? [:]
                params["host"] = origin.host
                let out = try! JSONSerialization.data(withJSONObject: ["method": msg["method"] ?? "", "params": params])
                let r = await EngineHost.shared.call(String(data: out, encoding: .utf8)!, trusted: false)
                if (msg["method"] as? String) == "classify" { self.tabs?.countFiltered(r) }
                replyHandler(r, nil)
            } else if message.name == "ddocAdmin" {
                guard origin.protocol == "ddoc" else { replyHandler(nil, "not allowed"); return }
                if (msg["kind"] as? String) == "chrome" {
                    let arg = (msg["params"] as? [String: Any])?["arg"]
                    self.tabs?.chrome(msg["method"] as? String ?? "", arg: arg as? String)
                    replyHandler(#"{"ok":true,"result":null}"#, nil); return
                }
                if let local = self.tabs?.browserData(msg["method"] as? String ?? "", params: msg["params"] as? [String: Any] ?? [:]) {
                    let d = try! JSONSerialization.data(withJSONObject: ["ok": true, "result": local])
                    replyHandler(String(data: d, encoding: .utf8), nil); return
                }
                msg.removeValue(forKey: "kind")
                let out = try! JSONSerialization.data(withJSONObject: msg)
                let r = await EngineHost.shared.call(String(data: out, encoding: .utf8)!, trusted: true)
                replyHandler(r, nil)
                if ["switchProfile", "updateDesign", "updateSetting", "updateProfile"].contains(msg["method"] as? String ?? "") { self.tabs?.reloadWebTabs() }
            }
        }
    }
}

@MainActor
final class Tab: NSObject, ObservableObject, Identifiable, WKNavigationDelegate, WKUIDelegate {
    let id = UUID()
    let web: WKWebView
    let isPrivate: Bool
    @Published var title = "New tab"
    @Published var url = ""
    @Published var canBack = false
    @Published var loading = false
    weak var manager: TabManager?

    init(isPrivate: Bool, bridge: PageBridge, agentJS: String, shimJS: String) {
        self.isPrivate = isPrivate
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = isPrivate ? .nonPersistent() : .default()
        cfg.setURLSchemeHandler(DDoCSchemeHandler(), forURLScheme: "ddoc")
        cfg.mediaTypesRequiringUserActionForPlayback = .all
        let ucc = cfg.userContentController
        ucc.addUserScript(WKUserScript(source: agentJS, injectionTime: .atDocumentStart, forMainFrameOnly: false, in: ddocWorld))
        ucc.addScriptMessageHandler(bridge, contentWorld: ddocWorld, name: "ddoc")
        ucc.addScriptMessageHandler(bridge, contentWorld: .page, name: "ddocAdmin")
        ucc.addUserScript(WKUserScript(source: shimJS, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        web = WKWebView(frame: .zero, configuration: cfg)
        web.allowsBackForwardNavigationGestures = true
        super.init()
        web.navigationDelegate = self
        web.uiDelegate = self
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let u = action.request.url else { return .cancel }
        if !["http", "https", "ddoc", "about"].contains(u.scheme ?? "") { return .cancel }
        if action.targetFrame?.isMainFrame == true, let host = u.host, u.scheme != "ddoc", await EngineHost.shared.hostPolicy(host) {
            webView.load(URLRequest(url: URL(string: "ddoc://ui/blocked.html?host=\(host)")!))
            return .cancel
        }
        return .allow
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { loading = true }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loading = false
        title = webView.title ?? ""
        url = webView.url?.absoluteString ?? ""
        canBack = webView.canGoBack
        if !isPrivate, !url.hasPrefix("ddoc:") { manager?.store.addHistory(title: title, url: url) }
    }
    func webView(_ webView: WKWebView, createWebViewWith c: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url { manager?.newTab(u.absoluteString) }
        return nil
    }
}

/// Bookmarks and history (file protected with complete protection). Private tabs never write.
final class BrowserStore {
    private let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("browser.json")
    var bookmarks: [[String: Any]] = []
    var history: [[String: Any]] = []
    init() {
        if let d = try? Data(contentsOf: url), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] {
            bookmarks = o["bookmarks"] as? [[String: Any]] ?? []; history = o["history"] as? [[String: Any]] ?? []
        }
    }
    func persist() {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let d = try? JSONSerialization.data(withJSONObject: ["bookmarks": bookmarks, "history": history]) { try? d.write(to: url, options: [.atomic, .completeFileProtection]) }
    }
    func addHistory(title: String, url: String) { history.insert(["title": title, "url": url, "ts": Date().timeIntervalSince1970 * 1000], at: 0); history = Array(history.prefix(5000)); persist() }
    func toggleBookmark(title: String, url: String) {
        if let i = bookmarks.firstIndex(where: { $0["url"] as? String == url }) { bookmarks.remove(at: i) } else { bookmarks.insert(["title": title, "url": url], at: 0) }
        persist()
    }
}

@MainActor
final class TabManager: ObservableObject {
    @Published var tabs: [Tab] = []
    @Published var active: Int = 0
    @Published var filtered = 0
    let store = BrowserStore()
    private let bridge = PageBridge()
    private let agentJS: String
    private let shimJS: String

    init() {
        func res(_ n: String) -> String {
            guard let u = Bundle.main.url(forResource: n, withExtension: "js", subdirectory: "ddoc"), let s = try? String(contentsOf: u) else { return "" }
            return s
        }
        agentJS = res("ddoc-agent")
        shimJS = "if (location.protocol === 'ddoc:') {" + res("admin-shim") + "}"
        bridge.tabs = self
        newTab("https://duckduckgo.com/")
    }

    var current: Tab? { tabs.indices.contains(active) ? tabs[active] : nil }

    func newTab(_ url: String, isPrivate: Bool = false) {
        Task {
            if isPrivate, (await EngineHost.shared.activeProfile()["allowPrivateWindows"] as? Bool) != true { return }
            let t = Tab(isPrivate: isPrivate, bridge: bridge, agentJS: agentJS, shimJS: shimJS)
            t.manager = self
            tabs.append(t)
            active = tabs.count - 1
            if let u = URL(string: url) { t.web.load(URLRequest(url: u)) }
        }
    }

    func close(_ i: Int) {
        tabs.remove(at: i)
        if tabs.isEmpty { newTab("https://duckduckgo.com/") } else { active = min(active, tabs.count - 1) }
    }

    func navigate(_ input: String) {
        let s = input.trimmingCharacters(in: .whitespaces)
        let url: String
        if s.lowercased().hasPrefix("http://") || s.lowercased().hasPrefix("https://") { url = s }
        else if s.range(of: #"^[\w-]+(\.[\w-]+)+(/.*)?$"#, options: .regularExpression) != nil { url = "https://" + s }
        else { url = "https://duckduckgo.com/?q=" + (s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "") }
        current?.web.load(URLRequest(url: URL(string: url)!))
    }

    func dashboard(_ section: String = "overview") { newTab("ddoc://ui/dashboard.html#\(section)") }

    func chrome(_ cmd: String, arg: String?) {
        if cmd == "navigate", let a = arg { navigate(a) }
        if cmd == "newTab" { newTab(arg ?? "https://duckduckgo.com/") }
    }

    func browserData(_ method: String, params: [String: Any]) -> Any? {
        switch method {
        case "browserData": return ["bookmarks": store.bookmarks, "history": store.history, "downloads": []]
        case "removeBookmark": store.bookmarks.removeAll { $0["url"] as? String == params["url"] as? String }; store.persist(); return true
        case "clearHistory": store.history = []; store.persist(); return true
        case "exportReport": return false
        default: return nil
        }
    }

    func reloadWebTabs() { tabs.filter { !($0.web.url?.scheme == "ddoc") }.forEach { $0.web.reload() } }

    func countFiltered(_ json: String) {
        guard let d = json.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let arr = o["result"] as? [[String: Any]] else { return }
        filtered += arr.filter { ($0["action"] as? String) != "allow" }.count
    }

    func teachSelection() {
        current?.web.evaluateJavaScript("window.__ddocOpenTeach && window.__ddocOpenTeach(String(getSelection()))", in: nil, in: ddocWorld)
    }
}

struct WebContainer: UIViewRepresentable {
    let web: WKWebView
    func makeUIView(context: Context) -> WKWebView { web }
    func updateUIView(_ v: WKWebView, context: Context) {}
}

struct BrowserView: View {
    @StateObject var tm = TabManager()
    @State private var address = ""
    @State private var showTabs = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                Button { tm.current?.web.goBack() } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Back")
                TextField("Search or address", text: $address)
                    .textFieldStyle(.roundedBorder).autocorrectionDisabled().textInputAutocapitalization(.never)
                    .onSubmit { tm.navigate(address) }
                Button { tm.dashboard() } label: { Label("\(tm.filtered)", systemImage: "shield.lefthalf.filled") }.accessibilityLabel("Safety dashboard")
                Button { showTabs = true } label: { Image(systemName: "square.on.square") }.accessibilityLabel("Tabs")
                Menu {
                    Button("Teach DDoC about selection") { tm.teachSelection() }
                    Button("Bookmark page") { if let t = tm.current, !t.isPrivate { tm.store.toggleBookmark(title: t.title, url: t.url) } }
                    Button("Bookmarks") { tm.dashboard("bookmarks") }
                    Button("History") { tm.dashboard("history") }
                    Button("New private tab") { tm.newTab("https://duckduckgo.com/", isPrivate: true) }
                    Button("Profiles & parental controls") { tm.dashboard("profiles") }
                    Button("Privacy & JEV") { tm.dashboard("privacy") }
                } label: { Image(systemName: "ellipsis.circle") }
            }
            .padding(8)
            if let t = tm.current { WebContainer(web: t.web).id(t.id) }
        }
        .sheet(isPresented: $showTabs) {
            NavigationStack {
                List {
                    ForEach(Array(tm.tabs.enumerated()), id: \.element.id) { i, t in
                        Button { tm.active = i; showTabs = false } label: { Label(t.title, systemImage: t.isPrivate ? "eyeglasses" : "globe") }
                            .swipeActions { Button(role: .destructive) { tm.close(i) } label: { Text("Close") } }
                    }
                }
                .navigationTitle("Tabs")
                .toolbar {
                    Button("New") { tm.newTab("https://duckduckgo.com/"); showTabs = false }
                    Button("Private") { tm.newTab("https://duckduckgo.com/", isPrivate: true); showTabs = false }
                }
            }
        }
        .onReceive(tm.objectWillChange) { _ in DispatchQueue.main.async { address = tm.current?.url ?? "" } }
    }
}

@main
struct DDoCBrowserApp: App {
    init() { Task { @MainActor in EngineHost.shared.start() } }
    var body: some Scene { WindowGroup { BrowserView() } }
}
