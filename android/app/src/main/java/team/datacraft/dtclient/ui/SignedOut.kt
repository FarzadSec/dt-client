package team.datacraft.dtclient.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import team.datacraft.dtclient.R
import team.datacraft.dtclient.data.ApiException
import team.datacraft.dtclient.data.Repo
import team.datacraft.dtclient.data.SignIn
import team.datacraft.dtclient.data.SignInCode

// Signed out: the welcome page, the sign-in form and the QR scanner. A sign-in code (QR, picture,
// pasted text or a tapped dtconnect:// link) with the username signs in at once.
@Composable
fun SignedOutScreen() {
    val t = LocalT.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var page by rememberSaveable { mutableStateOf("welcome") }
    var scanFrom by rememberSaveable { mutableStateOf("welcome") }
    var link by rememberSaveable { mutableStateOf(Repo.lastSubLink()) }
    // Only from a dtconnect:// link that names it; otherwise the app reads the account from the link.
    var username by rememberSaveable { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var info by remember { mutableStateOf("") }
    val reason by Repo.signOutReason.collectAsState()
    val pending by Repo.pendingSignIn.collectAsState()

    fun signIn(l: String, u: String) {
        busy = true
        error = ""
        scope.launch {
            try {
                Repo.login(l, u)
                Repo.ping()
            } catch (e: ApiException) {
                error = t.error(e.code)
                page = "login"
            } catch (e: Exception) {
                error = t.error("unexpected")
                page = "login"
            } finally {
                busy = false
            }
        }
    }

    // The link alone signs in; a dtconnect:// link's username, if it has one, goes along.
    fun use(code: SignInCode) {
        link = code.subLink
        username = code.username
        error = ""
        info = ""
        page = "login"
        signIn(code.subLink, code.username)
    }

    fun scanned(text: String) {
        val code = SignIn.parse(text)
        if (code == null) {
            error = t("notSignInCode")
            page = scanFrom
        } else {
            use(code)
        }
    }

    val pickImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            scope.launch {
                val text = withContext(Dispatchers.Default) { QrImage.decode(context, uri) }
                if (text == null) {
                    error = t("noQrInImage")
                    if (page == "scan") page = scanFrom
                } else {
                    scanned(text)
                }
            }
        }
    }

    LaunchedEffect(pending) {
        val code = pending ?: return@LaunchedEffect
        Repo.pendingSignIn.value = null
        use(code)
    }
    BackHandler(enabled = page != "welcome") { page = if (page == "scan") scanFrom else "welcome" }

    val shownError = error.ifEmpty { if (reason.isNotEmpty()) t.error(reason) else "" }
    when (page) {
        "scan" -> ScannerScreen(message = "", onResult = { scanned(it) }, onImage = { pickImage.launch("image/*") }, onClose = { page = scanFrom })
        "login" -> LoginPage(
            link = link,
            onLink = {
                link = it
                username = ""
            },
            error = shownError,
            info = info,
            busy = busy,
            onBack = { page = "welcome" },
            onSubmit = { signIn(link, username) },
            onPaste = { text ->
                val code = SignIn.parse(text)
                if (code != null) use(code) else link = text.trim()
            },
            onScan = {
                scanFrom = "login"
                page = "scan"
            },
            onImage = { pickImage.launch("image/*") },
        )
        else -> WelcomePage(
            error = shownError,
            onLogin = {
                error = ""
                page = "login"
            },
            onScan = {
                error = ""
                scanFrom = "welcome"
                page = "scan"
            },
        )
    }
    if (busy && page != "login") BusyVeil(t("signingIn"))
}

@Composable
private fun BusyVeil(text: String) {
    Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.6f)).clickable(enabled = true) {}, contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            CircularProgressIndicator(color = Palette.teal)
            Text(text, color = Color.White, fontSize = 16.sp)
        }
    }
}

@Composable
fun LanguageChip() {
    val c = LocalDt.current
    val settings by Repo.settings.collectAsState()
    val other = if (settings.language == "fa") "English" else "فارسی"
    Row(
        Modifier.clip(RoundedCornerShape(50)).background(c.card).clickable { Repo.updateSettings { it.copy(language = if (it.language == "fa") "en" else "fa") } }
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(painterResource(R.drawable.ic_language), null, tint = c.text, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(8.dp))
        Text(other, color = c.text, fontSize = 14.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun WelcomePage(error: String, onLogin: () -> Unit, onScan: () -> Unit) {
    val t = LocalT.current
    val c = LocalDt.current
    var help by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal = 20.dp)) {
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            LanguageChip()
            Spacer(Modifier.weight(1f))
            CircleIconButton(R.drawable.ic_help, t("helpTitle"), size = 52.dp) { help = true }
        }
        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) { OnboardingArt() }
        Text(t("onboardTitle"), fontSize = 26.sp, lineHeight = 38.sp, fontWeight = FontWeight.Bold, color = c.text, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        Text(t("onboardText"), fontSize = 16.sp, lineHeight = 26.sp, color = c.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        if (error.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            MessageText(error, true)
        }
        Spacer(Modifier.height(24.dp))
        PrimaryButton(t("logIn"), onClick = onLogin)
        Spacer(Modifier.height(12.dp))
        SecondaryButton(t("scanQr"), icon = R.drawable.ic_qr, onClick = onScan)
        TextButton(onClick = { help = true }, modifier = Modifier.align(Alignment.CenterHorizontally).padding(vertical = 6.dp)) {
            Text(t("whereDetails"), color = c.accent, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        }
    }
    if (help) HelpSheet { help = false }
}

// The welcome picture: the map inside a phone, the DT Connect mark, and the two states it brings.
@Composable
private fun OnboardingArt() {
    val c = LocalDt.current
    val t = LocalT.current
    val context = LocalContext.current
    val dots = remember {
        listOf("DE", "NL", "FI", "TR", "AE", "GB", "FR", "AM", "SE").mapNotNull { code ->
            Geo.point(context, code)?.let { MapDot(code, it, DotKind.Server) }
        }
    }
    val focus = remember { Geo.point(context, "TR") ?: Offset(0.6f, 0.33f) }
    // Drawn at 320 × 330 and scaled to the room the page leaves, so short phones keep it whole.
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val scale = minOf(maxWidth / 320.dp, maxHeight / 330.dp, 1.15f)
        Box(Modifier.requiredSize(320.dp, 330.dp).graphicsLayer { scaleX = scale; scaleY = scale }) {
            ArtPieces(c, t, dots, focus)
        }
    }
}

@Composable
private fun ArtPieces(c: DtColors, t: Strings, dots: List<MapDot>, focus: Offset) {
    Box(Modifier.size(320.dp, 330.dp)) {
        Box(
            Modifier.align(Alignment.Center).size(220.dp, 300.dp).clip(RoundedCornerShape(38.dp)).background(c.sea)
                .border(3.dp, c.line, RoundedCornerShape(38.dp)),
        ) {
            WorldMap(focus, dots, Modifier.fillMaxSize(), zoom = 3.4f, anchorY = 0.45f)
            Box(
                Modifier.align(Alignment.Center).size(170.dp).background(Brush.radialGradient(listOf(Palette.teal.copy(alpha = 0.45f), Color.Transparent))),
            )
            Image(painterResource(if (c.dark) R.drawable.dt_mark_reversed else R.drawable.dt_mark), null, Modifier.align(Alignment.Center).size(88.dp))
        }
        Row(
            Modifier.align(Alignment.TopStart).offset(y = 34.dp).shadow(12.dp, RoundedCornerShape(20.dp)).clip(RoundedCornerShape(20.dp))
                .background(if (c.dark) Color(0xFFF7FAFC) else Color.White).padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(42.dp).clip(CircleShape).border(2.dp, Palette.teal, CircleShape), contentAlignment = Alignment.Center) {
                Icon(painterResource(R.drawable.ic_lock), null, tint = Palette.teal, modifier = Modifier.size(22.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column {
                Text(t("status"), color = Color(0xFF5B7183), fontSize = 12.sp)
                Text(t("secured"), color = Color(0xFF0F8F82), fontSize = 16.sp, fontWeight = FontWeight.Bold)
            }
        }
        Row(
            Modifier.align(Alignment.BottomEnd).offset(y = (-26).dp).shadow(12.dp, RoundedCornerShape(20.dp)).clip(RoundedCornerShape(20.dp))
                .background(if (c.dark) Color(0xFFF7FAFC) else Color.White).padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Image(painterResource(R.drawable.dt_mark), null, Modifier.size(30.dp))
            Spacer(Modifier.width(8.dp))
            Column {
                Text("DT Connect", color = Palette.navy, fontSize = 14.sp, fontWeight = FontWeight.Bold)
                Text(t("fastest"), color = Color(0xFF5B7183), fontSize = 11.sp)
            }
            Spacer(Modifier.width(10.dp))
            Switch(checked = true, onCheckedChange = null, colors = SwitchDefaults.colors(checkedTrackColor = Palette.teal, checkedThumbColor = Color.White))
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HelpSheet(onClose: () -> Unit) {
    val t = LocalT.current
    val c = LocalDt.current
    ModalBottomSheet(onDismissRequest = onClose, containerColor = c.card) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            IconTile(R.drawable.ic_qr, size = 52.dp)
            Text(t("helpTitle"), fontSize = 22.sp, fontWeight = FontWeight.Bold, color = c.text)
            Text(t("helpText"), fontSize = 15.sp, lineHeight = 26.sp, color = c.muted)
            PrimaryButton(t("gotIt"), onClick = onClose)
        }
    }
}

@Composable
private fun LoginPage(
    link: String,
    onLink: (String) -> Unit,
    error: String,
    info: String,
    busy: Boolean,
    onBack: () -> Unit,
    onSubmit: () -> Unit,
    onPaste: (String) -> Unit,
    onScan: () -> Unit,
    onImage: () -> Unit,
) {
    val t = LocalT.current
    val c = LocalDt.current
    val clipboard = LocalClipboardManager.current
    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = c.button,
        unfocusedBorderColor = c.line,
        focusedLabelColor = c.accent,
        unfocusedLabelColor = c.muted,
        cursorColor = c.button,
        focusedContainerColor = c.card,
        unfocusedContainerColor = c.card,
    )
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            CircleIconButton(R.drawable.ic_back, t("back"), size = 52.dp, onClick = onBack)
            Spacer(Modifier.weight(1f))
            LanguageChip()
        }
        Spacer(Modifier.height(8.dp))
        Image(painterResource(if (c.dark) R.drawable.dt_lockup_reversed else R.drawable.dt_lockup), "DT Connect", Modifier.height(44.dp))
        Spacer(Modifier.height(4.dp))
        Text(t("signInTitle"), fontSize = 24.sp, fontWeight = FontWeight.Bold, color = c.text)
        Text(t("signInHint"), fontSize = 15.sp, lineHeight = 24.sp, color = c.muted)
        Ltr {
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                OutlinedTextField(
                    value = link,
                    onValueChange = onLink,
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text(t("subLink")) },
                    singleLine = true,
                    shape = RoundedCornerShape(18.dp),
                    colors = fieldColors,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    trailingIcon = {
                        IconButton(onClick = { clipboard.getText()?.text?.let(onPaste) }) {
                            Icon(painterResource(R.drawable.ic_paste), t("paste"), tint = c.accent)
                        }
                    },
                )
            }
        }
        MessageText(info, false)
        MessageText(error, true)
        PrimaryButton(if (busy) t("signingIn") else t("signIn"), enabled = link.isNotBlank(), loading = busy, onClick = onSubmit)
        Row(verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f), color = c.line)
            Text(t("or"), color = c.muted, modifier = Modifier.padding(horizontal = 12.dp))
            HorizontalDivider(Modifier.weight(1f), color = c.line)
        }
        SecondaryButton(t("scanWithCamera"), icon = R.drawable.ic_qr, onClick = onScan)
        SecondaryButton(t("chooseImage"), icon = R.drawable.ic_image, onClick = onImage)
        Spacer(Modifier.height(12.dp))
    }
}
