package team.datacraft.dtclient.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.SignIn
import team.datacraft.dtclient.data.Status
import team.datacraft.dtclient.vpn.DtVpnService
import team.datacraft.dtclient.vpn.VpnState

class MainActivity : ComponentActivity() {
    companion object {
        // From the lock's notification: connect as soon as the app opens.
        const val EXTRA_CONNECT = "connect"
        // Bumped each time the app comes to the screen: the plan's warning is shown again then.
        val opened = kotlinx.coroutines.flow.MutableStateFlow(0)
    }

    private var pendingLocation: Int? = null
    private var permissionForLock = false

    // Android asks the user once before any app may run a VPN.
    private val vpnPermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val forLock = permissionForLock
        permissionForLock = false
        if (result.resultCode == RESULT_OK) {
            if (forLock) DtVpnService.lock(this) else DtVpnService.connect(this, pendingLocation)
        } else if (!forLock) {
            VpnState.status.value = Status(error = "vpn_denied")
        }
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        applySystemBars(Repo.settings.value.theme != "light")
        if (savedInstanceState == null) takeSignInLink(intent)
        setContent { DtRoot(this) }
        takeConnect(intent)
        // Notices arrive as notifications too; Android 13 asks for that once the user is signed in.
        lifecycleScope.launch {
            Repo.signedIn.first { it }
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
        // Opening the app fetches the subscription at once (and shows the plan's warning); while it stays
        // open it is fetched every 10 minutes by the clock. The ping runs again when it is 5 minutes old.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                opened.value = opened.value + 1
                if (Repo.signedIn.value) {
                    DtVpnService.lock(this@MainActivity)
                    Repo.refresh()
                    if (System.currentTimeMillis() - Repo.pingedAt > 5 * 60_000) launch { Repo.ping() }
                }
                var lastTry = System.currentTimeMillis()
                while (true) {
                    delay(30_000)
                    val now = System.currentTimeMillis()
                    if (!Repo.signedIn.value || now - Repo.fetchedAt.value < Repo.REFRESH_MS || now - lastTry < 2 * 60_000) continue
                    lastTry = now
                    Repo.refresh()
                    if (now - Repo.pingedAt > 5 * 60_000) launch { Repo.ping() }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        takeSignInLink(intent)
        takeConnect(intent)
    }

    private fun takeConnect(intent: Intent?) {
        if (intent?.getBooleanExtra(EXTRA_CONNECT, false) != true) return
        intent.removeExtra(EXTRA_CONNECT)
        VpnState.lockHit.value = null
        if (Repo.signedIn.value) connect(Repo.settings.value.locationId)
    }

    // The lock needs the VPN permission too; asked here when it is turned on.
    fun applyLock() {
        val ask = VpnService.prepare(this)
        if (ask != null) {
            if (!team.datacraft.dtclient.vpn.Guard.wanted(Repo.settings.value)) return
            permissionForLock = true
            vpnPermission.launch(ask)
        } else {
            DtVpnService.lock(this)
        }
    }

    // A tapped dtconnect://login?sub=…&user=… link (from the bot, the panel or a browser).
    private fun takeSignInLink(intent: Intent?) {
        val data = intent?.dataString ?: return
        SignIn.parse(data)?.let { Repo.pendingSignIn.value = it }
    }

    // Light status-bar icons on the dark theme, dark ones on the light theme; the pages draw behind the bars.
    fun applySystemBars(dark: Boolean) {
        val style = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
    }

    fun connect(locationId: Int?) {
        Repo.updateSettings { it.copy(locationId = locationId) }
        pendingLocation = locationId
        val ask = VpnService.prepare(this)
        if (ask != null) vpnPermission.launch(ask) else DtVpnService.connect(this, locationId)
    }

    fun disconnect() {
        DtVpnService.disconnect(this)
    }
}
