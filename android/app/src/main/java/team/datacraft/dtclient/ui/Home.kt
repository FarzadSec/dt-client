package team.datacraft.dtclient.ui

import android.content.Intent
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import team.datacraft.dtclient.R
import team.datacraft.dtclient.data.ConnState
import team.datacraft.dtclient.data.Location
import team.datacraft.dtclient.data.NoticeEntry
import team.datacraft.dtclient.data.Profile
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Secured
import team.datacraft.dtclient.data.Settings
import team.datacraft.dtclient.data.Status
import team.datacraft.dtclient.data.bannerNotices
import team.datacraft.dtclient.vpn.Candidates
import team.datacraft.dtclient.vpn.VpnState

// The home page: search, the map with the connection's state and button, recent locations,
// the plan, this week's protected time and the connection tools.
@Composable
fun HomePage(p: Profile, settings: Settings, log: List<NoticeEntry>, activity: MainActivity, onLocations: (search: Boolean) -> Unit, onTab: (String) -> Unit, onApps: () -> Unit) {
    val status by VpnState.status.collectAsState()
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Spacer(Modifier.height(2.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            SearchPill(Modifier.weight(1f)) { onLocations(true) }
            Spacer(Modifier.width(8.dp))
            RefreshButton()
        }
        Banners(bannerNotices(log, settings.dismissedNotices)) { key ->
            Repo.updateSettings { s -> s.copy(dismissedNotices = s.dismissedNotices.filter { k -> log.any { it.key == k } }.toSet() + key) }
        }
        MapCard(p, status, settings, activity, onExpand = { onLocations(false) })
        Recents(p, settings, activity) { onLocations(false) }
        PlanCard(p)
        SectionHeader(LocalT.current("statistics"))
        WeekCard()
        SectionHeader(LocalT.current("connectionTools"))
        Tools(settings, onApps)
        DtCard(padding = 10.dp) {
            NavRow(R.drawable.ic_sliders, LocalT.current("settings"), LocalT.current("settingsHint")) { onTab("protection") }
        }
        Spacer(Modifier.height(12.dp))
    }
}

@Composable
private fun SearchPill(modifier: Modifier, onClick: () -> Unit) {
    val c = LocalDt.current
    val t = LocalT.current
    Row(
        modifier.height(46.dp).clip(RoundedCornerShape(50)).border(1.dp, c.line, RoundedCornerShape(50)).clickable(onClick = onClick)
            .semantics { contentDescription = t("searchLocations") }.padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_search), null, tint = c.muted, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Text(t("searchLocations"), color = c.muted, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun RefreshButton() {
    val c = LocalDt.current
    val t = LocalT.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var refreshing by remember { mutableStateOf(false) }
    val angle by rememberInfiniteTransition(label = "refresh").animateFloat(0f, 360f, infiniteRepeatable(tween(900, easing = LinearEasing)), label = "refresh")
    Box(
        Modifier.size(46.dp).clip(CircleShape).border(1.dp, c.line, CircleShape).clickable(enabled = !refreshing) {
            refreshing = true
            scope.launch {
                val error = Repo.refresh()
                refreshing = false
                Toast.makeText(context, if (error == null) t("refreshed") else t("refreshFailed"), Toast.LENGTH_SHORT).show()
            }
        }.semantics { contentDescription = t("refreshSub") },
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(R.drawable.ic_refresh), null, tint = c.text, modifier = Modifier.size(20.dp).rotate(if (refreshing) angle else 0f))
    }
}

@Composable
fun Banners(notices: List<NoticeEntry>, onClose: (String) -> Unit) {
    if (notices.isEmpty()) return
    val t = LocalT.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (n in notices) {
            val critical = n.level == "critical"
            val ink = if (critical) Color.White else Color(0xFF2B1D00)
            Rtl {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Brush.linearGradient(if (critical) Palette.critical else Palette.warning)).padding(8.dp),
                    verticalAlignment = Alignment.Top,
                ) {
                    CircleIconButton(R.drawable.ic_close, t("closeNotice"), size = 28.dp, background = Color.White.copy(alpha = 0.22f), tint = ink) { onClose(n.key) }
                    Icon(painterResource(R.drawable.ic_alert), null, tint = ink, modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp).size(20.dp))
                    Box(Modifier.weight(1f).padding(top = 4.dp)) { NoticeText(n.body, ink) }
                }
            }
        }
    }
}

@Composable
private fun MapCard(p: Profile, status: Status, settings: Settings, activity: MainActivity, onExpand: () -> Unit) {
    val c = LocalDt.current
    val t = LocalT.current
    val context = LocalContext.current
    val connected = status.state == ConnState.Connected
    val connecting = status.state == ConnState.Connecting
    val busy = connecting || status.state == ConnState.Disconnecting
    val target = settings.locationId?.let { id -> p.locations.firstOrNull { it.id == id } }
    val live = (status.serverId ?: status.locationId)?.let { id -> p.locations.firstOrNull { it.id == id } }
    val shown = if (status.state != ConnState.Disconnected) live ?: target else target
    val usable = remember(p) { Candidates.usableLocationIds(p) }
    val focus = shown?.let { Geo.point(context, it.countryCode) } ?: Geo.point(context, "IR") ?: Offset(0.66f, 0.38f)
    val dots = p.locations.filter { it.id in usable }.mapNotNull { l ->
        Geo.point(context, l.countryCode)?.let { at ->
            MapDot("${l.id}", at, if (connected && l.id == live?.id) DotKind.Connected else if (l.id == shown?.id) DotKind.Selected else DotKind.Server)
        }
    }.sortedBy { it.kind.ordinal }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(connected) {
        while (connected) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val samples by VpnState.live.collectAsState()
    val badge by animateColorAsState(if (connected) c.securedBadge else if (busy) c.cardHigh else c.unsecuredBadge, label = "badge")
    val ink by animateColorAsState(if (connected) c.secured else if (busy) Palette.warn else c.unsecured, label = "ink")
    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(c.sea)) {
        WorldMap(focus, dots, Modifier.matchParentSize())
        Box(Modifier.matchParentSize().background(Brush.verticalGradient(listOf(Color.Transparent, c.sea.copy(alpha = 0.9f), c.sea), startY = 120f)))
        Column(Modifier.fillMaxWidth().padding(14.dp)) {
            Row(verticalAlignment = Alignment.Top) {
                if (connected) LiveChart(samples, Modifier.weight(1f)) else Spacer(Modifier.weight(1f).height(if (connected) 0.dp else 70.dp))
                Spacer(Modifier.width(8.dp))
                CircleIconButton(R.drawable.ic_expand, t("allLocations"), size = 38.dp, background = c.background.copy(alpha = 0.7f), onClick = onExpand)
            }
            Spacer(Modifier.height(if (connected) 12.dp else 40.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(46.dp).clip(CircleShape).background(badge), contentAlignment = Alignment.Center) {
                    if (busy) CircularProgressIndicator(Modifier.size(46.dp), color = Palette.warn, strokeWidth = 2.5.dp)
                    Icon(painterResource(if (connected) R.drawable.ic_shield else R.drawable.ic_shield_off), null, tint = ink, modifier = Modifier.size(22.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    val title = when (status.state) {
                        ConnState.Connected -> t("secured")
                        ConnState.Connecting -> t("connecting")
                        ConnState.Disconnecting -> t("disconnecting")
                        else -> t("notSecured")
                    }
                    Text(title, color = ink, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    val detail = when {
                        connected && status.since > 0 -> listOf(clock(now - status.since), protocolName(status.protocol)).filter { it.isNotEmpty() }.joinToString(" · ")
                        busy -> protocolName(status.protocol)
                        else -> ""
                    }
                    if (detail.isNotEmpty()) Text(iso(detail), color = c.muted, fontSize = 12.sp, maxLines = 1)
                }
            }
            Spacer(Modifier.height(10.dp))
            LocationChip(shown, enabled = !busy, onClick = onExpand)
            Spacer(Modifier.height(8.dp))
            ProtocolChips(p, settings) { protocol ->
                Repo.updateSettings { it.copy(protocol = protocol) }
                if (connected || connecting || status.error == "protocol_failed") activity.connect(settings.locationId)
            }
            if (status.state == ConnState.Disconnected && status.error.isNotEmpty()) {
                Spacer(Modifier.height(8.dp))
                Text(t.error(status.error), color = c.unsecured, fontSize = 13.sp, lineHeight = 19.sp)
            }
            if (connected && status.notice == "stalled") {
                Spacer(Modifier.height(8.dp))
                Text(t("noticeStalled", "protocol" to protocolName(status.protocol)), color = Palette.bad, fontSize = 13.sp, lineHeight = 19.sp)
            }
            if (connected && status.notice == "switched") {
                Spacer(Modifier.height(8.dp))
                Text(t("noticeSwitched", "protocol" to protocolName(status.protocol)), color = c.accent, fontSize = 13.sp, lineHeight = 19.sp)
            }
            Spacer(Modifier.height(12.dp))
            when {
                connected -> SecondaryButton(t("disconnect"), icon = R.drawable.ic_power, color = c.unsecured) { activity.disconnect() }
                connecting -> SecondaryButton(t("cancel")) { activity.disconnect() }
                else -> PrimaryButton(t("secureMyConnection"), enabled = !busy) { activity.connect(settings.locationId) }
            }
        }
    }
}

fun protocolName(protocol: String): String = when (protocol) {
    "" -> ""
    "wireguard" -> "WireGuard"
    "openvpn" -> "OpenVPN"
    "xray" -> "V2Ray"
    else -> protocol.uppercase()
}

// Where the next connection goes: a tap opens the locations.
@Composable
private fun LocationChip(shown: Location?, enabled: Boolean, onClick: () -> Unit) {
    val c = LocalDt.current
    val t = LocalT.current
    val context = LocalContext.current
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card.copy(alpha = 0.92f)).clickable(enabled = enabled, onClick = onClick)
            .semantics { contentDescription = t("changeLocation") }.padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (shown != null) {
            FlagCircle(shown.countryCode, 28.dp)
        } else {
            Box(Modifier.size(28.dp).clip(CircleShape).background(c.button.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_zap), null, tint = c.accent, modifier = Modifier.size(16.dp))
            }
        }
        Spacer(Modifier.width(10.dp))
        val place = shown?.let { placeName(it, Geo.name(context, it.countryCode, t.language), Geo.name(context, it.countryCode, "en")) } ?: t("fastest")
        Text(place, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Icon(painterResource(R.drawable.ic_chevron_end), null, tint = c.muted, modifier = Modifier.size(18.dp))
    }
}

// The protocol for the next connection, on the home page where it is seen; Auto first.
@Composable
private fun ProtocolChips(p: Profile, settings: Settings, onPick: (String) -> Unit) {
    val c = LocalDt.current
    val t = LocalT.current
    val options = remember(p) { listOf("auto") + Candidates.choices(p) }
    if (options.size <= 1) return
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(c.card.copy(alpha = 0.92f)).padding(3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        for (key in options) {
            val on = settings.protocol == key
            Box(
                Modifier.weight(1f).height(34.dp).clip(RoundedCornerShape(11.dp)).background(if (on) c.button else Color.Transparent).clickable { if (!on) onPick(key) }
                    .semantics { contentDescription = if (key == "auto") t("autoShort") else protocolName(key) },
                contentAlignment = Alignment.Center,
            ) {
                Text(if (key == "auto") t("autoShort") else protocolName(key), color = if (on) c.onButton else c.muted, fontSize = 12.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Recents(p: Profile, settings: Settings, activity: MainActivity, onAll: () -> Unit) {
    val t = LocalT.current
    val context = LocalContext.current
    val pings by Repo.pings.collectAsState()
    val usable = remember(p) { Candidates.usableLocationIds(p) }
    val recent = settings.recents.mapNotNull { id -> p.locations.firstOrNull { it.id == id && it.id in usable } }
    val shown = recent.ifEmpty { p.locations.filter { it.id in usable }.sortedBy { Candidates.bestPing(p, pings, it.id) ?: Int.MAX_VALUE }.take(6) }
    if (shown.isEmpty()) return
    SectionHeader(if (recent.isNotEmpty()) t("recents") else t("suggested"), t("allLocations"), onAll)
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        item(key = "fastest") {
            PlaceCard(null, t("fastestShort"), Candidates.bestPing(p, pings, null)?.let { iso("$it ms") } ?: t("bestPing")) { activity.connect(null) }
        }
        items(shown, key = { it.id }) { l: Location ->
            val country = Geo.name(context, l.countryCode, t.language)
            val ms = Candidates.bestPing(p, pings, l.id)
            val subtitle = listOf(l.city.ifEmpty { if (country.isNotEmpty() && l.name != country) l.name else "" }, ms?.let { iso("$it ms") } ?: "").filter { it.isNotEmpty() }.joinToString(" · ")
            PlaceCard(l.countryCode, country.ifEmpty { l.name }, subtitle.ifEmpty { t("fastestShort") }) { activity.connect(l.id) }
        }
    }
}

@Composable
private fun PlaceCard(code: String?, title: String, subtitle: String, onClick: () -> Unit) {
    val c = LocalDt.current
    Column(Modifier.width(122.dp).clip(RoundedCornerShape(18.dp)).background(c.card).clickable(onClick = onClick).padding(12.dp)) {
        if (code == null) {
            Box(Modifier.size(32.dp).clip(CircleShape).background(c.button.copy(alpha = 0.18f)), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_zap), null, tint = c.accent, modifier = Modifier.size(18.dp))
            }
        } else {
            FlagCircle(code, 32.dp)
        }
        Spacer(Modifier.height(10.dp))
        Text(title, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(subtitle, color = c.muted, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// The plan's traffic as one bar: teal, amber from 80% and red from 95%.
@Composable
private fun PlanCard(p: Profile) {
    val c = LocalDt.current
    val t = LocalT.current
    val a = p.account
    val used = a.upload + a.download
    val percent = if (a.total > 0) (used.toDouble() / a.total * 100).coerceAtMost(100.0) else null
    val color = when {
        percent == null -> c.accent
        percent >= 95 -> Palette.bad
        percent >= 80 -> Palette.warn
        else -> c.accent
    }
    val fetchedAt by Repo.fetchedAt.collectAsState()
    DtCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(R.drawable.ic_calendar, size = 36.dp)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(t("yourPlan"), color = c.muted, fontSize = 12.sp)
                Text(expiryText(t, a), color = c.text, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
            StatusPill(if (a.enabled) t("active") else t("inactive"), a.enabled)
        }
        Spacer(Modifier.height(10.dp))
        Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(c.cardHigh)) {
            Box(Modifier.fillMaxWidth(((percent ?: 100.0) / 100).toFloat().coerceAtLeast(0.03f)).height(8.dp).clip(RoundedCornerShape(4.dp)).background(Brush.horizontalGradient(listOf(color.copy(alpha = if (percent == null) 0.35f else 0.7f), color))))
        }
        Spacer(Modifier.height(8.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(if (a.total > 0) t("usedOf", "used" to iso(bytes(used)), "total" to iso(bytes(a.total))) else "${t("unlimitedTraffic")} · ${iso(bytes(used))}", color = c.text, fontSize = 13.sp, maxLines = 1, softWrap = false, modifier = Modifier.weight(1f))
            if (a.total > 0) Text(t("trafficLeft", "n" to iso(bytes((a.total - used).coerceAtLeast(0)))), color = color, fontSize = 13.sp, fontWeight = FontWeight.Bold, maxLines = 1, softWrap = false)
        }
        if (a.deviceLimit > 0) Text("${t("devices")}: ${iso("${a.devices} / ${a.deviceLimit}")}", color = c.muted, fontSize = 12.sp)
        if (fetchedAt > 0) Text(t("updatedAgoShort", "when" to ago(t, fetchedAt)), color = c.muted, fontSize = 11.sp)
    }
}

// This calendar week, a bar a day: the hours connected out of 24.
@Composable
private fun WeekCard() {
    val c = LocalDt.current
    val t = LocalT.current
    val sessions by Repo.sessions.collectAsState()
    val status by VpnState.status.collectAsState()
    val now by produceState(System.currentTimeMillis(), status.state) {
        while (true) {
            value = System.currentTimeMillis()
            delay(60_000)
        }
    }
    val firstDay = if (t.language == "fa") Calendar.SATURDAY else Calendar.SUNDAY
    val week = remember(sessions, now, firstDay, status.state) { Secured.week(sessions, Repo.openSession(), now, TimeZone.getDefault(), firstDay) }
    val letters = if (t.language == "fa") listOf("ش", "ی", "د", "س", "چ", "پ", "ج") else listOf("S", "M", "T", "W", "T", "F", "S")
    val securedHours = week.sumOf { it.secured } / 3_600_000
    val notSecuredHours = week.sumOf { (it.elapsed - it.secured).coerceAtLeast(0) } / 3_600_000
    DtCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconTile(R.drawable.ic_globe, size = 36.dp)
            Spacer(Modifier.width(10.dp))
            Text(t("securedByVpn"), color = c.text, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(6.dp))
        Text(t("securedHint"), color = c.muted, fontSize = 12.sp, lineHeight = 18.sp)
        Spacer(Modifier.height(10.dp))
        Row(Modifier.fillMaxWidth().height(120.dp)) {
            Column(Modifier.fillMaxHeight().padding(end = 8.dp), verticalArrangement = Arrangement.SpaceBetween) {
                Text("24", color = c.muted, fontSize = 11.sp)
                Text("0", color = c.muted, fontSize = 11.sp, modifier = Modifier.padding(bottom = 22.dp))
            }
            week.forEachIndexed { i, day ->
                Column(Modifier.weight(1f).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.weight(1f).width(10.dp).clip(RoundedCornerShape(5.dp)).background(if (day.future) c.background else c.cardHigh), contentAlignment = Alignment.BottomCenter) {
                        val fraction = (day.secured.toFloat() / Secured.DAY).coerceIn(0f, 1f)
                        if (fraction > 0f) Box(Modifier.fillMaxWidth().fillMaxHeight(fraction.coerceAtLeast(0.04f)).clip(RoundedCornerShape(6.dp)).background(c.button))
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(letters[i], color = if (day.today) c.text else c.muted, fontSize = 12.sp, fontWeight = if (day.today) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Legend(c.button, t("hSecured", "n" to iso("$securedHours")))
            Legend(c.muted, t("hNotSecured", "n" to iso("$notSecuredHours")))
        }
    }
}

@Composable
private fun Legend(color: Color, text: String) {
    val c = LocalDt.current
    Row(Modifier.clip(RoundedCornerShape(50)).background(c.cardHigh).padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(6.dp))
        Text(text, color = c.text, fontSize = 11.sp)
    }
}

@Composable
private fun Tools(settings: Settings, onApps: () -> Unit) {
    val t = LocalT.current
    val context = LocalContext.current
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ToolCard(Modifier.weight(1f), R.drawable.ic_lock, t("killSwitch"), t("turnOn")) {
            runCatching { context.startActivity(Intent(AndroidSettings.ACTION_VPN_SETTINGS)) }
        }
        ToolCard(Modifier.weight(1f), R.drawable.ic_grid, t("splitTunneling"), if (settings.splitApps.isEmpty()) t("chooseApps") else t("appsCount", "n" to iso("${settings.splitApps.size}")), onApps)
    }
}

@Composable
private fun ToolCard(modifier: Modifier, icon: Int, title: String, action: String, onClick: () -> Unit) {
    val c = LocalDt.current
    Column(modifier.height(108.dp).clip(RoundedCornerShape(18.dp)).background(c.card).clickable(onClick = onClick).padding(12.dp)) {
        IconTile(icon, size = 34.dp)
        Spacer(Modifier.weight(1f))
        Text(title, color = c.text, fontSize = 14.sp, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(2.dp))
        Text(action, color = c.accent, fontSize = 12.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun Rtl(content: @Composable () -> Unit) {
    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.ui.platform.LocalLayoutDirection provides androidx.compose.ui.unit.LayoutDirection.Rtl, content = content)
}

fun ping(ms: Int?): String = ms?.let { String.format(Locale.US, "%d ms", it) } ?: "—"
