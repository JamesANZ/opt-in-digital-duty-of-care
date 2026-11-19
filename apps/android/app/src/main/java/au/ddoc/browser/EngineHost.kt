package au.ddoc.browser

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.security.crypto.EncryptedFile
import androidx.security.crypto.MasterKey
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Runs the shared DDoC engine (ddoc-engine.js) in a hidden WebView. The same bundle runs on
 * desktop and iOS, so classification, learning and policy behave identically everywhere.
 *
 * State is persisted with Jetpack Security EncryptedFile (AES-256-GCM, key in Android Keystore).
 * JEV HTTP calls go through this class so the API key never enters a page context.
 */
class EngineHost(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newFixedThreadPool(4)
    private val replies = ConcurrentHashMap<Int, (String) -> Unit>()
    private val seq = AtomicInteger()
    private val queue = mutableListOf<() -> Unit>()
    private var ready = false
    private val web = WebView(context)

    private val stateFile = File(context.filesDir, "engine.enc")
    private val masterKey by lazy { MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build() }

    private val assets = WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
        .build()

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    fun start() {
        web.settings.javaScriptEnabled = true
        web.settings.allowFileAccess = false
        web.addJavascriptInterface(Native(), "DDocNative") // engine page only: our own asset
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assets.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                val saved = readState()
                val arg = if (saved == null) "null" else JSONObject.quote(saved)
                web.evaluateJavascript("DDoCHost.init($arg)") {
                    ready = true
                    queue.forEach { it() }
                    queue.clear()
                }
            }
        }
        web.loadUrl("https://appassets.androidplatform.net/assets/ddoc/engine.html")
    }

    /** Send an RPC message (JSON) to the engine. `trusted` is true only for the dashboard. */
    fun call(msgJson: String, trusted: Boolean, cb: (String) -> Unit) {
        val run = {
            val id = seq.incrementAndGet()
            replies[id] = cb
            val js = "DDoCHost.handle(${JSONObject.quote(msgJson)}, $trusted).then(function(r){DDocNative.reply($id, r)})"
            web.evaluateJavascript(js, null)
        }
        main.post { if (ready) run() else queue.add(run) }
    }

    fun hostPolicy(host: String, cb: (JSONObject) -> Unit) = main.post {
        web.evaluateJavascript("DDoCHost.hostPolicy(${JSONObject.quote(host)})") { r ->
            cb(JSONObject(JSONObject("{\"v\":$r}").getString("v")))
        }
    }

    fun activeProfile(cb: (JSONObject) -> Unit) = main.post {
        web.evaluateJavascript("DDoCHost.activeProfile()") { r -> cb(JSONObject(JSONObject("{\"v\":$r}").getString("v"))) }
    }

    private fun readState(): String? = try {
        if (!stateFile.exists()) null
        else EncryptedFile.Builder(context, stateFile, masterKey, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB)
            .build().openFileInput().use { it.readBytes().toString(Charsets.UTF_8) }
    } catch (e: Exception) { null }

    private fun writeState(json: String) {
        val tmp = File(context.filesDir, "engine.enc.tmp")
        tmp.delete()
        EncryptedFile.Builder(context, tmp, masterKey, EncryptedFile.FileEncryptionScheme.AES256_GCM_HKDF_4KB)
            .build().openFileOutput().use { it.write(json.toByteArray()) }
        tmp.renameTo(stateFile)
    }

    inner class Native {
        @JavascriptInterface fun reply(id: Int, result: String) { replies.remove(id)?.let { cb -> main.post { cb(result) } } }

        @JavascriptInterface fun save(json: String) { io.execute { writeState(json) } }

        /** JEV and other engine HTTP. Only the configured JEV endpoint is reachable from here. */
        @JavascriptInterface fun fetch(id: Int, url: String, initJson: String) {
            io.execute {
                var ok = false; var status = 0; var body = ""
                try {
                    val u = URL(url)
                    require(u.protocol == "https" || u.host == "127.0.0.1") { "insecure URL" }
                    require(u.path.endsWith("/v1/systemone")) { "only the JEV endpoint is allowed" }
                    val init = JSONObject(initJson)
                    val c = u.openConnection() as HttpURLConnection
                    c.requestMethod = init.optString("method", "POST")
                    c.connectTimeout = 8000; c.readTimeout = 8000
                    val headers = init.optJSONObject("headers")
                    headers?.keys()?.forEach { k -> c.setRequestProperty(k, headers.getString(k)) }
                    c.doOutput = true
                    c.outputStream.use { it.write(init.optString("body").toByteArray()) }
                    status = c.responseCode
                    ok = status in 200..299
                    body = (if (ok) c.inputStream else c.errorStream)?.bufferedReader()?.readText() ?: ""
                } catch (e: Exception) { body = e.message ?: "error" }
                val js = "DDoCHost.fetchResult($id, $ok, $status, ${JSONObject.quote(body)})"
                main.post { web.evaluateJavascript(js, null) }
            }
        }
    }
}
