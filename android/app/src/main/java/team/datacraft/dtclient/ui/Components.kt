package team.datacraft.dtclient.ui

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDirection
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import team.datacraft.dtclient.R
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// The building blocks every page shares: cards, buttons, rows and flags.

@Composable
fun DtCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, padding: Dp = 14.dp, content: @Composable ColumnScope.() -> Unit) {
    val c = LocalDt.current
    var m = modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(c.card)
    if (onClick != null) m = m.clickable(onClick = onClick)
    Column(m.padding(padding), content = content)
}

@Composable
fun PageTitle(text: String) {
    Text(text, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = LocalDt.current.text, modifier = Modifier.padding(top = 8.dp, bottom = 2.dp))
}

@Composable
fun SectionHeader(title: String, action: String? = null, onAction: (() -> Unit)? = null) {
    val c = LocalDt.current
    Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(title, fontSize = 15.sp, color = c.muted, modifier = Modifier.weight(1f))
        if (action != null && onAction != null) {
            Row(Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClick = onAction).padding(horizontal = 6.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(action, fontSize = 14.sp, color = c.text, fontWeight = FontWeight.Medium)
                Spacer(Modifier.width(2.dp))
                Icon(painterResource(R.drawable.ic_chevron_end), null, tint = c.text, modifier = Modifier.size(16.dp))
            }
        }
    }
}

@Composable
fun PrimaryButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, loading: Boolean = false, onClick: () -> Unit) {
    val c = LocalDt.current
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        shape = RoundedCornerShape(50),
        colors = ButtonDefaults.buttonColors(containerColor = c.button, contentColor = c.onButton, disabledContainerColor = c.button.copy(alpha = 0.45f), disabledContentColor = c.onButton.copy(alpha = 0.7f)),
        modifier = modifier.fillMaxWidth().height(48.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(18.dp), color = c.onButton, strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
        }
        Text(text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun SecondaryButton(text: String, modifier: Modifier = Modifier, icon: Int? = null, color: Color? = null, onClick: () -> Unit) {
    val c = LocalDt.current
    val ink = color ?: c.text
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(50),
        border = BorderStroke(1.5.dp, if (color != null) color.copy(alpha = 0.6f) else c.line),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = ink),
        modifier = modifier.fillMaxWidth().height(48.dp),
    ) {
        if (icon != null) {
            Icon(painterResource(icon), null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(text, fontSize = 15.sp, fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun CircleIconButton(icon: Int, description: String, modifier: Modifier = Modifier, size: Dp = 42.dp, background: Color? = null, tint: Color? = null, onClick: () -> Unit) {
    val c = LocalDt.current
    Box(
        modifier.size(size).clip(CircleShape).background(background ?: c.card).clickable(onClick = onClick)
            .semantics { contentDescription = description; role = Role.Button },
        contentAlignment = Alignment.Center,
    ) {
        Icon(painterResource(icon), null, tint = tint ?: c.text, modifier = Modifier.size(size * 0.46f))
    }
}

@Composable
fun IconTile(icon: Int, modifier: Modifier = Modifier, size: Dp = 40.dp, tint: Color? = null) {
    val c = LocalDt.current
    Box(modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(c.cardHigh), contentAlignment = Alignment.Center) {
        Icon(painterResource(icon), null, tint = tint ?: c.accent, modifier = Modifier.size(size * 0.5f))
    }
}

// Round flags drawn ahead from the desktop app's flag set (assets/flags, scripts/gen-android-flags.py),
// so every phone shows the same crisp, centred circle; an emoji flag is a rectangle of a different size
// on every phone and never sat right in the circle.
private val flagCache = HashMap<String, ImageBitmap?>()

private fun flagKey(code: String) = code.lowercase().let { if (it == "uk") "gb" else it }

fun cachedFlag(code: String): ImageBitmap? = synchronized(flagCache) { flagCache[flagKey(code)] }

fun flagBitmap(context: Context, code: String): ImageBitmap? {
    val key = flagKey(code)
    if (key.length != 2) return null
    return synchronized(flagCache) {
        flagCache.getOrPut(key) {
            runCatching { context.assets.open("flags/$key.webp").use { BitmapFactory.decodeStream(it)?.asImageBitmap() } }.getOrNull()
        }
    }
}

// A flag as a round badge, like the location lists of the big VPN apps; a globe when the country is unknown.
@Composable
fun FlagCircle(code: String, size: Dp = 36.dp) {
    val c = LocalDt.current
    val context = LocalContext.current
    // Decoded off the main thread: the first scroll through the location list decoded each flag in the frame.
    val bitmap by produceState(cachedFlag(code), code) { value = withContext(Dispatchers.IO) { flagBitmap(context, code) } }
    val flag = bitmap
    Box(Modifier.size(size).clip(CircleShape).background(c.cardHigh), contentAlignment = Alignment.Center) {
        if (flag == null) {
            Icon(painterResource(R.drawable.ic_globe), null, tint = c.muted, modifier = Modifier.size(size * 0.55f))
        } else {
            Image(flag, null, Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
        }
    }
}

@Composable
fun StatusPill(text: String, good: Boolean) {
    val c = LocalDt.current
    val color = if (good) c.secured else c.unsecured
    Text(
        text,
        color = color,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 12.dp, vertical = 4.dp),
    )
}

@Composable
fun ToggleRow(icon: Int, title: String, hint: String, value: Boolean, onChange: (Boolean) -> Unit) {
    val c = LocalDt.current
    Row(Modifier.fillMaxWidth().clickable { onChange(!value) }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTile(icon, size = 38.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = c.text)
            if (hint.isNotEmpty()) Text(hint, fontSize = 12.sp, color = c.muted, lineHeight = 18.sp)
        }
        Spacer(Modifier.width(8.dp))
        Switch(
            checked = value,
            onCheckedChange = onChange,
            colors = SwitchDefaults.colors(checkedTrackColor = c.button, checkedThumbColor = c.onButton, uncheckedTrackColor = c.cardHigh, uncheckedBorderColor = c.line, uncheckedThumbColor = c.muted),
        )
    }
}

@Composable
fun NavRow(icon: Int, title: String, subtitle: String = "", color: Color? = null, trailing: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val c = LocalDt.current
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTile(icon, size = 38.dp, tint = color)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = color ?: c.text)
            if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 12.sp, color = c.muted, lineHeight = 18.sp)
        }
        if (trailing != null) trailing() else Icon(painterResource(R.drawable.ic_chevron_end), null, tint = c.muted, modifier = Modifier.size(20.dp))
    }
}

@Composable
fun ChoiceChips(options: List<Pair<String, String>>, value: String, onChange: (String) -> Unit) {
    val c = LocalDt.current
    LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        items(options.size) { i ->
            val (key, label) = options[i]
            val on = key == value
            Text(
                label,
                color = if (on) c.text else c.muted,
                fontWeight = if (on) FontWeight.Bold else FontWeight.Medium,
                fontSize = 14.sp,
                modifier = Modifier.clip(RoundedCornerShape(50))
                    .background(if (on) c.button.copy(alpha = 0.16f) else c.cardHigh)
                    .border(1.5.dp, if (on) c.button else Color.Transparent, RoundedCornerShape(50))
                    .clickable { onChange(key) }
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}

@Composable
fun MessageText(text: String, error: Boolean) {
    if (text.isEmpty()) return
    val c = LocalDt.current
    Text(
        text,
        color = if (error) c.unsecured else c.accent,
        fontSize = 14.sp,
        lineHeight = 22.sp,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background((if (error) c.unsecured else c.accent).copy(alpha = 0.1f)).padding(12.dp),
    )
}

// Links, usernames and numbers read left to right inside Persian pages.
@Composable
fun Ltr(content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr, content = content)
}

// Notices are written in Persian, so they are right to left in Vazirmatn whatever the app's language.
@Composable
fun NoticeText(body: String, color: Color, size: Int = 14) {
    CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
        Text(
            body,
            modifier = Modifier.fillMaxWidth(),
            style = TextStyle(fontFamily = Vazirmatn, fontSize = size.sp, lineHeight = (size * 1.8).sp, color = color, textDirection = TextDirection.Rtl, textAlign = TextAlign.Start),
        )
    }
}
