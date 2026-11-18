package team.datacraft.dtclient

import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import android.net.VpnService
import team.datacraft.dtclient.data.ConnState
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Status
import team.datacraft.dtclient.ui.MainActivity
import team.datacraft.dtclient.vpn.DtVpnService
import team.datacraft.dtclient.vpn.VpnState

// Every protocol the app runs through Xray, end to end on a real Android: sign in to the test panel
// (android/test/mock-panel.mjs), then connect to each location, whose one config points at CI's server
// for that protocol (android/test/protocol-servers.sh). Connected means a page came back through it.
@RunWith(AndroidJUnit4::class)
class ProtocolsTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext

    private fun shell(command: String): String {
        val pfd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }
    }

    private fun waitFor(ms: Long, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            if (done()) return true
            Thread.sleep(200)
        }
        return done()
    }

    @Test
    fun connectsThroughEveryXrayProtocolAndWireGuard() {
        val panel = InstrumentationRegistry.getArguments().getString("panel")
        assumeTrue("no test panel", !panel.isNullOrEmpty())
        shell("appops set ${context.packageName} ACTIVATE_VPN allow")
        assertNull("VPN consent", VpnService.prepare(context))
        runBlocking { Repo.login(panel!!, "demo-user") }
        val profile = Repo.profile.value!!
        Repo.updateSettings { it.copy(protocol = "auto", dns = "", splitApps = emptySet(), iranDirect = true, adBlock = false) }

        val failures = mutableListOf<String>()
        ActivityScenario.launch(MainActivity::class.java).use {
            for (protocol in listOf("vless", "vmess", "trojan", "shadowsocks", "wireguard")) {
                val config = profile.configs.first { it.protocol == protocol }
                VpnState.status.value = Status()
                DtVpnService.connect(context, config.locationId)
                val trail = mutableListOf<String>()
                waitFor(60_000) {
                    val s = VpnState.status.value
                    val step = "${s.state} ${s.protocol} ${s.error}".trim()
                    if (trail.lastOrNull() != step) trail += step
                    s.state == ConnState.Connected || (s.state == ConnState.Disconnected && s.error.isNotEmpty())
                }
                val status = VpnState.status.value
                if (status.state != ConnState.Connected || status.protocol != protocol) failures += "$protocol: $trail"
                DtVpnService.disconnect(context)
                assertTrue("$protocol: disconnect", waitFor(15_000) { VpnState.status.value.state == ConnState.Disconnected })
                Thread.sleep(1000)
            }
        }
        if (failures.isNotEmpty()) {
            val log = shell("logcat -d -v brief --pid=${android.os.Process.myPid()}").lines().filter { "Xray" in it || "DtVpn" in it || "GoLog" in it }.takeLast(60).joinToString(" | ")
            throw AssertionError("${failures.joinToString(" ; ")} | $log")
        }
        assertEquals(emptyList<String>(), failures)
    }
}
