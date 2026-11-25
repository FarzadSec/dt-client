package team.datacraft.dtclient.vpn

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.ParcelFileDescriptor
import android.system.OsConstants
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import java.io.FileInputStream
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlin.concurrent.thread
import team.datacraft.dtclient.R
import team.datacraft.dtclient.data.AppLog
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Settings
import team.datacraft.dtclient.ui.MainActivity

// The lock while the VPN is off: apps and sites the user locked must not be used from the real
// connection. It runs as the app's VPN with nothing behind it:
//  - sites locked: every app's DNS comes to it (only the lock's DNS address is routed), names of locked
//    sites (and, from Android 10, any name a locked app asks for) get an answer pointing nowhere, and
//    everything else is asked of the network's own resolvers;
//  - only apps locked: those apps alone go into it, and nothing of theirs gets out.
// A blocked attempt brings a notification: connect now, or skip the lock for 15 minutes.
class Guard(private val service: DtVpnService) {
    companion object {
        private const val TAG = "DtLock"
        private const val DNS_ADDRESS = "10.111.222.1"
        private const val CHANNEL = "lock"
        const val ACTION_SKIP = "team.datacraft.dtclient.LOCK_SKIP"

        // Whether the lock has anything to do with these settings.
        fun wanted(s: Settings): Boolean = s.lockEnabled && (s.lockApps.isNotEmpty() || s.lockSites.isNotEmpty())
    }

    private var tun: ParcelFileDescriptor? = null
    @Volatile private var running = false
    private val workers = Executors.newFixedThreadPool(4)
    private val lastHit = ConcurrentHashMap<String, Long>()
    @Volatile private var lastAnyApp = 0L
    private var upstream: Pair<Long, List<InetAddress>> = 0L to emptyList()

    val active: Boolean get() = running

    fun start(settings: Settings): Boolean {
        val restart = running
        stop()
        // Another app's VPN is up: the lock does not take its place. (The app's own tunnel, just closed,
        // takes a moment to go.)
        var tries = 0
        while (!restart && otherVpnUp() && tries++ < 10) Thread.sleep(200)
        if (!restart && otherVpnUp()) {
            AppLog.i(TAG, "another VPN is up; the lock waits")
            return false
        }
        val apps = settings.lockApps.filter { it != service.packageName }
        val sites = settings.lockSites
        val builder = service.Builder().setSession("DT Connect lock").setMtu(1500).addAddress("10.111.222.2", 32).addDnsServer(DNS_ADDRESS)
        if (sites.isNotEmpty()) {
            builder.addRoute(DNS_ADDRESS, 32)
            runCatching { builder.addDisallowedApplication(service.packageName) }
        } else {
            var any = false
            for (pkg in apps) if (runCatching { builder.addAllowedApplication(pkg) }.isSuccess) any = true
            if (!any) return false
            builder.addRoute("0.0.0.0", 0)
            runCatching { builder.addAddress("fd00:dc7:1::2", 128).addRoute("::", 0) }
        }
        if (Build.VERSION.SDK_INT >= 29) builder.setMetered(false)
        val open = PendingIntent.getActivity(service, 0, Intent(service, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        builder.setConfigureIntent(open)
        val fd = runCatching { builder.establish() }.getOrNull() ?: return false
        tun = fd
        running = true
        VpnState.guarding.value = true
        AppLog.i(TAG, "lock on: ${apps.size} app(s), ${sites.size} site(s)")
        thread(name = "lock", isDaemon = true) { loop(fd, settings, sites.isNotEmpty()) }
        return true
    }

    private fun otherVpnUp(): Boolean = runCatching {
        val cm = service.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        cm.allNetworks.any { cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true }
    }.getOrDefault(false)

    fun stop() {
        if (!running && tun == null) return
        running = false
        runCatching { tun?.close() }
        tun = null
        VpnState.guarding.value = false
        AppLog.i(TAG, "lock off")
    }

    private fun loop(fd: ParcelFileDescriptor, settings: Settings, dnsMode: Boolean) {
        val input = FileInputStream(fd.fileDescriptor)
        val output = FileOutputStream(fd.fileDescriptor)
        val buf = ByteArray(32767)
        val sites = settings.lockSites
        val apps = settings.lockApps
        while (running) {
            val n = try {
                input.read(buf)
            } catch (e: Exception) {
                break
            }
            if (n <= 0) {
                if (n < 0) break
                continue
            }
            val q = GuardPacket.parse(buf, n)
            if (!dnsMode) {
                // Only locked apps are in this tunnel: whatever arrives is one of them trying.
                q?.let { write(output, GuardPacket.blockedAnswer(it)) }
                val now = System.currentTimeMillis()
                if (now - lastAnyApp > 5000) {
                    lastAnyApp = now
                    val fa = Repo.settings.value.language == "fa"
                    hit(appName(ownerOf(buf, n)) ?: apps.singleOrNull()?.let { label(it) } ?: if (fa) "برنامه‌ای قفل‌شده" else "A locked app")
                }
                continue
            }
            if (q == null) continue
            val site = GuardPacket.locked(q.name, sites)
            val owner = if (apps.isNotEmpty()) ownerOf(buf, n) else null
            val lockedApp = owner?.let { uid -> service.packageManager.getPackagesForUid(uid)?.firstOrNull { it in apps } }
            when {
                site != null -> {
                    write(output, GuardPacket.blockedAnswer(q))
                    hit(site)
                }
                lockedApp != null -> {
                    write(output, GuardPacket.blockedAnswer(q))
                    hit(label(lockedApp))
                }
                else -> workers.execute { forward(q, output) }
            }
        }
    }

    private fun write(output: FileOutputStream, packet: ByteArray) {
        synchronized(output) { runCatching { output.write(packet) } }
    }

    // The network's own resolvers (not the VPN's), asked again every 20 s; public ones when it has none.
    private fun resolvers(): List<InetAddress> {
        val (at, list) = upstream
        if (System.currentTimeMillis() - at < 20_000 && list.isNotEmpty()) return list
        val found = mutableListOf<InetAddress>()
        runCatching {
            val cm = service.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            for (network in cm.allNetworks) {
                val caps = cm.getNetworkCapabilities(network) ?: continue
                if (caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) || !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) continue
                cm.getLinkProperties(network)?.dnsServers?.let { found += it }
            }
        }
        val out = found.distinct().sortedBy { if (it is java.net.Inet4Address) 0 else 1 }.ifEmpty { listOf(InetAddress.getByName("1.1.1.1"), InetAddress.getByName("8.8.8.8")) }
        upstream = System.currentTimeMillis() to out
        return out
    }

    private fun forward(q: GuardPacket.Query, output: FileOutputStream) {
        if (!running) return
        for (server in resolvers().take(2)) {
            val answer = runCatching {
                DatagramSocket().use { socket ->
                    service.protect(socket)
                    socket.soTimeout = 3500
                    socket.send(DatagramPacket(q.dns, q.dns.size, InetSocketAddress(server, 53)))
                    val reply = ByteArray(4096)
                    val packet = DatagramPacket(reply, reply.size)
                    socket.receive(packet)
                    reply.copyOf(packet.length)
                }
            }.getOrNull()
            if (answer != null && answer.size >= 12 && answer[0] == q.dns[0] && answer[1] == q.dns[1]) {
                if (running) write(output, GuardPacket.reply(q, answer))
                return
            }
        }
    }

    // The app behind a packet (Android 10 and later can ask the system).
    private fun ownerOf(packet: ByteArray, length: Int): Int? {
        if (Build.VERSION.SDK_INT < 29) return null
        return ownerOf29(packet, length)
    }

    @androidx.annotation.RequiresApi(29)
    private fun ownerOf29(packet: ByteArray, length: Int): Int? {
        if (length < 28 || (packet[0].toInt() ushr 4) != 4) return null
        val proto = packet[9].toInt() and 0xff
        if (proto != 6 && proto != 17) return null
        val ihl = (packet[0].toInt() and 0x0f) * 4
        val src = InetAddress.getByAddress(packet.copyOfRange(12, 16))
        val dst = InetAddress.getByAddress(packet.copyOfRange(16, 20))
        val sp = ((packet[ihl].toInt() and 0xff) shl 8) or (packet[ihl + 1].toInt() and 0xff)
        val dp = ((packet[ihl + 2].toInt() and 0xff) shl 8) or (packet[ihl + 3].toInt() and 0xff)
        return runCatching {
            val cm = service.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            cm.getConnectionOwnerUid(if (proto == 6) OsConstants.IPPROTO_TCP else OsConstants.IPPROTO_UDP, InetSocketAddress(src, sp), InetSocketAddress(dst, dp))
        }.getOrNull()?.takeIf { it >= 0 }
    }

    private fun appName(uid: Int?): String? {
        if (uid == null) return null
        val pkg = service.packageManager.getPackagesForUid(uid)?.firstOrNull { it in Repo.settings.value.lockApps } ?: return null
        return label(pkg)
    }

    private fun label(pkg: String): String = runCatching {
        val pm = service.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, PackageManager.GET_META_DATA)).toString()
    }.getOrDefault(pkg)

    // The same app or site at most once in 20 s: a notification with Connect now and Skip.
    @SuppressLint("MissingPermission")
    private fun hit(name: String) {
        val now = System.currentTimeMillis()
        if (now - (lastHit[name] ?: 0L) < 20_000) return
        lastHit[name] = now
        AppLog.i(TAG, "blocked $name while the VPN is off")
        VpnState.lockHit.value = name
        val manager = service.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        val fa = Repo.settings.value.language == "fa"
        if (Build.VERSION.SDK_INT >= 26 && manager.getNotificationChannel(CHANNEL) == null) {
            manager.createNotificationChannel(NotificationChannel(CHANNEL, if (fa) "قفل برنامه‌ها و سایت‌ها" else "App and site lock", NotificationManager.IMPORTANCE_HIGH))
        }
        val connect = PendingIntent.getActivity(
            service, 7001, Intent(service, MainActivity::class.java).putExtra(MainActivity.EXTRA_CONNECT, true).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val skip = PendingIntent.getBroadcast(service, 7002, Intent(service, LockSkipReceiver::class.java).setAction(ACTION_SKIP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val title = if (fa) "VPN شما خاموش است" else "Your VPN is off"
        val text = if (fa) "$name وقتی VPN خاموش است قفل است." else "$name is locked while the VPN is off."
        val notification = NotificationCompat.Builder(service, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_dt)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(connect)
            .addAction(0, if (fa) "همین حالا وصل شو" else "Connect now", connect)
            .addAction(0, if (fa) "رد شدن (۱۵ دقیقه)" else "Skip 15 min", skip)
            .setAutoCancel(true)
            .build()
        runCatching { NotificationManagerCompat.from(service).notify(7000, notification) }
    }
}

// Skip from the lock's notification: the lock is lifted for 15 minutes.
class LockSkipReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Guard.ACTION_SKIP) return
        NotificationManagerCompat.from(context).cancel(7000)
        DtVpnService.skipLock(context, 15)
    }
}
