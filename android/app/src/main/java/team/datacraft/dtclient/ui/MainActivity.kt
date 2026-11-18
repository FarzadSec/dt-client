package team.datacraft.dtclient.ui

import android.Manifest
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Status
import team.datacraft.dtclient.vpn.DtVpnService
import team.datacraft.dtclient.vpn.VpnState

class MainActivity : ComponentActivity() {
    private var pendingLocation: Int? = null

    // Android asks the user once before any app may run a VPN.
    private val vpnPermission = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == RESULT_OK) DtVpnService.connect(this, pendingLocation)
        else VpnState.status.value = Status(error = "vpn_denied")
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { DtRoot(this) }
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // While the app is open the profile is fetched every 10 minutes, so panel changes show up.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                var first = true
                while (true) {
                    if (Repo.signedIn.value) {
                        Repo.refresh()
                        if (first) Repo.ping()
                        first = false
                    }
                    delay(Repo.REFRESH_MS)
                }
            }
        }
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
