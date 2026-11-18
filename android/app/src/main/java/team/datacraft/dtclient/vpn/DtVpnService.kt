package team.datacraft.dtclient.vpn

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.io.File
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.URL
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import team.datacraft.dtclient.R
import team.datacraft.dtclient.core.Core
import team.datacraft.dtclient.data.Config
import team.datacraft.dtclient.data.ConnState
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Settings
import team.datacraft.dtclient.data.Status
import team.datacraft.dtclient.ui.MainActivity

// Xray runs the panel's outbound behind a local SOCKS port; hev-socks5-tunnel carries the VPN
// interface's packets to it. OpenVPN runs as its own process and is handed the VPN interface (OpenVpn.kt).
// The app itself is left out of the VPN, so the engines' own connections leave directly.
class DtVpnService : VpnService() {
    companion object {
        const val ACTION_CONNECT = "team.datacraft.dtclient.CONNECT"
        const val ACTION_DISCONNECT = "team.datacraft.dtclient.DISCONNECT"
        private const val EXTRA_LOCATION = "location"
        private const val FASTEST = -1
        private const val MTU = 8500
        private const val NOTICE_CHANNEL = "notices"
        private const val OPENVPN_TIMEOUT_MS = 35_000L

        fun connect(context: Context, locationId: Int?) {
            context.startService(Intent(context, DtVpnService::class.java).setAction(ACTION_CONNECT).putExtra(EXTRA_LOCATION, locationId ?: FASTEST))
        }

        fun disconnect(context: Context) {
            context.startService(Intent(context, DtVpnService::class.java).setAction(ACTION_DISCONNECT))
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tun: ParcelFileDescriptor? = null
    @Volatile private var openvpn: OpenVpn? = null
    private var work: Job? = null
    private var refresher: Job? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_DISCONNECT) {
            work?.cancel()
            work = scope.launch {
                set(Status(ConnState.Disconnecting, VpnState.status.value.locationId))
                stopEngines()
                set(Status(ConnState.Disconnected, VpnState.status.value.locationId))
                stopSelf()
            }
            return START_NOT_STICKY
        }
        // ACTION_CONNECT from the app, or the system starting an always-on VPN.
        val requested = intent?.takeIf { it.hasExtra(EXTRA_LOCATION) }?.getIntExtra(EXTRA_LOCATION, FASTEST)
        val locationId = when (requested) {
            null -> Repo.settings.value.locationId
            FASTEST -> null
            else -> requested
        }
        work?.cancel()
        work = scope.launch { connect(locationId) }
        return START_STICKY
    }

    override fun onRevoke() {
        scope.launch {
            stopEngines()
            set(Status(ConnState.Disconnected, error = "connection_lost"))
            stopSelf()
        }
    }

    override fun onDestroy() {
        refresher?.cancel()
        openvpn?.let { runCatching { it.stop() } }
        openvpn = null
        runCatching { if (TProxyService.TProxyIsRunning()) TProxyService.TProxyStopService() }
        runCatching { tun?.close() }
        runCatching { Core.stop() }
        if (VpnState.status.value.state != ConnState.Disconnected) set(Status(ConnState.Disconnected))
        scope.cancel()
        super.onDestroy()
    }

    private fun set(status: Status) {
        VpnState.status.value = status
    }

    private fun stopEngines() {
        refresher?.cancel()
        openvpn?.let { runCatching { it.stop() } }
        openvpn = null
        runCatching { if (TProxyService.TProxyIsRunning()) TProxyService.TProxyStopService() }
        runCatching { tun?.close() }
        tun = null
        runCatching { Core.stop() }
    }

    // geoip.dat and geosite.dat ship in the APK and are copied once per version.
    private fun assetDir(): String {
        val dir = File(filesDir, "xray").apply { mkdirs() }
        val marker = File(dir, "version")
        val version = packageManager.getPackageInfo(packageName, 0).lastUpdateTime.toString()
        if (marker.takeIf { it.exists() }?.readText() != version) {
            for (name in listOf("geoip.dat", "geosite.dat")) {
                assets.open(name).use { input -> File(dir, name).outputStream().use { input.copyTo(it) } }
            }
            marker.writeText(version)
        }
        return dir.absolutePath
    }

    private fun freePort(): Int = ServerSocket(0).use { it.localPort }

    // The config works only if an empty page comes back through it.
    private fun probe(port: Int): Boolean = runCatching {
        val conn = URL("https://www.gstatic.com/generate_204").openConnection(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", port))) as HttpURLConnection
        conn.connectTimeout = 10_000
        conn.readTimeout = 10_000
        try {
            conn.responseCode == 204
        } finally {
            conn.disconnect()
        }
    }.getOrDefault(false)

    private suspend fun connect(locationId: Int?) {
        stopEngines()
        val profile = Repo.profile.value
        val settings = Repo.settings.value
        if (profile == null) {
            set(Status(ConnState.Disconnected, locationId, error = "no_config"))
            return
        }
        val list = Candidates.forLocation(profile, locationId, settings.protocol, Repo.pings.value)
        if (list.isEmpty()) {
            set(Status(ConnState.Disconnected, locationId, error = "no_config"))
            return
        }
        set(Status(ConnState.Connecting, locationId))
        val dns = XrayConfig.dnsServers(settings.dns)
        Core.setAssetDir(assetDir())
        for (config in list) {
            if (!scope.isActive) return
            set(Status(ConnState.Connecting, locationId, config.locationId, config.name, config.protocol))
            val attempt = if (config.protocol == "openvpn") startOpenVpn(config, settings) else startXray(config, settings, dns)
            when (attempt) {
                Attempt.Failed -> continue
                Attempt.Denied -> {
                    set(Status(ConnState.Disconnected, locationId, error = "vpn_denied"))
                    return
                }
                Attempt.Started -> {
                    Repo.updateSettings { it.copy(locationId = locationId) }
                    set(Status(ConnState.Connected, locationId, config.locationId, config.name, config.protocol, System.currentTimeMillis()))
                    startRefresher()
                    return
                }
            }
        }
        set(Status(ConnState.Disconnected, locationId, error = "all_failed"))
    }

    private enum class Attempt { Started, Failed, Denied }

    private fun startXray(config: Config, settings: Settings, dns: List<String>): Attempt {
        val outbound = config.outbound ?: return Attempt.Failed
        val port = freePort()
        val json = XrayConfig.build(outbound, port, settings.iranDirect, settings.adBlock, dns)
        if (runCatching { Core.start(json) }.isFailure) return Attempt.Failed
        if (!probe(port)) {
            runCatching { Core.stop() }
            return Attempt.Failed
        }
        val fd = establish(dns.first(), settings.splitApps)
        if (fd == null) {
            runCatching { Core.stop() }
            return Attempt.Denied
        }
        tun = fd
        val hevConfig = File(filesDir, "tunnel.yml")
        hevConfig.writeText(
            """
            tunnel:
              mtu: $MTU
              ipv4: 172.19.0.1
              ipv6: 'fdfe:dcba:9876::1'
            socks5:
              port: $port
              address: 127.0.0.1
              udp: 'udp'
            misc:
              task-stack-size: 81920
            """.trimIndent(),
        )
        if (!TProxyService.TProxyStartService(hevConfig.absolutePath, fd.fd)) {
            stopEngines()
            return Attempt.Failed
        }
        return Attempt.Started
    }

    // OpenVPN brings the tunnel up itself and asks for the VPN interface on the way (openTun).
    private suspend fun startOpenVpn(config: Config, settings: Settings): Attempt {
        val profile = OpenVpnProfile.decode(config.link) ?: return Attempt.Failed
        if (OpenVpnProfile.unsafeDirective(profile) != null) return Attempt.Failed
        val session = OpenVpn(this, object : OpenVpn.Host {
            override fun protect(fd: Int): Boolean = this@DtVpnService.protect(fd)
            override fun openTun(spec: OpenVpn.TunSpec): ParcelFileDescriptor? = establishOpenVpn(spec, settings)
        })
        // Once up, OpenVPN reconnects by itself; the status follows, and only its exit ends the connection.
        session.onReconnecting = { VpnState.status.value.takeIf { it.state == ConnState.Connected }?.let { set(it.copy(state = ConnState.Connecting)) } }
        session.onReconnected = { VpnState.status.value.takeIf { it.state == ConnState.Connecting }?.let { set(it.copy(state = ConnState.Connected)) } }
        session.onLost = {
            scope.launch {
                if (openvpn === session) {
                    val locationId = VpnState.status.value.locationId
                    stopEngines()
                    set(Status(ConnState.Disconnected, locationId, error = "connection_lost"))
                    stopSelf()
                }
            }
        }
        openvpn = session
        return when (session.start(profile, OPENVPN_TIMEOUT_MS)) {
            OpenVpn.Outcome.Connected -> Attempt.Started
            OpenVpn.Outcome.VpnDenied -> {
                openvpn = null
                Attempt.Denied
            }
            else -> {
                openvpn = null
                Attempt.Failed
            }
        }
    }

    private fun establishOpenVpn(spec: OpenVpn.TunSpec, settings: Settings): ParcelFileDescriptor? {
        val builder = Builder().setSession("DT Client").setMtu(spec.mtu)
        spec.address?.let { builder.addAddress(it.address, it.prefix) }
        spec.address6?.let { builder.addAddress(it.address, it.prefix) }
        for (route in spec.routes + spec.routes6) runCatching { builder.addRoute(route.address, route.prefix) }
        // With every route in the tunnel and no IPv6 in it, Android blocks IPv6 rather than let it leave
        // around the tunnel; an IPv6 DNS server would let it through, so it is left out then.
        val everything = spec.routes.any { it.prefix <= 1 }
        val dns = if (settings.dns.isNotBlank()) XrayConfig.dnsServers(settings.dns) else spec.dns.ifEmpty { XrayConfig.defaultDns }
        for (server in dns) {
            if (everything && spec.address6 == null && server.contains(':')) continue
            runCatching { builder.addDnsServer(server) }
        }
        spec.domain?.let { runCatching { builder.addSearchDomain(it) } }
        if (!everything && spec.address6 == null) runCatching { builder.allowFamily(OsConstants.AF_INET6) }
        runCatching { builder.addDisallowedApplication(packageName) }
        for (app in settings.splitApps) runCatching { builder.addDisallowedApplication(app) }
        if (Build.VERSION.SDK_INT >= 29) builder.setMetered(false)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        builder.setConfigureIntent(open)
        return runCatching { builder.establish() }.getOrNull()
    }

    private fun establish(dns: String, splitApps: Set<String>): ParcelFileDescriptor? {
        val builder = Builder()
            .setSession("DT Client")
            .setMtu(MTU)
            .addAddress("172.19.0.1", 30)
            .addRoute("0.0.0.0", 0)
            .addDnsServer(dns)
        // IPv6 goes into the tunnel too, so nothing leaves around it.
        runCatching { builder.addAddress("fdfe:dcba:9876::1", 126).addRoute("::", 0) }
        runCatching { builder.addDisallowedApplication(packageName) }
        for (app in splitApps) runCatching { builder.addDisallowedApplication(app) }
        if (Build.VERSION.SDK_INT >= 29) builder.setMetered(false)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        builder.setConfigureIntent(open)
        return runCatching { builder.establish() }.getOrNull()
    }

    // While connected the profile is fetched every 10 minutes; a new warning or critical notice is a notification too.
    private fun startRefresher() {
        refresher?.cancel()
        refresher = scope.launch {
            while (isActive) {
                delay(Repo.REFRESH_MS)
                val known = Repo.profile.value?.notices?.maxOfOrNull { it.id } ?: 0
                if (Repo.refresh() == null) {
                    Repo.profile.value?.notices?.filter { it.id > known && it.level != "info" }?.forEach { notify(it.id, it.level, it.body) }
                }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun notify(id: Int, level: String, body: String) {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(NOTICE_CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(NOTICE_CHANNEL, "Notices", NotificationManager.IMPORTANCE_HIGH))
        }
        val fa = Repo.settings.value.language == "fa"
        val title = if (level == "critical") (if (fa) "اطلاعیه مهم" else "Important notice") else (if (fa) "اطلاعیه" else "Notice")
        val open = PendingIntent.getActivity(this, id, Intent(this, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, NOTICE_CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_dt)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(this).notify(1000 + id, notification) }
    }
}
