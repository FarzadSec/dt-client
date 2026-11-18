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

    // What is on screen, as UiAutomator sees it: every text and description, for a failure message.
    private fun onScreen(): String {
        val out = java.io.ByteArrayOutputStream()
        runCatching { device.dumpWindowHierarchy(out) }
        val xml = out.toString("UTF-8")
        return Regex("(?:text|content-desc)=\"([^\"]+)\"").findAll(xml).map { it.groupValues[1] }.distinct().joinToString(" | ")
    }

    private fun see(what: String, selector: androidx.test.uiautomator.BySelector, ms: Long = 10_000) {
        if (!device.wait(Until.hasObject(selector), ms)) throw AssertionError("no $what on screen; it shows: ${onScreen()}")
    }

    private fun tap(desc: String) {
        see("\"$desc\"", By.desc(desc), 5000)
        device.findObject(By.desc(desc)).click()
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
            see("the welcome page's Log in", By.text(fa("logIn")), 15_000)
            shot("01-welcome")
            device.findObject(By.text(fa("logIn"))).click()
            see("the sign-in form", By.text(fa("signInTitle")))
            shot("02-sign-in")

            // What scanning the bot's QR code or tapping its link does: the app opens with both values.
            val link = SignIn.build(SignInCode(panel!!, "demo-user"))
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            assertTrue("signed in by the link", waitFor(20_000) { Repo.signedIn.value })
            assertEquals("demo-user", Repo.lastUsername())
            see("the home page's search", By.desc(fa("searchLocations")))
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
            see("Fastest location", By.text(fa("fastest")))
            shot("10-locations")
            // The search reads English names too; a country with several cities opens to list them.
            device.findObject(By.clazz("android.widget.EditText")).text = "united"
            see("the United States in the results", By.text(Geo.name(context, "US", "fa")))
            see("New York under it", By.text("New York"))
            shot("11-search")
            device.findObject(By.clazz("android.widget.EditText")).text = ""

            see("Fastest location", By.text(fa("fastest")))
            device.findObject(By.text(fa("fastest"))).click()
            assertTrue("connected: ${VpnState.status.value}", waitFor(60_000) { VpnState.status.value.state == ConnState.Connected })
            shot("12-connected")

            Repo.updateSettings { s -> s.copy(language = "en") }
            shot("13-connected-en")
            Repo.updateSettings { s -> s.copy(theme = "light") }
            shot("14-connected-light")
            DtVpnService.disconnect(context)
            assertTrue("disconnected: ${VpnState.status.value}", waitFor(15_000) { VpnState.status.value.state == ConnState.Disconnected })
            shot("15-disconnected-light")
            Repo.updateSettings { Settings() }
        }
    }
}
