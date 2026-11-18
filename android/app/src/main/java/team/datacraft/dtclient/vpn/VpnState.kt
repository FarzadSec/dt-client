package team.datacraft.dtclient.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import team.datacraft.dtclient.data.Status

object VpnState {
    val status = MutableStateFlow(Status())
}
