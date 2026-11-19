package au.ddoc.browser

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

/** Bookmarks and history, encrypted at rest. Private tabs never write here. */
class BrowserStore(context: Context) {
    private val prefs = EncryptedSharedPreferences.create(
        context, "ddoc_browser",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private fun arr(key: String) = JSONArray(prefs.getString(key, "[]"))
    private fun put(key: String, a: JSONArray) = prefs.edit().putString(key, a.toString()).apply()

    fun bookmarks(): JSONArray = arr("bookmarks")
    fun history(): JSONArray = arr("history")

    fun toggleBookmark(title: String, url: String) {
        val a = bookmarks()
        for (i in 0 until a.length()) if (a.getJSONObject(i).optString("url") == url) { a.remove(i); put("bookmarks", a); return }
        val n = JSONArray().put(JSONObject().put("title", title).put("url", url))
        for (i in 0 until a.length()) n.put(a.get(i))
        put("bookmarks", n)
    }

    fun removeBookmark(url: String) {
        val a = bookmarks()
        for (i in a.length() - 1 downTo 0) if (a.getJSONObject(i).optString("url") == url) a.remove(i)
        put("bookmarks", a)
    }

    fun addHistory(title: String, url: String) {
        val a = history()
        val n = JSONArray().put(JSONObject().put("title", title).put("url", url).put("ts", System.currentTimeMillis()))
        for (i in 0 until minOf(a.length(), 4999)) n.put(a.get(i))
        put("history", n)
    }

    fun clearHistory() = put("history", JSONArray())
}
