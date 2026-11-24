package team.datacraft.dtclient.vpn

import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withTimeoutOrNull
import team.datacraft.dtclient.core.Core
import team.datacraft.dtclient.data.AppLog
import team.datacraft.dtclient.data.Profile

// The real delay of every config the phone can run, as the panel's outbound test measures it: a request
// to Google's empty page through Xray for the V2Ray protocols and WireGuard (Core.measureDelay, its own
// instance beside the connection's), and the server's answer to the first handshake message for OpenVPN.
object Ping {
    private fun resolve(name: String): List<String> = runCatching {
        val all = InetAddress.getAllByName(name).toList()
        val v4 = all.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
        val v6 = all.filterIsInstance<Inet6Address>().mapNotNull { it.hostAddress?.substringBefore('%') }
        v4.ifEmpty { v6 }.distinct()
    }.getOrDefault(emptyList())

    suspend fun all(profile: Profile): Map<String, Int?> = coroutineScope {
        val gate = Semaphore(4)
        val once = ConcurrentHashMap<String, Deferred<Int?>>()
        fun shared(key: String, probe: () -> Int?): Deferred<Int?> = once.getOrPut(key) { async(Dispatchers.IO) { probe() } }
        val results = profile.configs.filter { Candidates.runnable(it) }.map { config ->
            async(Dispatchers.IO) {
                val ms: Int? = if (config.protocol == "openvpn") {
                    val target = OpenVpnProfile.decode(config.link)?.let { OpenVpnProbe.target(it) }
                    if (target == null) null else shared("ovpn ${target.udp} ${target.host}:${target.port}") { OpenVpnProbe.handshakeMs(target) }.await()
                } else {
                    val outbound = XrayConfig.proxyOutboundFor(config.protocol, config.link, config.outbound)
                    if (outbound == null) {
                        null
                    } else {
                        gate.withPermit {
                            val hosts = XrayConfig.serverNames(outbound).associateWith { resolve(it) }.filterValues { it.isNotEmpty() }
                            val json = XrayConfig.delayTest(outbound, hosts)
                            withTimeoutOrNull(25_000) {
                                runCatching { Core.measureDelay(json, TEST_URL, 10_000L) }.getOrDefault(-1L)
                            }?.takeIf { it > 0 }?.toInt()
                        }
                    }
                }
                config.link to ms
            }
        }.awaitAll().toMap()
        AppLog.i("ping", "real delay: ${results.values.count { it != null }}/${results.size} config(s) answered")
        results
    }

    // The WireGuard locations a test reached: the panel frees the account's seat on them at once.
    fun wireguardLocations(profile: Profile, tested: Map<String, Int?>): Set<Int> =
        profile.configs.filter { it.protocol == "wireguard" && it.link in tested }.mapNotNull { it.locationId }.toSet()
}
