package team.datacraft.dtclient.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import team.datacraft.dtclient.data.LiveSample
import team.datacraft.dtclient.data.Status

object VpnState {
    val status = MutableStateFlow(Status())
    // The connection's last two minutes, a sample a second, for the live chart.
    val live = MutableStateFlow<List<LiveSample>>(emptyList())
    // The lock is holding locked apps and sites back while the VPN is off.
    val guarding = MutableStateFlow(false)
    // The app or site the lock just held back, for the dialog when the app is open.
    val lockHit = MutableStateFlow<String?>(null)
}
