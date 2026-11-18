package team.datacraft.dtclient.data

import android.annotation.SuppressLint
import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings.Secure
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.withContext
import team.datacraft.dtclient.BuildConfig
import team.datacraft.dtclient.vpn.Ping

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
        // A session the app was stopped in counts until the last time it was seen running.
        val since = prefs.getLong("openSince", 0L)
        val seen = prefs.getLong("openSeen", 0L)
        if (since > 0) closeSession(Session(since, maxOf(since, seen)))
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

    suspend fun login(subLink: String, username: String) = withContext(Dispatchers.IO) {
        val base = Api.base(subLink)
        val info = device()
        val token = Api.login(base, username.trim(), info, userAgent)
        val fetched = Api.profile(base, token, info.deviceId, userAgent)
        val now = System.currentTimeMillis()
        prefs.edit().putString("subLink", subLink.trim()).putString("username", username.trim()).putString("token", token).putString("profile", fetched.raw).putLong("fetchedAt", now).apply()
        profile.value = fetched
        fetchedAt.value = now
        signOutReason.value = ""
        signedIn.value = true
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
            profile.value = fetched
            fetchedAt.value = now
            null
        } catch (e: ApiException) {
            if (e.code in sessionEnding) signOut(e.code)
            e.code
        }
    }

    private fun signOut(reason: String) {
        prefs.edit().remove("token").remove("profile").apply()
        profile.value = null
        signedIn.value = false
        signOutReason.value = reason
    }

    suspend fun logout() = withContext(Dispatchers.IO) {
        val subLink = prefs.getString("subLink", null)
        val token = prefs.getString("token", null)
        if (subLink != null && token != null) runCatching { Api.logout(Api.base(subLink), token, deviceId(), userAgent) }
        signOut("")
    }

    fun lastSubLink(): String = prefs.getString("subLink", "") ?: ""
    fun lastUsername(): String = prefs.getString("username", "") ?: ""

    suspend fun ping() {
        val p = profile.value ?: return
        pinging.value = true
        try {
            pings.value = Ping.all(p)
        } finally {
            pinging.value = false
        }
    }
}
