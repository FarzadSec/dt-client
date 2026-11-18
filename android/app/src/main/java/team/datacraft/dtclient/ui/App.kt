package team.datacraft.dtclient.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import team.datacraft.dtclient.R
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.noticeLog
import team.datacraft.dtclient.data.unreadNotices

@Composable
fun DtRoot(activity: MainActivity) {
    val settings by Repo.settings.collectAsState()
    val signedIn by Repo.signedIn.collectAsState()
    val dark = when (settings.theme) {
        "light" -> false
        "system" -> isSystemInDarkTheme()
        else -> true
    }
    val t = remember(settings.language) { Strings(settings.language) }
    LaunchedEffect(dark) { activity.applySystemBars(dark) }
    DtTheme(dark) {
        CompositionLocalProvider(LocalT provides t, LocalLayoutDirection provides if (t.rtl) LayoutDirection.Rtl else LayoutDirection.Ltr) {
            Surface(Modifier.fillMaxSize(), color = LocalDt.current.background) {
                if (signedIn) MainScreen(activity) else SignedOutScreen()
                if (signedIn) SwitchAccount(activity)
            }
        }
    }
}

// A dtconnect:// link opened while signed in: same account, nothing to do; another one, ask first.
@Composable
private fun SwitchAccount(activity: MainActivity) {
    val t = LocalT.current
    val c = LocalDt.current
    val scope = rememberCoroutineScope()
    val pending by Repo.pendingSignIn.collectAsState()
    val code = pending ?: return
    val current = Repo.lastUsername()
    if (code.subLink.trim() == Repo.lastSubLink().trim() && (code.username.isEmpty() || code.username == current)) {
        LaunchedEffect(code) { Repo.pendingSignIn.value = null }
        return
    }
    AlertDialog(
        onDismissRequest = { Repo.pendingSignIn.value = null },
        containerColor = c.card,
        title = { Text(t("switchAccountTitle"), color = c.text) },
        text = { Text(t("switchAccountText", "user" to iso(current)), color = c.muted) },
        confirmButton = {
            TextButton(onClick = {
                activity.disconnect()
                // Signed out, the sign-in screen takes the waiting code and signs in with it.
                scope.launch { Repo.logout() }
            }) { Text(t("switch"), color = c.accent, fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = { Repo.pendingSignIn.value = null }) { Text(t("cancel"), color = c.text) } },
    )
}

@Composable
private fun MainScreen(activity: MainActivity) {
    val profile by Repo.profile.collectAsState()
    val settings by Repo.settings.collectAsState()
    val p = profile ?: return
    var tab by rememberSaveable { mutableStateOf("home") }
    var overlay by rememberSaveable { mutableStateOf("") }
    val log = remember(p) { noticeLog(p) }
    val unread = unreadNotices(log, settings)
    LaunchedEffect(tab, unread) {
        if (tab == "notices" && unread > 0) {
            Repo.updateSettings { s -> s.copy(seenNoticeId = maxOf(s.seenNoticeId, log.maxOfOrNull { it.id } ?: 0), seenAnnounce = p.announce) }
        }
    }
    BackHandler(enabled = overlay.isNotEmpty() || tab != "home") {
        if (overlay.isNotEmpty()) overlay = "" else tab = "home"
    }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.weight(1f)) {
                when (tab) {
                    "protection" -> ProtectionPage(settings) { overlay = "apps" }
                    "notices" -> NoticesPage(log)
                    "account" -> AccountPage(p, settings, activity)
                    else -> HomePage(p, settings, log, activity, onLocations = { search -> overlay = if (search) "search" else "locations" }, onTab = { tab = it }, onApps = { overlay = "apps" })
                }
            }
            BottomBar(tab, unread) { tab = it }
        }
        if (overlay == "locations" || overlay == "search") {
            LocationsScreen(p, settings, activity, focusSearch = overlay == "search") {
                overlay = ""
                tab = "home"
            }
        }
    }
    if (overlay == "apps") AppPicker(settings) { overlay = "" }
}

@Composable
private fun BottomBar(tab: String, unread: Int, onSelect: (String) -> Unit) {
    val c = LocalDt.current
    val t = LocalT.current
    val tabs = listOf(
        Triple("home", R.drawable.ic_globe, t("home")),
        Triple("protection", R.drawable.ic_shield, t("protection")),
        Triple("notices", R.drawable.ic_bell, t("notices")),
        Triple("account", R.drawable.ic_user, t("account")),
    )
    Column(Modifier.fillMaxWidth().background(c.background)) {
        HorizontalDivider(color = c.line)
        Row(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 10.dp, vertical = 8.dp), horizontalArrangement = Arrangement.SpaceAround) {
            for ((key, icon, label) in tabs) {
                val on = key == tab
                Box(
                    Modifier.clip(RoundedCornerShape(20.dp)).background(if (on) c.cardHigh else Color.Transparent).clickable { onSelect(key) }
                        .semantics {
                            contentDescription = label
                            role = Role.Tab
                            selected = on
                        }
                        .padding(horizontal = 24.dp, vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(painterResource(icon), null, tint = if (on) c.text else c.muted, modifier = Modifier.size(27.dp))
                    if (key == "notices" && unread > 0) {
                        Box(
                            Modifier.align(Alignment.TopEnd).offset(x = 7.dp, y = (-5).dp).size(18.dp).clip(CircleShape).background(Palette.teal),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(if (unread > 9) "9+" else "$unread", color = Palette.navy, fontSize = 10.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
