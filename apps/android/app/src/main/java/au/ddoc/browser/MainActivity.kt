package au.ddoc.browser

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.webkit.*
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.*
import org.json.JSONArray
import org.json.JSONObject

/**
 * DDoC Browser for Android. Tabs, private tabs, bookmarks, history, downloads, and the shared
 * DDoC page agent injected at document start into every frame.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var engine: EngineHost
    private lateinit var content: FrameLayout
    private lateinit var address: EditText
    private lateinit var shield: Button
    private val tabs = mutableListOf<Tab>()
    private var active = -1
    private lateinit var agentJs: String
    private lateinit var store: BrowserStore
    private var filtered = 0

    data class Tab(val web: WebView, val private: Boolean, var title: String = "New tab")

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        engine = EngineHost(this).also { it.start() }
        store = BrowserStore(this)
        agentJs = assets.open("ddoc/ddoc-agent.js").bufferedReader().readText()
        buildUi()
        newTab(intent?.data?.toString() ?: DASHBOARD_HOME, private = false)
    }

    private fun buildUi() {
        val root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val bar = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(8, 8, 8, 8) }
        fun btn(label: String, desc: String, onClick: () -> Unit) = Button(this, null, android.R.attr.borderlessButtonStyle).apply {
            text = label; contentDescription = desc; minWidth = 0; setPadding(18, 0, 18, 0); setOnClickListener { onClick() }
        }
        bar.addView(btn("‹", "Back") { current()?.web?.let { if (it.canGoBack()) it.goBack() } })
        address = EditText(this).apply {
            hint = "Search or address"; isSingleLine = true; imeOptions = EditorInfo.IME_ACTION_GO
            setOnEditorActionListener { v, _, _ -> navigate(v.text.toString()); true }
        }
        bar.addView(address, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        shield = btn("🛡 0", "Safety dashboard") { openDashboard("overview") }
        bar.addView(shield)
        bar.addView(btn("⧉", "Tabs") { showTabs() })
        bar.addView(btn("⋮", "Menu") { showMenu() })
        content = FrameLayout(this)
        root.addView(bar)
        root.addView(content, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    private fun current() = tabs.getOrNull(active)

    @SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
    private fun newTab(url: String, private: Boolean) {
        if (private) {
            engine.activeProfile { p ->
                if (!p.optBoolean("allowPrivateWindows")) { Toast.makeText(this, "Private tabs are off for this profile", Toast.LENGTH_SHORT).show() }
                else createTab(url, true)
            }
        } else createTab(url, false)
    }

    @SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
    private fun createTab(url: String, private: Boolean) {
        val web = WebView(this)
        if (private && WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) {
            WebViewCompat.setProfile(web, "private-${System.currentTimeMillis()}")
        }
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = true
        val tab = Tab(web, private)

        // Shared page agent in every frame at document start.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(web, agentJs, setOf("*"))
        }
        // Page channel: origin is supplied by WebView, not by the page.
        WebViewCompat.addWebMessageListener(web, "DDocAndroid", setOf("*")) { _, message, sourceOrigin, _, reply ->
            val msg = JSONObject(message.data ?: "{}")
            val params = msg.optJSONObject("params") ?: JSONObject()
            params.put("host", sourceOrigin.host ?: "")
            val id = msg.optInt("id")
            engine.call(JSONObject().put("method", msg.optString("method")).put("params", params).toString(), trusted = false) { r ->
                val res = JSONObject(r).put("id", id)
                reply.postMessage(res.toString())
                if (msg.optString("method") == "classify") updateCounter(res)
            }
        }
        // Dashboard channel: only our bundled asset origin may use it.
        WebViewCompat.addWebMessageListener(web, "DDocAdminAndroid", setOf("https://appassets.androidplatform.net")) { _, message, _, _, reply ->
            val msg = JSONObject(message.data ?: "{}")
            val id = msg.optInt("id")
            if (msg.optString("kind") == "chrome") { handleChrome(msg.optString("method"), msg.optJSONObject("params")?.opt("arg")); return@addWebMessageListener }
            val local = handleBrowserData(msg.optString("method"), msg.optJSONObject("params") ?: JSONObject())
            if (local != null) { reply.postMessage(JSONObject().put("id", id).put("ok", true).put("result", local).toString()); return@addWebMessageListener }
            engine.call(JSONObject().put("method", msg.optString("method")).put("params", msg.optJSONObject("params")).toString(), trusted = true) { r ->
                reply.postMessage(JSONObject(r).put("id", id).toString())
                if (msg.optString("method") in setOf("switchProfile", "updateDesign", "updateSetting", "updateProfile")) tabs.forEach { t -> if (t.web.url?.startsWith("https://appassets") != true) t.web.reload() }
            }
        }

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest) = assetLoader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme !in setOf("http", "https")) return true // no external app launches
                if (request.isForMainFrame) {
                    engine.hostPolicy(u.host ?: "") { pol ->
                        if (pol.optBoolean("blocked")) view.loadUrl("$ASSET_BASE/blocked.html?host=${Uri.encode(u.host)}")
                    }
                }
                return false
            }
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) view.evaluateJavascript(agentJs, null)
                if (view == current()?.web) address.setText(if (url.startsWith(ASSET_BASE)) "" else url)
            }
            override fun onPageFinished(view: WebView, url: String) {
                tab.title = view.title ?: url
                if (!tab.private && !url.startsWith(ASSET_BASE)) store.addHistory(tab.title, url)
            }
        }
        web.setDownloadListener { url, _, _, _, _ -> startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
        web.setOnLongClickListener {
            // Long-press selection is handled by the agent's in-page "Teach DDoC" pill.
            false
        }
        tabs.add(tab)
        activate(tabs.size - 1)
        web.loadUrl(url)
    }

    private fun updateCounter(res: JSONObject) {
        val arr = res.optJSONArray("result") ?: return
        for (i in 0 until arr.length()) if (arr.getJSONObject(i).optString("action") != "allow") filtered++
        runOnUiThread { shield.text = "🛡 $filtered" }
    }

    private fun activate(i: Int) {
        active = i
        content.removeAllViews()
        current()?.let { content.addView(it.web); address.setText(it.web.url ?: "") }
    }

    private fun closeTab(i: Int) {
        val t = tabs.removeAt(i)
        val profileName = if (t.private && WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE)) WebViewCompat.getProfile(t.web).name else null
        t.web.destroy()
        // Private tab data (cookies, storage, cache) is discarded with its WebView profile.
        profileName?.let { runCatching { ProfileStore.getInstance().deleteProfile(it) } }
        if (tabs.isEmpty()) newTab(DASHBOARD_HOME, false) else activate(minOf(i, tabs.size - 1))
    }

    private fun navigate(input: String) {
        val s = input.trim()
        val url = when {
            Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(s) -> s
            Regex("^[\\w-]+(\\.[\\w-]+)+(/.*)?$").matches(s) -> "https://$s"
            else -> "https://duckduckgo.com/?q=" + Uri.encode(s)
        }
        current()?.web?.loadUrl(url)
    }

    private fun openDashboard(section: String) = newTab("$ASSET_BASE/dashboard.html#$section", false)

    private fun showTabs() {
        val names = tabs.mapIndexed { i, t -> (if (t.private) "🕶 " else "") + t.title + if (i == active) "  •" else "" }.toTypedArray()
        AlertDialog.Builder(this).setTitle("Tabs")
            .setItems(names) { _, i -> activate(i) }
            .setPositiveButton("New tab") { _, _ -> newTab(DASHBOARD_HOME, false) }
            .setNeutralButton("Private tab") { _, _ -> newTab(DASHBOARD_HOME, true) }
            .setNegativeButton("Close current") { _, _ -> closeTab(active) }
            .show()
    }

    private fun showMenu() {
        val items = arrayOf("Bookmark this page", "Bookmarks", "History", "Teach DDoC (selected text)", "Safety dashboard", "Profiles & parental controls", "Privacy & JEV")
        AlertDialog.Builder(this).setItems(items) { _, i ->
            when (i) {
                0 -> current()?.let { if (!it.private) store.toggleBookmark(it.title, it.web.url ?: "") }
                1 -> openDashboard("bookmarks"); 2 -> openDashboard("history")
                3 -> current()?.web?.evaluateJavascript("window.__ddocOpenTeach && window.__ddocOpenTeach(String(getSelection()))", null)
                4 -> openDashboard("overview"); 5 -> openDashboard("profiles"); 6 -> openDashboard("privacy")
            }
        }.show()
    }

    private fun handleChrome(cmd: String, arg: Any?) = runOnUiThread {
        when (cmd) {
            "navigate" -> navigate(arg.toString())
            "newTab" -> newTab(arg?.toString() ?: DASHBOARD_HOME, false)
        }
    }

    /** Browser data lives natively on mobile; returns null for engine methods. */
    private fun handleBrowserData(method: String, p: JSONObject): Any? = when (method) {
        "browserData" -> JSONObject().put("bookmarks", store.bookmarks()).put("history", store.history()).put("downloads", JSONArray())
        "removeBookmark" -> { store.removeBookmark(p.optString("url")); true }
        "clearHistory" -> { store.clearHistory(); true }
        "exportReport" -> {
            engine.call("{\"method\":\"report\"}", true) { r ->
                startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_TEXT, JSONObject(r).optString("result")), "Export transparency report"))
            }
            true
        }
        else -> null
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK && current()?.web?.canGoBack() == true) { current()?.web?.goBack(); return true }
        return super.onKeyDown(keyCode, event)
    }

    companion object {
        const val ASSET_BASE = "https://appassets.androidplatform.net/assets/ddoc"
        const val DASHBOARD_HOME = "https://duckduckgo.com/"
    }
}
