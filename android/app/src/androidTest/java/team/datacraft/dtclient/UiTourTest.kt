package team.datacraft.dtclient

import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.ParcelFileDescriptor
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import team.datacraft.dtclient.data.ConnState
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.SignIn
import team.datacraft.dtclient.data.SignInCode
import team.datacraft.dtclient.data.Settings
import team.datacraft.dtclient.ui.Geo
import team.datacraft.dtclient.ui.MainActivity
import team.datacraft.dtclient.ui.Strings
import team.datacraft.dtclient.vpn.DtVpnService
import team.datacraft.dtclient.vpn.VpnState

// The app as a customer meets it, driven through its screens: the welcome page, the sign-in form,
// signing in by opening the dtconnect:// link the bot's QR code holds, every tab, the location list,
// connecting and the English and light versions. Each screen goes to /data/local/tmp/screens for CI.
@RunWith(AndroidJUnit4::class)
class UiTourTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val device = UiDevice.getInstance(instrumentation)
    private val fa = Strings("fa")

    private fun shell(command: String): String {
        val pfd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(pfd).bufferedReader().use { it.readText() }
    }

    private fun shot(name: String) {
        device.waitForIdle()
        Thread.sleep(1200)
        shell("screencap -p /data/local/tmp/screens/$name.png")
    }

    private fun waitFor(ms: Long, done: () -> Boolean): Boolean {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            if (done()) return true
            Thread.sleep(200)
        }
        return done()
    }

    private fun tap(desc: String) {
        val node = device.wait(Until.findObject(By.desc(desc)), 5000)
        assertNotNull("no \"$desc\" on screen", node)
        node.click()
    }

    @Test
    fun aCustomerSignsInWithTheQrLinkAndConnects() {
        val panel = InstrumentationRegistry.getArguments().getString("panel")
        assumeTrue("no test panel", !panel.isNullOrEmpty())
        shell("mkdir -p /data/local/tmp/screens")
        runBlocking { Repo.logout() }
        Repo.updateSettings { Settings() }
        shell("appops set ${context.packageName} ACTIVATE_VPN allow")
        assertNull("VPN consent", VpnService.prepare(context))

        ActivityScenario.launch(MainActivity::class.java).use {
            assertTrue(device.wait(Until.hasObject(By.text(fa("logIn"))), 10_000))
            shot("01-welcome")
            device.findObject(By.text(fa("logIn"))).click()
            assertTrue(device.wait(Until.hasObject(By.text(fa("signInTitle"))), 5000))
            shot("02-sign-in")

            // What scanning the bot's QR code or tapping its link does: the app opens with both values.
            val link = SignIn.build(SignInCode(panel!!, "demo-user"))
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            assertTrue("signed in by the link", waitFor(20_000) { Repo.signedIn.value })
            assertEquals("demo-user", Repo.lastUsername())
            assertTrue(device.wait(Until.hasObject(By.desc(fa("searchLocations"))), 10_000))
            shot("03-home")
            device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 40)
            shot("04-home-plan")
            device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 40)
            shot("05-home-week")
            device.swipe(device.displayWidth / 2, device.displayHeight * 3 / 4, device.displayWidth / 2, device.displayHeight / 4, 40)
            shot("06-home-tools")

            tap(fa("protection"))
            shot("07-protection")
            tap(fa("notices"))
            shot("08-notices")
            tap(fa("account"))
            shot("09-account")
            tap(fa("home"))
            tap(fa("allLocations"))
            assertTrue(device.wait(Until.hasObject(By.text(Geo.name(context, "US", "fa"))), 5000))
            device.findObject(By.text(Geo.name(context, "US", "fa"))).click()
            shot("10-locations")

            device.findObject(By.text(fa("fastest"))).click()
            assertTrue("connected", waitFor(60_000) { VpnState.status.value.state == ConnState.Connected })
            shot("11-connected")

            Repo.updateSettings { s -> s.copy(language = "en") }
            shot("12-connected-en")
            Repo.updateSettings { s -> s.copy(theme = "light") }
            shot("13-connected-light")
            DtVpnService.disconnect(context)
            assertTrue(waitFor(15_000) { VpnState.status.value.state == ConnState.Disconnected })
            shot("14-disconnected-light")
            Repo.updateSettings { Settings() }
        }
    }
}
