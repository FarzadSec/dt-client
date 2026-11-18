package team.datacraft.dtclient.vpn

import android.util.Base64
import java.net.URI
import org.json.JSONObject
import team.datacraft.dtclient.data.Config
import team.datacraft.dtclient.data.Profile

// Android runs the Xray protocols (WireGuard included); OpenVPN and L2TP need system clients it cannot drive.
object Candidates {
    private val xrayProtocols = setOf("vless", "vmess", "trojan", "shadowsocks", "hysteria", "hysteria2", "wireguard")

    fun runnable(config: Config): Boolean = config.protocol in xrayProtocols && config.outbound != null

    fun usableLocationIds(profile: Profile): Set<Int> = profile.configs.filter { runnable(it) }.mapNotNull { it.locationId }.toSet()

    private fun matches(choice: String, config: Config): Boolean = when (choice) {
        "xray" -> config.protocol != "wireguard"
        "wireguard" -> config.protocol == "wireguard"
        else -> true
    }

    // The configs a connect to locationId tries, Xray protocols before WireGuard, quickest first.
    fun forLocation(profile: Profile, locationId: Int?, choice: String, pings: Map<String, Int?>): List<Config> =
        profile.configs
            .filter { runnable(it) && matches(choice, it) && (locationId == null || it.locationId == locationId) }
            .sortedWith(compareBy<Config>({ if (it.protocol == "wireguard") 1 else 0 }, { pings[it.link] ?: Int.MAX_VALUE }))

    fun bestPing(profile: Profile, pings: Map<String, Int?>, locationId: Int?): Int? =
        profile.configs.filter { runnable(it) && (locationId == null || it.locationId == locationId) }.mapNotNull { pings[it.link] }.minOrNull()

    fun answersOnUdp(config: Config): Boolean = config.protocol in setOf("wireguard", "hysteria", "hysteria2")

    fun serverAddress(config: Config): Pair<String, Int>? = runCatching {
        if (config.protocol == "vmess") {
            val json = JSONObject(String(Base64.decode(config.link.removePrefix("vmess://"), Base64.DEFAULT)))
            val host = json.optString("add")
            return if (host.isEmpty()) null else host to (json.optString("port").toIntOrNull() ?: 443)
        }
        val uri = URI(config.link)
        val host = (uri.host ?: return null).trim('[', ']')
        host to (if (uri.port > 0) uri.port else 443)
    }.getOrNull()
}
