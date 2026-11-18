package team.datacraft.dtclient.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.ceil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import team.datacraft.dtclient.BuildConfig
import team.datacraft.dtclient.data.ApiException
import team.datacraft.dtclient.data.ConnState
import team.datacraft.dtclient.data.Location
import team.datacraft.dtclient.data.NoticeEntry
import team.datacraft.dtclient.data.Profile
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Settings
import team.datacraft.dtclient.data.Status
import team.datacraft.dtclient.data.bannerNotices
import team.datacraft.dtclient.data.noticeLog
import team.datacraft.dtclient.data.unreadNotices
import team.datacraft.dtclient.vpn.Candidates
import team.datacraft.dtclient.vpn.VpnState

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
    DtTheme(dark) {
        CompositionLocalProvider(LocalLayoutDirection provides if (settings.language == "en") LayoutDirection.Ltr else LayoutDirection.Rtl) {
            Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                if (signedIn) MainScreen(t, settings, activity) else WelcomeScreen(t, settings)
            }
        }
    }
}

// Notices are written in Persian, so they are right to left in Vazirmatn whatever the app's language.
@Composable
private fun NoticeText(body: String, color: Color, size: Int = 14) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        Text(
            body,
            modifier = Modifier.fillMaxWidth(),
            style = TextStyle(fontFamily = Vazirmatn, fontSize = size.sp, lineHeight = (size * 1.8).sp, color = color, textDirection = TextDirection.Rtl, textAlign = TextAlign.Start),
        )
    }
}

fun flag(code: String): String {
    if (code.length != 2 || !code.all { it in 'A'..'Z' }) return "🌐"
    return code.map { String(Character.toChars(0x1F1E6 + (it - 'A'))) }.joinToString("")
}

fun bytes(n: Long): String {
    if (n <= 0) return "0 B"
    val units = listOf("B", "KB", "MB", "GB", "TB")
    var i = 0
    var v = n.toDouble()
    while (v >= 1024 && i < units.size - 1) {
        v /= 1024
        i++
    }
    return String.format(Locale.US, if (i >= 3) "%.2f %s" else if (i == 0) "%.0f %s" else "%.1f %s", v, units[i])
}

private fun clock(ms: Long): String {
    val s = (ms / 1000).coerceAtLeast(0)
    return String.format(Locale.US, "%02d:%02d:%02d", s / 3600, (s % 3600) / 60, s % 60)
}

@Composable
private fun WelcomeScreen(t: Strings, settings: Settings) {
    val scope = rememberCoroutineScope()
    val reason by Repo.signOutReason.collectAsState()
    var link by remember { mutableStateOf(Repo.lastSubLink()) }
    var username by remember { mutableStateOf(Repo.lastUsername()) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("DT Client", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            TextButton(onClick = { Repo.updateSettings { it.copy(language = if (settings.language == "fa") "en" else "fa") } }) {
                Text(if (settings.language == "fa") "English" else "فارسی")
            }
        }
        Spacer(Modifier.height(24.dp))
        Text(t("welcome"), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(t("welcomeHint"), color = MaterialTheme.colorScheme.onSurfaceVariant)
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            OutlinedTextField(link, { link = it }, Modifier.fillMaxWidth(), label = { Text(t("subLink")) }, singleLine = true)
        }
        OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text(t("username")) }, singleLine = true)
        val shown = error.ifEmpty { reason }
        if (shown.isNotEmpty()) Text(t.error(shown), color = Palette.bad)
        Button(
            onClick = {
                busy = true
                error = ""
                scope.launch {
                    try {
                        Repo.login(link, username)
                        Repo.ping()
                    } catch (e: ApiException) {
                        error = e.code
                    } catch (e: Exception) {
                        error = "unexpected"
                    } finally {
                        busy = false
                    }
                }
            },
            enabled = !busy && link.isNotBlank() && username.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(52.dp),
        ) {
            Text(if (busy) t("signingIn") else t("signIn"), fontWeight = FontWeight.Bold)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MainScreen(t: Strings, settings: Settings, activity: MainActivity) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val profile by Repo.profile.collectAsState()
    val status by VpnState.status.collectAsState()
    var page by remember { mutableStateOf("home") }
    var refreshing by remember { mutableStateOf(false) }
    var showNotices by remember { mutableStateOf(false) }
    val p = profile ?: return
    val log = remember(p) { noticeLog(p) }
    val banners = bannerNotices(log, settings.dismissedNotices)
    val unread = unreadNotices(log, settings)

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("DT Client", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            val rotation by rememberInfiniteTransition(label = "refresh").animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "refresh")
            IconButton(
                enabled = !refreshing,
                onClick = {
                    refreshing = true
                    scope.launch {
                        val error = Repo.refresh()
                        refreshing = false
                        Toast.makeText(context, if (error == null) t("refreshed") else t("refreshFailed"), Toast.LENGTH_SHORT).show()
                    }
                },
            ) {
                Icon(Icons.Filled.Refresh, t("refreshSub"), Modifier.rotate(if (refreshing) rotation else 0f))
            }
            IconButton(onClick = {
                showNotices = true
                if (unread > 0) Repo.updateSettings { s -> s.copy(seenNoticeId = maxOf(s.seenNoticeId, log.maxOfOrNull { it.id } ?: 0), seenAnnounce = p.announce) }
            }) {
                BadgedBox(badge = { if (unread > 0) Badge(containerColor = Palette.bad) { Text(if (unread > 9) "9+" else "$unread", color = Color.White) } }) {
                    Icon(Icons.Filled.Notifications, t("notices"))
                }
            }
        }
        Column(Modifier.weight(1f)) {
            Banners(t, banners) { key -> Repo.updateSettings { s -> s.copy(dismissedNotices = s.dismissedNotices.filter { k -> log.any { it.key == k } }.toSet() + key) } }
            when (page) {
                "locations" -> LocationsPage(t, p, status, settings, activity)
                "settings" -> SettingsPage(t, p, settings)
                else -> HomePage(t, p, status, settings, activity) { page = "locations" }
            }
        }
        NavigationBar {
            listOf(Triple("home", Icons.Filled.Home, t("home")), Triple("locations", Icons.Filled.LocationOn, t("locations")), Triple("settings", Icons.Filled.Settings, t("settings"))).forEach { (key, icon, label) ->
                NavigationBarItem(selected = page == key, onClick = { page = key }, icon = { Icon(icon, label) }, label = { Text(label) })
            }
        }
    }

    if (showNotices) {
        ModalBottomSheet(onDismissRequest = { showNotices = false }) {
            Text(t("notices"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp))
            if (log.isEmpty()) Text(t("noNotices"), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(20.dp))
            LazyColumn(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                items(log, key = { it.key }) { NoticeItem(t, it, settings.language) }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun Banners(t: Strings, notices: List<NoticeEntry>, onClose: (String) -> Unit) {
    if (notices.isEmpty()) return
    Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (n in notices) {
            val critical = n.level == "critical"
            val ink = if (critical) Color.White else Color(0xFF2B1D00)
            // Persian, so the close button is at the start: the right edge.
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(if (critical) Palette.critical else Palette.warning)).padding(10.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    IconButton(onClick = { onClose(n.key) }, modifier = Modifier.size(32.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.2f))) {
                        Icon(Icons.Filled.Close, t("closeNotice"), tint = ink, modifier = Modifier.size(18.dp))
                    }
                    Icon(Icons.Filled.Warning, null, tint = ink, modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp).size(20.dp))
                    Box(Modifier.weight(1f).padding(top = 4.dp)) { NoticeText(n.body, ink) }
                }
            }
        }
    }
}

@Composable
private fun NoticeItem(t: Strings, n: NoticeEntry, language: String) {
    val color = when (n.level) {
        "critical" -> Palette.bad
        "warning" -> Palette.warn
        else -> MaterialTheme.colorScheme.primary
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(12.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(if (n.level == "info") Icons.Filled.Info else Icons.Filled.Warning, null, tint = color, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
            Text(if (n.key == "announce") t("subscriptionNotice") else t("level.${n.level}"), color = color, fontWeight = FontWeight.Bold, fontSize = 12.sp, modifier = Modifier.weight(1f))
            if (n.createdAt > 0) {
                val locale = if (language == "fa") Locale("fa", "IR") else Locale.UK
                Text(DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT, locale).format(Date(n.createdAt)), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Spacer(Modifier.height(6.dp))
        NoticeText(n.body, MaterialTheme.colorScheme.onSurface)
    }
}

@Composable
private fun HomePage(t: Strings, p: Profile, status: Status, settings: Settings, activity: MainActivity, onLocations: () -> Unit) {
    val connected = status.state == ConnState.Connected
    val busy = status.state == ConnState.Connecting || status.state == ConnState.Disconnecting
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(connected) {
        while (connected) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val shownId = if (status.state == ConnState.Disconnected) settings.locationId else status.serverId ?: status.locationId
    val shown = p.locations.firstOrNull { it.id == shownId }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(MaterialTheme.colorScheme.surface).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            val ring = if (connected) Palette.ok else if (busy) Palette.warn else MaterialTheme.colorScheme.outline
            Box(Modifier.size(132.dp).clip(CircleShape).background(ring.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                if (busy) CircularProgressIndicator(Modifier.size(132.dp), color = ring, strokeWidth = 3.dp)
                Text(shown?.let { flag(it.countryCode) } ?: "⚡", fontSize = 52.sp)
            }
            Text(shown?.let { locationLabel(it) } ?: t("fastest"), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            val stateText = when (status.state) {
                ConnState.Connected -> t("connected")
                ConnState.Connecting -> t("connecting")
                ConnState.Disconnecting -> t("disconnecting")
                else -> t("notConnected")
            }
            Text(if (connected && status.since > 0) "$stateText · ${clock(now - status.since)}" else stateText, color = if (connected) Palette.ok else if (busy) Palette.warn else Palette.bad, fontWeight = FontWeight.Medium)
            if (status.protocol.isNotEmpty() && status.state != ConnState.Disconnected) {
                Text("${status.protocol.uppercase()} · ${status.configName}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (status.error.isNotEmpty() && status.state == ConnState.Disconnected) Text(t.error(status.error), color = Palette.bad, textAlign = TextAlign.Center)
            if (connected || status.state == ConnState.Connecting) {
                OutlinedButton(onClick = { activity.disconnect() }, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text(if (connected) t("disconnect") else t("cancel"), fontWeight = FontWeight.Bold)
                }
            } else {
                Button(onClick = { activity.connect(settings.locationId) }, enabled = !busy, modifier = Modifier.fillMaxWidth().height(52.dp)) {
                    Text(t("connect"), fontWeight = FontWeight.Bold)
                }
            }
            TextButton(onClick = onLocations) { Text(t("selectLocation")) }
        }
        UsageCard(t, p)
        AccountCard(t, p)
    }
}

fun locationLabel(l: Location): String {
    val name = l.name.ifEmpty { l.countryCode.ifEmpty { "#${l.id}" } }
    return if (l.city.isNotEmpty() && l.city != name) "$name · ${l.city}" else name
}

// The plan's traffic as one bar: turquoise, amber from 80% and red from 95%.
@Composable
private fun UsageCard(t: Strings, p: Profile) {
    val a = p.account
    val used = a.upload + a.download
    val percent = if (a.total > 0) (used.toDouble() / a.total * 100).coerceAtMost(100.0) else null
    val color = when {
        percent == null -> MaterialTheme.colorScheme.primary
        percent >= 95 -> Palette.bad
        percent >= 80 -> Palette.warn
        else -> MaterialTheme.colorScheme.primary
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surface).padding(18.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(t("traffic"), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text(if (percent != null) String.format(Locale.US, "%.1f%%", percent) else t("unlimitedTraffic"), color = color, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(10.dp))
        Box(Modifier.fillMaxWidth().height(12.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant)) {
            Box(Modifier.fillMaxWidth(((percent ?: 100.0) / 100).toFloat().coerceAtLeast(0.03f)).height(12.dp).clip(RoundedCornerShape(6.dp)).background(Brush.horizontalGradient(listOf(color.copy(alpha = if (percent == null) 0.35f else 0.7f), color))))
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth()) {
            Text(if (a.total > 0) t("usedOf", "used" to "⁨${bytes(used)}⁩", "total" to "⁨${bytes(a.total)}⁩") else bytes(used), fontSize = 13.sp, modifier = Modifier.weight(1f))
            if (a.total > 0) Text(t("trafficLeft", "n" to "⁨${bytes((a.total - used).coerceAtLeast(0))}⁩"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text("↑ ${t("uploaded")} ⁨${bytes(a.upload)}⁩   ↓ ${t("downloaded")} ⁨${bytes(a.download)}⁩", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun AccountCard(t: Strings, p: Profile) {
    val a = p.account
    val expiry = when {
        a.expiryTime > 0 -> t("daysLeft", "n" to ceil((a.expiryTime - System.currentTimeMillis()) / 86_400_000.0).toInt().coerceAtLeast(0))
        a.expiryTime < 0 -> t("firstUse")
        else -> t("never")
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surface).padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(t("yourAccount"), fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            Text(if (a.enabled) t("active") else t("inactive"), color = if (a.enabled) Palette.ok else Palette.bad, fontWeight = FontWeight.Medium)
        }
        Text(a.username, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(expiry)
        if (a.deviceLimit > 0) Text("${t("devices")}: ⁨${a.devices} / ${a.deviceLimit}⁩")
    }
}

@Composable
private fun LocationsPage(t: Strings, p: Profile, status: Status, settings: Settings, activity: MainActivity) {
    val scope = rememberCoroutineScope()
    val pings by Repo.pings.collectAsState()
    val pinging by Repo.pinging.collectAsState()
    val usable = remember(p) { Candidates.usableLocationIds(p) }
    val locations = p.locations.filter { it.id in usable }.sortedBy { Candidates.bestPing(p, pings, it.id) ?: Int.MAX_VALUE }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(t("selectLocation"), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            OutlinedButton(onClick = { scope.launch { Repo.ping() } }, enabled = !pinging) {
                if (pinging) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                Spacer(Modifier.width(6.dp))
                Text(if (pinging) t("pinging") else t("pingNow"))
            }
        }
        if (locations.isEmpty()) Text(t("noLocations"), modifier = Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        LazyColumn(Modifier.padding(horizontal = 12.dp)) {
            item {
                LocationRow("⚡", t("fastest"), t("fastestShort"), null, pinging, settings.locationId == null) { activity.connect(null) }
            }
            items(locations, key = { it.id }) { l ->
                val active = status.state != ConnState.Disconnected && status.serverId == l.id
                LocationRow(flag(l.countryCode), l.name.ifEmpty { l.countryCode }, l.city, Candidates.bestPing(p, pings, l.id), pinging, settings.locationId == l.id || active) {
                    if (active) activity.disconnect() else activity.connect(l.id)
                }
            }
        }
    }
}

@Composable
private fun LocationRow(icon: String, title: String, subtitle: String, ms: Int?, pinging: Boolean, selected: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(14.dp))
            .background(if (selected) MaterialTheme.colorScheme.primary.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surface)
            .clickable(onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(icon, fontSize = 26.sp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold)
            if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        val color = when {
            ms == null -> MaterialTheme.colorScheme.onSurfaceVariant
            ms < 150 -> Palette.ok
            ms < 300 -> Palette.warn
            else -> Palette.bad
        }
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Text(if (ms != null) "$ms ms" else if (pinging) "…" else "—", color = color, fontSize = 13.sp)
        }
    }
}

@Composable
private fun SettingsPage(t: Strings, p: Profile, settings: Settings) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var pickApps by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Group {
            Choice(t("language"), listOf("fa" to "فارسی", "en" to "English"), settings.language) { v -> Repo.updateSettings { it.copy(language = v) } }
            Choice(t("appearance"), listOf("dark" to t("themeDark"), "light" to t("themeLight"), "system" to t("themeSystem")), settings.theme) { v -> Repo.updateSettings { it.copy(theme = v) } }
        }
        Group {
            Choice(t("protocol"), listOf("auto" to t("auto"), "xray" to "Xray", "wireguard" to "WireGuard", "openvpn" to "OpenVPN"), settings.protocol) { v -> Repo.updateSettings { it.copy(protocol = v) } }
            Toggle(t("iranDirect"), t("iranDirectHint"), settings.iranDirect) { v -> Repo.updateSettings { it.copy(iranDirect = v) } }
            Toggle(t("adBlock"), "", settings.adBlock) { v -> Repo.updateSettings { it.copy(adBlock = v) } }
        }
        Group {
            Text(t("killSwitch"), fontWeight = FontWeight.Bold)
            Text(t("killSwitchHint"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = { runCatching { context.startActivity(Intent(AndroidSettings.ACTION_VPN_SETTINGS)) } }) { Text(t("openVpnSettings")) }
        }
        Group {
            Text(t("splitTunneling"), fontWeight = FontWeight.Bold)
            Text(t("splitHint"), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = { pickApps = true }) { Text("${t("splitTunneling")} (${settings.splitApps.size})") }
        }
        Group {
            Text(t("yourAccount"), fontWeight = FontWeight.Bold)
            Text(p.account.username, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (p.supportUrl.isNotEmpty()) {
                OutlinedButton(onClick = { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(p.supportUrl))) } }) { Text(t("support")) }
            }
            Button(onClick = { scope.launch { Repo.logout() } }, colors = ButtonDefaults.buttonColors(containerColor = Palette.bad)) { Text(t("logout")) }
        }
        Text("${t("version")} ${BuildConfig.VERSION_NAME}", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if (pickApps) AppPicker(t, settings) { pickApps = false }
}

@Composable
private fun Group(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surface).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        content()
    }
}

@Composable
private fun Choice(title: String, options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(title, fontWeight = FontWeight.Bold)
        // Four protocols do not fit a narrow phone side by side; the row scrolls.
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((key, label) in options) {
                val on = key == value
                Box(
                    Modifier.clip(RoundedCornerShape(50)).background(if (on) MaterialTheme.colorScheme.primary.copy(alpha = 0.18f) else MaterialTheme.colorScheme.surfaceVariant)
                        .clickable { onChange(key) }.padding(horizontal = 14.dp, vertical = 8.dp),
                ) {
                    Text(label, color = if (on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface, fontWeight = if (on) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}

@Composable
private fun Toggle(title: String, hint: String, value: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Medium)
            if (hint.isNotEmpty()) Text(hint, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Switch(checked = value, onCheckedChange = onChange)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AppPicker(t: Strings, settings: Settings, onClose: () -> Unit) {
    val context = LocalContext.current
    var apps by remember { mutableStateOf<List<Pair<String, String>>>(emptyList()) }
    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) {
            val pm = context.packageManager
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            pm.queryIntentActivities(launcher, 0)
                .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
                .filter { it.first != context.packageName }
                .distinctBy { it.first }
                .sortedBy { it.second.lowercase() }
        }
    }
    ModalBottomSheet(onDismissRequest = onClose) {
        Text(t("splitTunneling"), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp))
        if (apps.isEmpty()) CircularProgressIndicator(Modifier.padding(24.dp).align(Alignment.CenterHorizontally))
        LazyColumn(Modifier.padding(horizontal = 12.dp)) {
            items(apps, key = { it.first }) { (pkg, label) ->
                val on = pkg in settings.splitApps
                Row(
                    Modifier.fillMaxWidth().clickable { Repo.updateSettings { s -> s.copy(splitApps = if (on) s.splitApps - pkg else s.splitApps + pkg) } }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = on, onCheckedChange = null)
                    Spacer(Modifier.width(8.dp))
                    Column {
                        Text(label)
                        Text(pkg, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            }
        }
    }
}
