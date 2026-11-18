package team.datacraft.dtclient

import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import team.datacraft.dtclient.data.ConnState
import team.datacraft.dtclient.data.Profile
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Status
import team.datacraft.dtclient.ui.MainActivity
import team.datacraft.dtclient.vpn.DtVpnService
import team.datacraft.dtclient.vpn.OpenVpn
import team.datacraft.dtclient.vpn.OpenVpnProfile
import team.datacraft.dtclient.vpn.VpnState

// OpenVPN on a real Android: the program the build packs must run, and the app must connect through
// CI's OpenVPN servers (android/openvpn/test-server.sh) with the profiles Manifold writes.
@RunWith(AndroidJUnit4::class)
class OpenVpnTest {
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
    fun theOpenVpnProgramRunsWithItsCompressionLibraries() {
        val exe = OpenVpn.binary(context)
        assertTrue("$exe is missing", exe.exists())
        val proc = ProcessBuilder(exe.absolutePath, "--version").redirectErrorStream(true).start()
        val out = proc.inputStream.bufferedReader().use { it.readText() }
        proc.waitFor()
        assertTrue(out, out.contains("OpenVPN 2.7") && out.contains("[LZO]") && out.contains("[LZ4]") && out.contains("OpenSSL 3"))
    }

    @Test
    fun theProfileIsReadCheckedAndPrepared() {
        val profile = "# test\nclient\ndev tun\nproto udp\nremote 10.0.2.2 1195\n<auth-user-pass>\nz7b21tfbhc\npa ss\"w\\rd\n</auth-user-pass>\n<ca>\nCA\n</ca>\n"
        val link = "openvpn://" + Base64.encodeToString(profile.toByteArray(), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
        val decoded = OpenVpnProfile.decode(link)!!
        assertNull(OpenVpnProfile.unsafeDirective(decoded))
        assertEquals("up", OpenVpnProfile.unsafeDirective(decoded + "up /system/bin/sh\n"))
        assertEquals("ca", OpenVpnProfile.unsafeDirective(decoded + "ca /sdcard/ca.pem\n"))
        assertEquals("management", OpenVpnProfile.unsafeDirective(decoded + "management 0.0.0.0 7505\n"))
        assertNull(OpenVpnProfile.decode("openvpn://" + Base64.encodeToString("hello".toByteArray(), Base64.URL_SAFE or Base64.NO_WRAP)))

        val prepared = OpenVpnProfile.prepare(decoded, "/data/x/mgmt")
        assertEquals("z7b21tfbhc", prepared.username)
        assertEquals("pa ss\"w\\rd", prepared.password)
        assertFalse(prepared.config.contains("pa ss"))
        assertTrue(prepared.config.contains("\nauth-user-pass\n<ca>"))
        assertTrue(prepared.config.endsWith("management /data/x/mgmt unix\nmanagement-hold\nmanagement-query-passwords\n"))

        assertEquals("10.0.2.2" to 1195, OpenVpnProfile.remote(decoded))
        assertTrue(OpenVpnProfile.udp(decoded))
        assertFalse(OpenVpnProfile.udp(decoded.replace("proto udp", "proto tcp-client")))
        assertEquals(24, OpenVpn.prefixOf("255.255.255.0"))
        assertEquals(1, OpenVpn.prefixOf("128.0.0.0"))
        assertEquals(OpenVpn.Route("10.8.0.0", 24), OpenVpn.network("10.8.0.2", 24))
        assertEquals(OpenVpn.Route("128.0.0.0", 1), OpenVpn.network("128.0.0.0", 1))
    }

    @Test
    fun connectsThroughOpenVpnOverTcp() = connectThrough("ovpnTcp", "10.8.0.1")

    @Test
    fun connectsThroughOpenVpnOverUdp() = connectThrough("ovpnUdp", "10.9.0.1")

    private fun connectThrough(argument: String, gateway: String) {
        val link = InstrumentationRegistry.getArguments().getString(argument)
        assumeTrue("no test server for $argument", !link.isNullOrEmpty())
        val decoded = OpenVpnProfile.decode(link!!)
        assertTrue("the link (${link.length} characters) is not an OpenVPN profile", decoded != null)
        assertNull("unsafe directive", OpenVpnProfile.unsafeDirective(decoded!!))
        // What the user's "Allow" in Android's VPN dialog grants.
        shell("appops set ${context.packageName} ACTIVATE_VPN allow")
        assertNull("VPN consent", VpnService.prepare(context))

        val profile = JSONObject()
            .put("account", JSONObject().put("username", "z7b21tfbhc").put("enabled", true))
            .put("locations", JSONArray().put(JSONObject().put("id", 1).put("name", "Test").put("countryCode", "DE")))
            .put("configs", JSONArray().put(JSONObject().put("protocol", "openvpn").put("name", "test $argument").put("link", link).put("locationId", 1)))
        Repo.profile.value = Profile.parse(profile.toString())
        Repo.settings.value = Repo.settings.value.copy(protocol = "openvpn", dns = "", splitApps = emptySet())

        VpnState.status.value = Status()
        ActivityScenario.launch(MainActivity::class.java).use {
            DtVpnService.connect(context, 1)
            // Every state the connection passes through, for the failure message.
            val trail = mutableListOf<String>()
            waitFor(60_000) {
                val s = VpnState.status.value
                val step = "${s.state} ${s.protocol} ${s.configName} ${s.error}".trim()
                if (trail.lastOrNull() != step) trail += step
                s.state == ConnState.Connected || (s.state == ConnState.Disconnected && s.error.isNotEmpty())
            }
            val status = VpnState.status.value
            // On failure the app's own log (OpenVPN's output included) says why.
            val log = if (status.state == ConnState.Connected) "" else shell("logcat -d -v brief --pid=${android.os.Process.myPid()}").lines().filter { it.isNotBlank() }.takeLast(60).joinToString("\n")
            assertEquals("states: $trail\n$log", ConnState.Connected, status.state)
            assertEquals("openvpn", status.protocol)

            // The shell is not left out of the VPN as the app is: its ping goes through the tunnel to the server.
            val ping = shell("ping -c 3 -W 3 $gateway")
            assertTrue(ping, ping.contains("bytes from $gateway"))

            DtVpnService.disconnect(context)
            assertTrue("disconnect", waitFor(15_000) { VpnState.status.value.state == ConnState.Disconnected })
            assertFalse("the tunnel is gone", shell("ping -c 1 -W 2 $gateway").contains("bytes from $gateway"))
        }
    }
}
