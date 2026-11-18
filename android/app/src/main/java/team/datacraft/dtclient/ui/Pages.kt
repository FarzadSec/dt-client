package team.datacraft.dtclient.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings as AndroidSettings
import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import team.datacraft.dtclient.BuildConfig
import team.datacraft.dtclient.R
import team.datacraft.dtclient.data.NoticeEntry
import team.datacraft.dtclient.data.Profile
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.Settings

// The protection tab: how the app connects and what goes around the tunnel.
@Composable
fun ProtectionPage(settings: Settings, onApps: () -> Unit) {
    val t = LocalT.current
    val c = LocalDt.current
    val context = LocalContext.current
    var dns by remember(settings.dns) { mutableStateOf(settings.dns) }
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PageTitle(t("protection"))
        DtCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_server, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("protocol"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            ChoiceChips(listOf("auto" to t("auto"), "xray" to "Xray", "wireguard" to "WireGuard", "openvpn" to "OpenVPN"), settings.protocol) { v -> Repo.updateSettings { it.copy(protocol = v) } }
            Spacer(Modifier.height(10.dp))
            Text(t("protocolHint"), color = c.muted, fontSize = 13.sp, lineHeight = 21.sp)
        }
        DtCard(padding = 14.dp) {
            ToggleRow(R.drawable.ic_pin, t("iranDirect"), t("iranDirectHint"), settings.iranDirect) { v -> Repo.updateSettings { it.copy(iranDirect = v) } }
            HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 4.dp))
            ToggleRow(R.drawable.ic_ban, t("adBlock"), t("adBlockHint"), settings.adBlock) { v -> Repo.updateSettings { it.copy(adBlock = v) } }
        }
        DtCard(padding = 14.dp) {
            NavRow(R.drawable.ic_lock, t("killSwitch"), t("killSwitchHint")) { runCatching { context.startActivity(Intent(AndroidSettings.ACTION_VPN_SETTINGS)) } }
            HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 4.dp))
            NavRow(R.drawable.ic_grid, t("splitTunneling"), if (settings.splitApps.isEmpty()) t("splitHint") else t("appsCount", "n" to iso("${settings.splitApps.size}")), onClick = onApps)
        }
        DtCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_globe, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("dns"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            Ltr {
                OutlinedTextField(
                    value = dns,
                    onValueChange = { dns = it },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    placeholder = { Text("1.1.1.1, 8.8.8.8", color = c.muted) },
                    shape = RoundedCornerShape(16.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = c.button, unfocusedBorderColor = c.line, cursorColor = c.button),
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(t("dnsHint"), color = c.muted, fontSize = 13.sp, lineHeight = 21.sp)
            if (dns.trim() != settings.dns) {
                Spacer(Modifier.height(10.dp))
                PrimaryButton(t("save")) {
                    Repo.updateSettings { it.copy(dns = dns.trim()) }
                    Toast.makeText(context, t("saved"), Toast.LENGTH_SHORT).show()
                }
            }
        }
        Text(t("appliesNextConnect"), color = c.muted, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 6.dp))
        Spacer(Modifier.height(16.dp))
    }
}

// The bell's list as a page: the subscription's announcement, then the panel's notices newest first.
@Composable
fun NoticesPage(log: List<NoticeEntry>) {
    val t = LocalT.current
    val c = LocalDt.current
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 16.dp)) {
        PageTitle(t("notices"))
        if (log.isEmpty()) {
            Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                IconTile(R.drawable.ic_bell, size = 72.dp)
                Spacer(Modifier.height(16.dp))
                Text(t("noNotices"), color = c.muted, fontSize = 15.sp, lineHeight = 24.sp, modifier = Modifier.padding(horizontal = 24.dp))
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(log, key = { it.key }) { NoticeCard(it) }
                item { Spacer(Modifier.height(16.dp)) }
            }
        }
    }
}

@Composable
private fun NoticeCard(n: NoticeEntry) {
    val t = LocalT.current
    val c = LocalDt.current
    val color = when (n.level) {
        "critical" -> Palette.bad
        "warning" -> Palette.warn
        else -> c.accent
    }
    DtCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(painterResource(if (n.level == "info") R.drawable.ic_info else R.drawable.ic_alert), null, tint = color, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(6.dp))
            Text(if (n.key == "announce") t("subscriptionNotice") else t("level.${n.level}"), color = color, fontWeight = FontWeight.Bold, fontSize = 13.sp, modifier = Modifier.weight(1f))
            if (n.createdAt > 0) Text(dateTime(t, n.createdAt), fontSize = 12.sp, color = c.muted)
        }
        Spacer(Modifier.height(8.dp))
        NoticeText(n.body, c.text, 15)
    }
}

// The account tab: who is signed in, the plan, the app's look and signing out.
@Composable
fun AccountPage(p: Profile, settings: Settings, activity: MainActivity) {
    val t = LocalT.current
    val c = LocalDt.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val fetchedAt by Repo.fetchedAt.collectAsState()
    var refreshing by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }
    val a = p.account
    Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        PageTitle(t("account"))
        DtCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(58.dp).clip(CircleShape).background(c.button), contentAlignment = Alignment.Center) {
                    Text(a.username.firstOrNull()?.uppercase() ?: "?", color = c.onButton, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Ltr { Text(a.username, color = c.text, fontSize = 19.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) }
                    if (p.title.isNotEmpty()) Text(p.title, color = c.muted, fontSize = 14.sp)
                }
                StatusPill(if (a.enabled) t("active") else t("inactive"), a.enabled)
            }
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = c.line)
            Spacer(Modifier.height(6.dp))
            InfoLine(t("yourPlan"), expiryText(t, a))
            if (a.expiryTime > 0) InfoLine(t("expiresOn"), date(t, a.expiryTime))
            val used = a.upload + a.download
            InfoLine(t("traffic"), if (a.total > 0) t("usedOf", "used" to iso(bytes(used)), "total" to iso(bytes(a.total))) else "${t("unlimitedTraffic")} · ${iso(bytes(used))}")
            InfoLine("${t("uploaded")} / ${t("downloaded")}", iso("${bytes(a.upload)} / ${bytes(a.download)}"))
            if (a.deviceLimit > 0) InfoLine(t("devices"), iso("${a.devices} / ${a.deviceLimit}"))
        }
        DtCard(padding = 14.dp) {
            NavRow(R.drawable.ic_refresh, t("refreshSub"), t("updatedAgo", "when" to ago(t, fetchedAt)), trailing = {
                if (refreshing) CircularProgressIndicator(Modifier.size(20.dp), color = c.accent, strokeWidth = 2.dp)
            }) {
                if (!refreshing) {
                    refreshing = true
                    scope.launch {
                        val error = Repo.refresh()
                        refreshing = false
                        Toast.makeText(context, if (error == null) t("refreshed") else t("refreshFailed"), Toast.LENGTH_SHORT).show()
                    }
                }
            }
            if (p.supportUrl.isNotEmpty()) {
                HorizontalDivider(color = c.line, modifier = Modifier.padding(vertical = 4.dp))
                NavRow(R.drawable.ic_chat, t("support")) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(p.supportUrl))) } }
            }
        }
        DtCard {
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_language, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("language"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            ChoiceChips(listOf("fa" to "فارسی", "en" to "English"), settings.language) { v -> Repo.updateSettings { it.copy(language = v) } }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconTile(R.drawable.ic_moon, size = 44.dp)
                Spacer(Modifier.width(14.dp))
                Text(t("appearance"), color = c.text, fontSize = 17.sp, fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.height(12.dp))
            ChoiceChips(listOf("dark" to t("themeDark"), "light" to t("themeLight"), "system" to t("themeSystem")), settings.theme) { v -> Repo.updateSettings { it.copy(theme = v) } }
        }
        DtCard(padding = 14.dp) {
            NavRow(R.drawable.ic_logout, t("logout"), color = Palette.bad) { confirmLogout = true }
        }
        Column(Modifier.fillMaxWidth().padding(vertical = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painterResource(if (c.dark) R.drawable.dt_lockup_reversed else R.drawable.dt_lockup), "DT Connect", Modifier.height(30.dp))
            Spacer(Modifier.height(8.dp))
            Text("${t("version")} ${iso(BuildConfig.VERSION_NAME)} · ${t("madeBy")}", color = c.muted, fontSize = 12.sp)
        }
        Spacer(Modifier.height(8.dp))
    }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            containerColor = c.card,
            title = { Text(t("logout"), color = c.text) },
            text = { Text(t("logoutConfirm", "user" to iso(a.username)), color = c.muted) },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    activity.disconnect()
                    scope.launch { Repo.logout() }
                }) { Text(t("logout"), color = Palette.bad, fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text(t("cancel"), color = c.text) } },
        )
    }
}

@Composable
private fun InfoLine(label: String, value: String) {
    val c = LocalDt.current
    Row(Modifier.fillMaxWidth().padding(vertical = 7.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, color = c.muted, fontSize = 14.sp, modifier = Modifier.weight(1f))
        Text(value, color = c.text, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppPicker(settings: Settings, onClose: () -> Unit) {
    val t = LocalT.current
    val c = LocalDt.current
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
    ModalBottomSheet(onDismissRequest = onClose, containerColor = c.card) {
        Text(t("splitTunneling"), color = c.text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(horizontal = 20.dp))
        Text(t("splitHint"), color = c.muted, fontSize = 13.sp, lineHeight = 21.sp, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp))
        if (apps.isEmpty()) CircularProgressIndicator(Modifier.padding(24.dp).align(Alignment.CenterHorizontally), color = c.accent)
        LazyColumn(Modifier.padding(horizontal = 12.dp)) {
            items(apps, key = { it.first }) { (pkg, label) ->
                val on = pkg in settings.splitApps
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable { Repo.updateSettings { s -> s.copy(splitApps = if (on) s.splitApps - pkg else s.splitApps + pkg) } }.padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = on, onCheckedChange = null, colors = CheckboxDefaults.colors(checkedColor = c.button, checkmarkColor = c.onButton, uncheckedColor = c.muted))
                    Spacer(Modifier.width(10.dp))
                    Column {
                        Text(label, color = c.text)
                        Text(pkg, fontSize = 11.sp, color = c.muted)
                    }
                }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}
