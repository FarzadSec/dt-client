package team.datacraft.dtclient

import android.app.Application
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import team.datacraft.dtclient.data.ConnState
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.vpn.VpnState

class DtApp : Application() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    override fun onCreate() {
        super.onCreate()
        Repo.init(this)
        // Time connected and recent locations follow the connection, whichever screen is open.
        scope.launch { VpnState.status.collect { Repo.track(it) } }
        scope.launch {
            while (true) {
                delay(60_000)
                if (VpnState.status.value.state == ConnState.Connected) Repo.heartbeat()
            }
        }
    }
}
