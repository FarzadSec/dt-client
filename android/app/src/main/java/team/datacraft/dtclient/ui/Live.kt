package team.datacraft.dtclient.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Locale
import team.datacraft.dtclient.R
import team.datacraft.dtclient.data.Account
import team.datacraft.dtclient.data.LiveSample

// Bytes per second as a short rate: "1.4 MB/s".
fun rate(n: Long): String {
    if (n < 1024) return "$n B/s"
    val units = listOf("KB/s", "MB/s", "GB/s")
    var v = n / 1024.0
    var i = 0
    while (v >= 1024 && i < units.size - 1) {
        v /= 1024
        i++
    }
    return String.format(Locale.US, if (v >= 100) "%.0f %s" else "%.1f %s", v, units[i])
}

// The last minute of the connection: download and upload as areas, the ping as a dashed line, a red
// mark where the test page timed out, and the latest values above it.
@Composable
fun LiveChart(samples: List<LiveSample>, modifier: Modifier = Modifier) {
    val c = LocalDt.current
    val t = LocalT.current
    val shown = samples.takeLast(60)
    val last = shown.lastOrNull()
    val lastPing = shown.lastOrNull { it.ms != -1 }
    val timedOut = lastPing != null && lastPing.ms == null
    Column(modifier.clip(RoundedCornerShape(16.dp)).background(c.background.copy(alpha = 0.72f)).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Ltr {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Icon(painterResource(R.drawable.ic_download), null, tint = c.accent, modifier = Modifier.size(14.dp))
                Text(rate(last?.rx ?: 0), color = c.accent, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Text("↑ " + rate(last?.tx ?: 0), color = Palette.warn, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                val pingText = when {
                    timedOut -> t("timeout")
                    lastPing?.ms != null && lastPing.ms > 0 -> "${lastPing.ms} ms"
                    else -> "… ms"
                }
                Text(
                    pingText,
                    color = if (timedOut) Color.White else c.secured,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(if (timedOut) Palette.bad else c.secured.copy(alpha = 0.16f)).padding(horizontal = 8.dp, vertical = 2.dp),
                )
            }
        }
        Spacer(Modifier.height(4.dp))
        Canvas(Modifier.fillMaxWidth().height(64.dp)) {
            val n = 60
            val w = size.width
            val h = size.height
            val step = w / (n - 1)
            val offset = n - shown.size
            val peak = maxOf(64 * 1024L, shown.maxOfOrNull { maxOf(it.rx, it.tx) } ?: 0L).toFloat()
            fun x(i: Int) = (i + offset) * step
            fun y(v: Long) = h - 2f - (v / peak) * (h - 10f)
            fun area(value: (LiveSample) -> Long, color: Color) {
                if (shown.size < 2) return
                val path = Path().apply {
                    moveTo(x(0), h)
                    shown.forEachIndexed { i, s -> lineTo(x(i), y(value(s))) }
                    lineTo(x(shown.size - 1), h)
                    close()
                }
                drawPath(path, color.copy(alpha = 0.25f))
                val line = Path().apply { shown.forEachIndexed { i, s -> if (i == 0) moveTo(x(i), y(value(s))) else lineTo(x(i), y(value(s))) } }
                drawPath(line, color, style = Stroke(width = 1.5.dp.toPx()))
            }
            area({ it.rx }, c.accent)
            area({ it.tx }, Palette.warn)
            val pings = shown.mapIndexedNotNull { i, s -> if (s.ms == -1) null else i to s.ms }
            val maxMs = maxOf(300, pings.maxOfOrNull { it.second ?: 0 } ?: 0).toFloat()
            fun py(ms: Int) = 4f + (1f - minOf(1f, ms / maxMs)) * (h - 16f)
            val ok = pings.filter { it.second != null }
            if (ok.size > 1) {
                val path = Path().apply { ok.forEachIndexed { k, (i, ms) -> if (k == 0) moveTo(x(i), py(ms!!)) else lineTo(x(i), py(ms!!)) } }
                drawPath(path, c.text.copy(alpha = 0.8f), style = Stroke(width = 1.5.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 4f))))
            }
            for ((i, ms) in pings) if (ms == null) drawLine(Palette.bad, Offset(x(i), 2f), Offset(x(i), h), strokeWidth = 2.dp.toPx())
        }
    }
}

// The plan's end is near (2 days or 3 GB) or reached; shown every time the app is opened.
data class PlanWarning(val kind: String, val ended: Boolean, val left: Long)

fun planWarnings(a: Account, now: Long = System.currentTimeMillis()): List<PlanWarning> {
    val out = mutableListOf<PlanWarning>()
    if (a.expiryTime > 0) {
        val left = a.expiryTime - now
        if (left <= 2 * 86_400_000L) out += PlanWarning("expiry", left <= 0, left.coerceAtLeast(0))
    }
    if (a.total > 0) {
        val left = a.total - a.upload - a.download
        if (left <= 3L * 1024 * 1024 * 1024) out += PlanWarning("traffic", left <= 0, left.coerceAtLeast(0))
    }
    return out
}

@Composable
fun PlanWarningDialog(warnings: List<PlanWarning>, supportUrl: String, onRenew: () -> Unit, onClose: () -> Unit) {
    val c = LocalDt.current
    val t = LocalT.current
    val ended = warnings.any { it.ended }
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = c.card,
        icon = { Icon(painterResource(R.drawable.ic_alert), null, tint = if (ended) Palette.bad else Palette.warn) },
        title = { Text(t(if (ended) "warnEndedTitle" else "warnTitle"), color = c.text, fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                for (w in warnings) {
                    val line = when {
                        w.kind == "expiry" && w.ended -> t("warnExpiryEnded")
                        w.kind == "expiry" -> {
                            val hours = maxOf(1L, w.left / 3_600_000L)
                            t("warnExpiry", "n" to iso(if (hours >= 24) t("nDays", "n" to "${(w.left + 86_399_999L) / 86_400_000L}") else t("nHours", "n" to "$hours")))
                        }
                        w.ended -> t("warnTrafficEnded")
                        else -> t("warnTraffic", "n" to iso(bytes(w.left)))
                    }
                    Text(line, color = c.text, fontSize = 15.sp, lineHeight = 24.sp)
                }
                Text(t("warnHint"), color = c.muted, fontSize = 13.sp, lineHeight = 20.sp)
            }
        },
        confirmButton = {
            if (supportUrl.isNotEmpty()) TextButton(onClick = onRenew) { Text(t("renew"), color = c.accent, fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text(t("gotIt"), color = c.text) } },
    )
}

@Composable
fun LockDialog(name: String, onConnect: () -> Unit, onSkip: () -> Unit, onClose: () -> Unit) {
    val c = LocalDt.current
    val t = LocalT.current
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = c.card,
        icon = { Icon(painterResource(R.drawable.ic_lock), null, tint = Palette.bad) },
        title = { Text(t("lockHitTitle"), color = c.text, fontWeight = FontWeight.Bold) },
        text = { Text(t("lockHitText", "name" to iso(name)), color = c.text, fontSize = 15.sp, lineHeight = 24.sp) },
        confirmButton = { TextButton(onClick = onConnect) { Text(t("connectNow"), color = c.accent, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = onSkip) { Text(t("skip15"), color = c.text) } },
    )
}
