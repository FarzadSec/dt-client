package team.datacraft.dtclient.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import team.datacraft.dtclient.R

// Vazirmatn carries Latin letters too, so one family serves both languages.
val Vazirmatn = FontFamily(
    Font(R.font.vazirmatn_regular, FontWeight.Normal),
    Font(R.font.vazirmatn_medium, FontWeight.Medium),
    Font(R.font.vazirmatn_bold, FontWeight.Bold),
)

// DT Connect's colours: navy and teal, from the logo.
object Palette {
    val navy = Color(0xFF0B2B40)
    val teal = Color(0xFF1FB6A6)
    val tealBright = Color(0xFF34D1C0)
    val ok = Color(0xFF1FB6A6)
    val bad = Color(0xFFFF6B6B)
    val warn = Color(0xFFF5B83D)
    val critical = listOf(Color(0xFFE5484D), Color(0xFFC62F3A))
    val warning = listOf(Color(0xFFF7C04A), Color(0xFFEF9F27))
}

@Immutable
data class DtColors(
    val dark: Boolean,
    val background: Color,
    val card: Color,
    val cardHigh: Color,
    val line: Color,
    val text: Color,
    val muted: Color,
    val accent: Color,
    val button: Color,
    val onButton: Color,
    val sea: Color,
    val land: Color,
    val secured: Color,
    val unsecured: Color,
    val unsecuredBadge: Color,
    val securedBadge: Color,
)

val DarkDt = DtColors(
    dark = true,
    background = Color(0xFF07141D),
    card = Color(0xFF0F2131),
    cardHigh = Color(0xFF16304A),
    line = Color(0xFF1E3B52),
    text = Color(0xFFEAF2F7),
    muted = Color(0xFF8DA4B6),
    accent = Palette.tealBright,
    button = Palette.teal,
    onButton = Palette.navy,
    sea = Color(0xFF0B1B28),
    land = Color(0xFF1C3549),
    secured = Palette.tealBright,
    unsecured = Color(0xFFFF8A80),
    unsecuredBadge = Color(0xFF6E1414),
    securedBadge = Color(0xFF0E5A52),
)

val LightDt = DtColors(
    dark = false,
    background = Color(0xFFF2F5F7),
    card = Color(0xFFFFFFFF),
    cardHigh = Color(0xFFE8EEF2),
    line = Color(0xFFDCE4EA),
    text = Palette.navy,
    muted = Color(0xFF5B7183),
    accent = Color(0xFF0F8F82),
    button = Palette.teal,
    onButton = Palette.navy,
    sea = Color(0xFFDCE7EE),
    land = Color(0xFFB9CCD9),
    secured = Color(0xFF0F8F82),
    unsecured = Color(0xFFD64545),
    unsecuredBadge = Color(0xFFFFD9D6),
    securedBadge = Color(0xFFCDF1EC),
)

val LocalDt = staticCompositionLocalOf { DarkDt }

private fun scheme(c: DtColors) = if (c.dark) {
    darkColorScheme(
        primary = c.button, onPrimary = c.onButton, secondary = c.accent, background = c.background, onBackground = c.text,
        surface = c.card, onSurface = c.text, surfaceVariant = c.cardHigh, onSurfaceVariant = c.muted, outline = c.line,
        surfaceContainerLow = c.card, surfaceContainer = c.card, surfaceContainerHigh = c.cardHigh, error = Palette.bad,
    )
} else {
    lightColorScheme(
        primary = c.button, onPrimary = c.onButton, secondary = c.accent, background = c.background, onBackground = c.text,
        surface = c.card, onSurface = c.text, surfaceVariant = c.cardHigh, onSurfaceVariant = c.muted, outline = c.line,
        surfaceContainerLow = c.card, surfaceContainer = c.card, surfaceContainerHigh = c.cardHigh, error = Palette.bad,
    )
}

private fun Typography.inFamily(f: FontFamily) = Typography(
    displayLarge = displayLarge.copy(fontFamily = f),
    displayMedium = displayMedium.copy(fontFamily = f),
    displaySmall = displaySmall.copy(fontFamily = f),
    headlineLarge = headlineLarge.copy(fontFamily = f),
    headlineMedium = headlineMedium.copy(fontFamily = f),
    headlineSmall = headlineSmall.copy(fontFamily = f),
    titleLarge = titleLarge.copy(fontFamily = f),
    titleMedium = titleMedium.copy(fontFamily = f),
    titleSmall = titleSmall.copy(fontFamily = f),
    bodyLarge = bodyLarge.copy(fontFamily = f),
    bodyMedium = bodyMedium.copy(fontFamily = f),
    bodySmall = bodySmall.copy(fontFamily = f),
    labelLarge = labelLarge.copy(fontFamily = f),
    labelMedium = labelMedium.copy(fontFamily = f),
    labelSmall = labelSmall.copy(fontFamily = f),
)

@Composable
fun DtTheme(dark: Boolean, content: @Composable () -> Unit) {
    val colors = if (dark) DarkDt else LightDt
    CompositionLocalProvider(LocalDt provides colors) {
        MaterialTheme(colorScheme = scheme(colors), typography = Typography().inFamily(Vazirmatn), content = content)
    }
}
