package team.datacraft.dtclient.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
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

object Palette {
    val accentDark = Color(0xFF36CFC0)
    val accentLight = Color(0xFF0E9384)
    val ok = Color(0xFF2FD085)
    val bad = Color(0xFFFF5D5D)
    val warn = Color(0xFFF5B83D)
    val critical = listOf(Color(0xFFE5484D), Color(0xFFC62F3A))
    val warning = listOf(Color(0xFFF7C04A), Color(0xFFEF9F27))
}

private val darkScheme = darkColorScheme(
    primary = Palette.accentDark,
    onPrimary = Color(0xFF04201F),
    background = Color(0xFF111317),
    onBackground = Color(0xFFF1F3F7),
    surface = Color(0xFF1B1E24),
    onSurface = Color(0xFFF1F3F7),
    surfaceVariant = Color(0xFF252932),
    onSurfaceVariant = Color(0xFF98A1B3),
    outline = Color(0xFF2A2F38),
)

private val lightScheme = lightColorScheme(
    primary = Palette.accentLight,
    onPrimary = Color.White,
    background = Color(0xFFF3F4F7),
    onBackground = Color(0xFF14161B),
    surface = Color.White,
    onSurface = Color(0xFF14161B),
    surfaceVariant = Color(0xFFEEF0F4),
    onSurfaceVariant = Color(0xFF5D6676),
    outline = Color(0xFFE3E6EC),
)

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
    MaterialTheme(colorScheme = if (dark) darkScheme else lightScheme, typography = Typography().inFamily(Vazirmatn), content = content)
}
