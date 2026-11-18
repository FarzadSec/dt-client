package team.datacraft.dtclient

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.URL
import kotlin.concurrent.thread
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import team.datacraft.dtclient.core.Core
import team.datacraft.dtclient.vpn.TProxyService
import team.datacraft.dtclient.vpn.XrayConfig

// On a real device: the native libraries the build packs must load and work, which compiling cannot show.
@RunWith(AndroidJUnit4::class)
class EnginesTest {
    @Test
    fun tunnelLibraryLoadsAndRegistersItsNatives() {
        // JNI_OnLoad registers the natives on team/datacraft/dtclient/vpn/TProxyService; a wrong PKGNAME throws here.
        assertFalse(TProxyService.TProxyIsRunning())
    }

    @Test
    fun xrayRunsTheConfigTheAppWritesAndServesItsSocksPort() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val dir = File(context.filesDir, "xray-test").apply { mkdirs() }
        for (name in listOf("geoip.dat", "geosite.dat")) {
            context.assets.open(name).use { input -> File(dir, name).outputStream().use { input.copyTo(it) } }
        }
        Core.setAssetDir(dir.absolutePath)

        val target = ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"))
        thread {
            target.accept().use { it.getOutputStream().write("HTTP/1.0 204 No Content\r\n\r\n".toByteArray()) }
        }
        val socksPort = ServerSocket(0).use { it.localPort }
        // Ad blocking and Iranian sites direct need geosite and geoip categories: the geo files must load.
        val config = XrayConfig.build(JSONObject().put("protocol", "freedom"), socksPort, iranDirect = true, adBlock = true, dns = listOf("1.1.1.1"))
        Core.start(config)
        try {
            val conn = URL("http://127.0.0.1:${target.localPort}/").openConnection(Proxy(Proxy.Type.SOCKS, InetSocketAddress("127.0.0.1", socksPort))) as HttpURLConnection
            conn.connectTimeout = 5000
            conn.readTimeout = 5000
            assertEquals(204, conn.responseCode)
        } finally {
            Core.stop()
            target.close()
        }
    }
}
