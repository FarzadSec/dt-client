package team.datacraft.dtclient.data

import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings.Secure
import java.net.URI
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import team.datacraft.dtclient.BuildConfig
import team.datacraft.dtclient.core.Core
import team.datacraft.dtclient.vpn.Candidates
import team.datacraft.dtclient.vpn.Ping
import team.datacraft.dtclient.vpn.VpnState

// What the app knows and shows: the session, the profile, the settings and the pings.
// The token stays in the app's private storage, which only this app can read.
object Repo {
    private lateinit var prefs: SharedPreferences
    private lateinit var app: Application

    val profile = MutableStateFlow<Profile?>(null)
    val settings = MutableStateFlow(Settings())
    val signedIn = MutableStateFlow(false)
    val signOutReason = MutableStateFlow("")
    val fetchedAt = MutableStateFlow(0L)
    val pings = MutableStateFlow<Map<String, Int?>>(emptyMap())
    val pinging = MutableStateFlow(false)
    // A sign-in code that arrived as a dtconnect:// link, waiting for the window to act on it.
    val pendingSignIn = MutableStateFlow<SignInCode?>(null)
    val sessions = MutableStateFlow<List<Session>>(emptyList())
    // Every subscription signed in on this phone; the one in use is also kept in the plain keys
    // (subLink, username, token, profile), which the rest of the app reads.
    val accounts = MutableStateFlow<List<AccountEntry>>(emptyList())
    private var openSince = 0L

    val userAgent: String get() = "DTConnect/${BuildConfig.VERSION_NAME} (android)"

    // Changes made on the panel reach the app within this time; the refresh button is for now.
    const val REFRESH_MS = 10 * 60_000L

    fun init(application: Application) {
        app = application
        prefs = application.getSharedPreferences("dt", Context.MODE_PRIVATE)
        settings.value = Settings.parse(prefs.getString("settings", null))
        val stored = prefs.getString("profile", null)
        profile.value = stored?.let { runCatching { Profile.parse(it) }.getOrNull() }
        signedIn.value = prefs.getString("token", null) != null && profile.value != null
        fetchedAt.value = prefs.getLong("fetchedAt", 0L)
        sessions.value = Secured.decode(prefs.getString("sessions", null))
        accounts.value = loadAccounts()
        // A session the app was stopped in counts until the last time it was seen running.
        val since = prefs.getLong("openSince", 0L)
        val seen = prefs.getLong("openSeen", 0L)
        if (since > 0) closeSession(Session(since, maxOf(since, seen)))
        AppLog.secret(prefs.getString("token", null), *(prefs.getString("subLink", null)?.let { AppLog.linkSecrets(it).toTypedArray() } ?: emptyArray()))
        if (signedIn.value) AppLog.i("app", "signed in as ${lastUsername()}: ${profile.value?.let { summary(it) }}")
    }

    fun summary(p: Profile): String {
        val counts = p.configs.groupingBy { it.protocol }.eachCount()
        return "${p.locations.size} location(s), ${p.configs.size} config(s): ${counts.entries.joinToString(", ") { "${it.key} ${it.value}" }.ifEmpty { "none" }}"
    }

    // Every connection state passes through here: a session starts on Connected and ends when that stops.
    fun track(status: Status) {
        val now = System.currentTimeMillis()
        if (status.state == ConnState.Connected) {
            if (openSince == 0L) {
                openSince = if (status.since in 1..now) status.since else now
                prefs.edit().putLong("openSince", openSince).putLong("openSeen", now).apply()
            }
            val id = status.serverId ?: status.locationId
            if (id != null && settings.value.recents.firstOrNull() != id) updateSettings { it.copy(recents = Secured.recents(it.recents, id)) }
        } else if (openSince != 0L) {
            val session = Session(openSince, now)
            openSince = 0L
            closeSession(session)
        }
    }

    fun heartbeat() {
        if (openSince != 0L) prefs.edit().putLong("openSeen", System.currentTimeMillis()).apply()
    }

    fun openSession(): Session? = if (openSince != 0L) Session(openSince, System.currentTimeMillis()) else null

    private fun closeSession(session: Session) {
        val next = Secured.add(sessions.value, session, System.currentTimeMillis())
        sessions.value = next
        prefs.edit().putString("sessions", Secured.encode(next)).remove("openSince").remove("openSeen").apply()
    }

    fun context(): Context = app

    fun updateSettings(change: (Settings) -> Settings) {
        val next = change(settings.value)
        settings.value = next
        prefs.edit().putString("settings", next.toJson()).apply()
    }

    // ANDROID_ID survives reinstalling the app, so the phone keeps its slot of the device limit.
    @SuppressLint("HardwareIds")
    fun deviceId(): String {
        val androidId = Secure.getString(app.contentResolver, Secure.ANDROID_ID)
        if (!androidId.isNullOrEmpty()) {
            val hash = MessageDigest.getInstance("SHA-256").digest("dt-client:${androidId.lowercase()}".toByteArray())
            return hash.joinToString("") { "%02x".format(it) }.take(32)
        }
        return prefs.getString("deviceFallback", null) ?: UUID.randomUUID().toString().replace("-", "").also {
            prefs.edit().putString("deviceFallback", it).apply()
        }
    }

    private fun device() = DeviceInfo(
        deviceId = deviceId(),
        deviceName = listOf(Build.MANUFACTURER, Build.MODEL).filter { it.isNotBlank() }.joinToString(" ").ifEmpty { "Android" },
        os = "android",
        osVersion = Build.VERSION.RELEASE ?: "",
        appVersion = BuildConfig.VERSION_NAME,
    )

    // Signs in with the subscription link alone: the panel's information page names its account. A
    // dtconnect:// link may carry the username, which then goes first. Another subscription is added
    // to the accounts and becomes the one in use.
    suspend fun login(subLink: String, username: String = ""): Unit = withContext(Dispatchers.IO) {
        val link = subLink.trim()
        AppLog.secret(*AppLog.linkSecrets(link).toTypedArray())
        val base = Api.base(link)
        val host = runCatching { URI(base).host }.getOrNull()
        val names = username.trim().takeIf { it.isNotEmpty() }?.let { listOf(it) } ?: run {
            AppLog.i("app", "reading the account of the subscription on $host")
            try {
                Api.subscriptionAccounts(link, userAgent)
            } catch (e: ApiException) {
                AppLog.w("app", "reading the account failed: ${e.code}")
                throw e
            }
        }
        val info = device()
        var last: ApiException? = null
        for (name in names.take(5)) {
            AppLog.i("app", "signing in as $name on $host")
            val token = try {
                Api.login(base, name, info, userAgent)
            } catch (e: ApiException) {
                AppLog.w("app", "sign-in failed: ${e.code}")
                last = e
                // Another name of the same subscription may be the one the panel knows.
                if (e.code == "bad_login") continue
                throw e
            }
            AppLog.secret(token)
            val fetched = Api.profile(base, token, info.deviceId, userAgent)
            AppLog.i("app", "signed in: ${summary(fetched)}")
            val now = System.currentTimeMillis()
            prefs.edit().putString("subLink", link).putString("username", name).putString("token", token).putString("profile", fetched.raw).putLong("fetchedAt", now).apply()
            saveActive()
            profile.value = fetched
            fetchedAt.value = now
            signOutReason.value = ""
            signedIn.value = true
            return@withContext
        }
        throw last ?: ApiException("bad_login")
    }

    // The accounts, from their own key; a phone signed in before 1.2 has its one account added.
    private fun loadAccounts(): List<AccountEntry> {
        val list = runCatching {
            val arr = JSONArray(prefs.getString("accounts", "[]"))
            (0 until arr.length()).mapNotNull { arr.optJSONObject(it)?.let(AccountEntry::fromJson) }
        }.getOrDefault(emptyList()).toMutableList()
        val link = prefs.getString("subLink", null)
        val name = prefs.getString("username", null)
        if (!link.isNullOrEmpty() && !name.isNullOrEmpty() && prefs.getString("token", null) != null) {
            val id = AccountEntry.idOf(link, name)
            if (list.none { it.id == id }) {
                list.add(0, AccountEntry(id, link, name, prefs.getString("token", null), prefs.getString("profile", null)))
                prefs.edit().putString("accounts", JSONArray(list.map { it.toJson() }).toString()).putString("activeId", id).apply()
            }
        }
        return list
    }

    private fun saveAccounts(list: List<AccountEntry>) {
        accounts.value = list
        prefs.edit().putString("accounts", JSONArray(list.map { it.toJson() }).toString()).apply()
    }

    fun activeId(): String = prefs.getString("activeId", "") ?: ""

    // The account in use, as the plain keys hold it now, written back to the list.
    private fun saveActive() {
        val link = prefs.getString("subLink", null) ?: return
        val name = prefs.getString("username", null) ?: return
        val id = AccountEntry.idOf(link, name)
        val entry = AccountEntry(id, link, name, prefs.getString("token", null), prefs.getString("profile", null))
        val list = accounts.value.toMutableList()
        val at = list.indexOfFirst { it.id == id }
        if (at >= 0) list[at] = entry else list += entry
        prefs.edit().putString("activeId", id).apply()
        saveAccounts(list)
    }

    // Switches to a signed-in account (the VPN is disconnected by the caller first); one whose session
    // ended signs in again with its link.
    suspend fun switchAccount(id: String): Unit = withContext(Dispatchers.IO) {
        val target = accounts.value.firstOrNull { it.id == id } ?: return@withContext
        if (target.token == null || target.profile == null) {
            login(target.subLink, target.username)
            return@withContext
        }
        prefs.edit().putString("subLink", target.subLink).putString("username", target.username).putString("token", target.token)
            .putString("profile", target.profile).putLong("fetchedAt", 0L).putString("activeId", id).apply()
        AppLog.secret(target.token, *AppLog.linkSecrets(target.subLink).toTypedArray())
        profile.value = runCatching { Profile.parse(target.profile) }.getOrNull()
        fetchedAt.value = 0L
        signOutReason.value = ""
        signedIn.value = profile.value != null
        pings.value = emptyMap()
        AppLog.i("app", "switched to the account ${target.username}")
        refresh()
        Unit
    }

    // Removes an account from this phone; the one in use signs out (and the next one takes its place).
    suspend fun removeAccount(id: String): Unit = withContext(Dispatchers.IO) {
        if (id == activeId()) {
            logout()
            return@withContext
        }
        val target = accounts.value.firstOrNull { it.id == id } ?: return@withContext
        target.token?.let { token -> runCatching { Api.logout(Api.base(target.subLink), token, deviceId(), userAgent) } }
        saveAccounts(accounts.value.filter { it.id != id })
    }

    private val sessionEnding = setOf("bad_session", "app_disabled", "not_found")

    // Null when the profile came from the panel; otherwise the error, with the last profile kept.
    suspend fun refresh(): String? = withContext(Dispatchers.IO) {
        val subLink = prefs.getString("subLink", null)
        val token = prefs.getString("token", null)
        if (subLink == null || token == null) return@withContext "bad_session"
        try {
            val fetched = Api.profile(Api.base(subLink), token, deviceId(), userAgent)
            val now = System.currentTimeMillis()
            prefs.edit().putString("profile", fetched.raw).putLong("fetchedAt", now).apply()
            saveActive()
            profile.value = fetched
            fetchedAt.value = now
            null
        } catch (e: ApiException) {
            AppLog.w("app", "profile refresh failed: ${e.code}")
            if (e.code in sessionEnding) signOut(e.code)
            e.code
        }
    }

    // What support needs to read a log: the app, the phone, the settings, the account's configs and the state.
    private fun reportHeader(): String {
        val s = settings.value
        val p = profile.value
        val st = VpnState.status.value
        val lines = mutableListOf(
            "DT Connect ${BuildConfig.VERSION_NAME} · Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}) · ${Build.MANUFACTURER} ${Build.MODEL} · ${Build.SUPPORTED_ABIS.joinToString(",")}",
            "Engines: Xray ${runCatching { Core.version() }.getOrDefault("?")}",
            "Account: ${p?.account?.username ?: lastUsername()} · panel ${runCatching { URI(lastSubLink()).host }.getOrNull() ?: "-"}",
            "Status: ${st.state} ${st.protocol} ${if (st.configName.isNotEmpty()) "\"${st.configName}\"" else ""} ${if (st.error.isNotEmpty()) "error ${st.error}" else ""}".trim(),
            "Settings: protocol ${s.protocol}, Iran direct ${s.iranDirect}, ad block ${s.adBlock}, DNS ${s.dns.ifEmpty { "default" }}, apps outside ${s.splitApps.size}, language ${s.language}",
            "Profile: ${p?.let { summary(it) } ?: "-"}${if (fetchedAt.value > 0) " · fetched ${java.util.Date(fetchedAt.value)}" else ""}",
        )
        for (c in p?.configs ?: emptyList()) {
            val target = Candidates.serverAddress(c)
            lines += "  ${c.protocol.padEnd(11)} location ${(c.locationId?.toString() ?: "-").padEnd(4)} ${target?.let { "${it.first}:${it.second}" } ?: "?"} \"${c.name}\"${if (Candidates.runnable(c)) "" else " (not run on Android)"}"
        }
        return lines.joinToString("\n")
    }

    private fun fileTail(name: String, maxChars: Int): String = runCatching {
        val f = java.io.File(app.filesDir, "logs/$name")
        if (f.exists()) AppLog.tail(f.readText(), maxChars) else ""
    }.getOrDefault("")

    // The app's own process log (logcat), for what went past AppLog, such as a native library's messages.
    private fun logcat(): String = runCatching {
        val proc = ProcessBuilder("logcat", "-d", "-v", "time", "-t", "800", "--pid=${android.os.Process.myPid()}").redirectErrorStream(true).start()
        val text = proc.inputStream.bufferedReader().use { it.readText() }
        proc.waitFor()
        text
    }.getOrDefault("")

    fun logText(): String {
        val parts = mutableListOf(reportHeader(), "", "=== app ===", AppLog.text())
        fileTail("xray.log", 200_000).takeIf { it.isNotBlank() }?.let { parts += listOf("=== xray (current connection) ===", it) }
        fileTail("tunnel.log", 100_000).takeIf { it.isNotBlank() }?.let { parts += listOf("=== tunnel ===", it) }
        logcat().takeIf { it.isNotBlank() }?.let { parts += listOf("=== logcat ===", AppLog.tail(it, 200_000)) }
        AppLog.previousRun().takeIf { it.isNotBlank() }?.let { parts += listOf("=== previous run (end) ===", it) }
        val token = prefs.getString("token", null)
        return AppLog.redact(parts.joinToString("\n"), listOfNotNull(token) + AppLog.linkSecrets(lastSubLink()).filter { it.isNotEmpty() })
    }

    // Null on success with the report's number in reportId; otherwise the error code.
    suspend fun sendReport(message: String): Pair<String?, String?> = withContext(Dispatchers.IO) {
        val subLink = prefs.getString("subLink", null)
        val token = prefs.getString("token", null)
        if (subLink == null || token == null) return@withContext null to "bad_session"
        AppLog.i("app", "sending a support report")
        val info = device()
        val body = JSONObject()
            .put("message", message.take(4000))
            .put("log", AppLog.tail(logText(), 2_000_000))
            .put("deviceId", info.deviceId)
            .put("deviceName", info.deviceName)
            .put("os", info.os)
            .put("osVersion", info.osVersion)
            .put("appVersion", info.appVersion)
        try {
            val id = Api.report(Api.base(subLink), token, info.deviceId, userAgent, body)
            AppLog.i("app", "support report sent${id?.let { " (number $it)" } ?: ""}")
            id to null
        } catch (e: ApiException) {
            AppLog.w("app", "support report failed: ${e.code}")
            null to e.code
        }
    }

    // The session of the account in use ended: it stays listed, to sign in again with one tap.
    private fun signOut(reason: String) {
        val id = activeId()
        prefs.edit().remove("token").remove("profile").remove("activeId").apply()
        saveAccounts(accounts.value.map { if (it.id == id) it.copy(token = null, profile = null) else it })
        profile.value = null
        signedIn.value = false
        signOutReason.value = reason
    }

    // Signs out of the account in use and removes it; another signed-in account takes its place.
    suspend fun logout(): Unit = withContext(Dispatchers.IO) {
        val subLink = prefs.getString("subLink", null)
        val token = prefs.getString("token", null)
        if (subLink != null && token != null) runCatching { Api.logout(Api.base(subLink), token, deviceId(), userAgent) }
        val id = activeId()
        saveAccounts(accounts.value.filter { it.id != id })
        signOut("")
        val next = accounts.value.firstOrNull { it.token != null && it.profile != null }
        if (next != null) switchAccount(next.id)
    }

    // Tells the panel this device left a connection (Api.disconnected); best effort, on the caller's thread.
    fun tellPanelLeft(protocol: String, locationId: Int?, address: String?) {
        val subLink = prefs.getString("subLink", null) ?: return
        val token = prefs.getString("token", null) ?: return
        runCatching { Api.disconnected(Api.base(subLink), token, deviceId(), userAgent, protocol, locationId, address) }
            .onFailure { AppLog.w("DtRepo", "telling the panel this device left failed: $it") }
    }

    fun lastSubLink(): String = prefs.getString("subLink", "") ?: ""
    fun lastUsername(): String = prefs.getString("username", "") ?: ""

    // The real delay of every config; WireGuard's test is a handshake, which the panel counts as a seat
    // until the device says it left, so the locations it touched are freed (not the one in use).
    suspend fun ping() {
        val p = profile.value ?: return
        if (pinging.value) return
        pinging.value = true
        try {
            val results = Ping.all(p)
            pings.value = results
            pingedAt = System.currentTimeMillis()
            val status = VpnState.status.value
            val using = if (status.state == team.datacraft.dtclient.data.ConnState.Connected && status.protocol == "wireguard") status.serverId else null
            withContext(Dispatchers.IO) {
                for (id in Ping.wireguardLocations(p, results)) if (id != using) tellPanelLeft("wireguard", id, null)
            }
        } finally {
            pinging.value = false
        }
    }

    @Volatile var pingedAt = 0L
}
