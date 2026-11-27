package team.datacraft.dtclient.ui

import android.content.Context
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asComposePath
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.graphics.PathParser
import kotlin.math.PI
import kotlin.math.ln
import kotlin.math.tan
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

// The world map of the home page: Natural Earth's countries in the same Mercator the desktop app
// draws (scripts/gen-map.mjs writes both), and each country's centre and its English and Persian name.
object Geo {
    data class Country(val lat: Double, val lon: Double, val en: String, val fa: String)

    private class Table(val width: Double, val height: Double, val scale: Double, val ty: Double, val countries: Map<String, Country>)

    @Volatile private var table: Table? = null
    @Volatile private var land: Path? = null

    private fun table(context: Context): Table = table ?: synchronized(this) {
        table ?: run {
            val o = JSONObject(context.assets.open("map/countries.json").bufferedReader().use { it.readText() })
            val map = o.getJSONObject("map")
            val list = o.getJSONObject("countries")
            val countries = HashMap<String, Country>()
            for (code in list.keys()) {
                val c = list.getJSONObject(code)
                countries[code] = Country(c.optDouble("lat"), c.optDouble("lon"), c.optString("en"), c.optString("fa"))
            }
            Table(map.getDouble("width"), map.getDouble("height"), map.getDouble("scale"), map.getDouble("ty"), countries).also { table = it }
        }
    }

    val ratio: Float get() = (table?.let { it.height / it.width } ?: 0.663).toFloat()

    fun name(context: Context, code: String, language: String): String {
        val c = table(context).countries[code.uppercase()] ?: return ""
        return if (language == "en") c.en else c.fa
    }

    // A country's centre as fractions of the map's width and height.
    fun point(context: Context, code: String): Offset? {
        val t = table(context)
        val c = t.countries[code.uppercase()] ?: return null
        if (c.lat == 0.0 && c.lon == 0.0) return null
        return project(t, c.lat, c.lon)
    }

    fun project(context: Context, lat: Double, lon: Double): Offset = project(table(context), lat, lon)

    private fun project(t: Table, lat: Double, lon: Double): Offset {
        val x = (t.width / 2 + t.scale * (lon * PI / 180)) / t.width
        val y = (t.ty - t.scale * ln(tan(PI / 4 + lat * PI / 360))) / t.height
        return Offset(x.toFloat(), y.toFloat())
    }

    fun landOrNull(): Path? = land

    // Parsing the land takes a moment, so it happens once, off the main thread.
    fun land(context: Context): Path = land ?: synchronized(this) {
        land ?: run {
            val all = android.graphics.Path()
            context.assets.open("map/world.txt").bufferedReader().useLines { lines ->
                lines.filter { it.isNotBlank() }.forEach { d -> runCatching { all.addPath(PathParser.createPathFromPathData(d)) } }
            }
            all.asComposePath().also { land = it }
        }
    }

    const val WIDTH = 1000f
}

enum class DotKind { Server, Selected, Connected }

data class MapDot(val key: String, val at: Offset, val kind: DotKind)

private class MapFrame(val tx: Float, val ty: Float, val w: Float, val h: Float)

private fun mapFrame(width: Float, height: Float, zoom: Float, anchorX: Float, anchorY: Float, fx: Float, fy: Float): MapFrame {
    val w = width * zoom
    val h = w * Geo.ratio
    val tx = (width * anchorX - fx * w).coerceIn(width - w, 0f)
    val lowY = minOf(0f, height - h)
    val ty = (height * anchorY - fy * h).coerceIn(lowY, maxOf(lowY, 0f))
    return MapFrame(tx, ty, w, h)
}

// focus is held at (anchorX, anchorY) of the frame and glides there when it changes; the map never shows its edge.
@Composable
fun WorldMap(focus: Offset, dots: List<MapDot>, modifier: Modifier = Modifier, zoom: Float = 2.6f, anchorX: Float = 0.5f, anchorY: Float = 0.36f) {
    val c = LocalDt.current
    val context = LocalContext.current
    var land by remember { mutableStateOf(Geo.landOrNull()) }
    LaunchedEffect(Unit) {
        if (land == null) land = withContext(Dispatchers.Default) { runCatching { Geo.land(context) }.getOrNull() }
    }
    val fx by animateFloatAsState(focus.x, tween(900, easing = FastOutSlowInEasing), label = "focusX")
    val fy by animateFloatAsState(focus.y, tween(900, easing = FastOutSlowInEasing), label = "focusY")
    // Only a connected dot pulses, so an idle map draws no frames.
    val pulsing = if (dots.any { it.kind == DotKind.Connected }) {
        rememberInfiniteTransition(label = "pulse").animateFloat(0f, 1f, infiniteRepeatable(tween(1800, easing = LinearEasing), RepeatMode.Restart), label = "pulse")
    } else {
        null
    }
    Box(modifier) {
        // The countries are a layer of their own, kept as a texture: the pulse redraws only the dots,
        // where it used to fill and stroke the whole world's outline on every frame.
        Canvas(Modifier.matchParentSize().graphicsLayer { compositingStrategy = CompositingStrategy.Offscreen }) {
            val f = mapFrame(size.width, size.height, zoom, anchorX, anchorY, fx, fy)
            val s = f.w / Geo.WIDTH
            land?.let { path ->
                withTransform({
                    translate(f.tx, f.ty)
                    scale(s, s, pivot = Offset.Zero)
                }) {
                    drawPath(path, c.land)
                    drawPath(path, c.sea.copy(alpha = 0.55f), style = Stroke(width = 0.5f))
                }
            }
        }
        Canvas(Modifier.matchParentSize()) {
            val f = mapFrame(size.width, size.height, zoom, anchorX, anchorY, fx, fy)
            for (d in dots) {
                val p = Offset(f.tx + d.at.x * f.w, f.ty + d.at.y * f.h)
                when (d.kind) {
                    DotKind.Server -> {
                        drawCircle(c.accent.copy(alpha = 0.18f), radius = 9.dp.toPx(), center = p)
                        drawCircle(c.accent.copy(alpha = 0.9f), radius = 4.dp.toPx(), center = p)
                    }
                    DotKind.Selected -> {
                        drawCircle(c.accent.copy(alpha = 0.22f), radius = 14.dp.toPx(), center = p)
                        drawCircle(c.accent, radius = 6.dp.toPx(), center = p)
                        drawCircle(c.sea, radius = 2.5.dp.toPx(), center = p)
                    }
                    DotKind.Connected -> {
                        val pulse = pulsing?.value ?: 0f
                        drawCircle(c.secured.copy(alpha = 0.45f * (1 - pulse)), radius = (8 + 26 * pulse).dp.toPx(), center = p)
                        drawCircle(c.secured.copy(alpha = 0.25f), radius = 12.dp.toPx(), center = p)
                        drawCircle(c.secured, radius = 6.dp.toPx(), center = p)
                    }
                }
            }
        }
    }
}
