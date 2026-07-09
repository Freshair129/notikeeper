package com.example.notikeeper

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Quiet-luxury palette: washi paper / sumi ink, one accent (ai-iro indigo).
 * Semantic colors (good/critical) are a deliberately different hue from the
 * accent so status never gets mistaken for emphasis.
 */
private object NotiColors {
    // Light — washi paper
    val LightBg = Color(0xFFF7F5F1)
    val LightSurface = Color(0xFFFFFFFF)
    val LightSurfaceVariant = Color(0xFFEFECE4)
    val LightOutline = Color(0xFFE1DCD1)
    val LightInk = Color(0xFF1C1B19)
    val LightInkDim = Color(0xFF6B675F)
    val LightAccent = Color(0xFF2B3A55)       // ai-iro
    val LightOnAccent = Color(0xFFF7F5F1)
    val LightAccentContainer = Color(0xFFDCE1EA)
    val LightGood = Color(0xFF5B6D53)         // moss
    val LightOnGood = Color(0xFFF7F5F1)
    val LightCritical = Color(0xFFB5482A)     // shu
    val LightOnCritical = Color(0xFFF7F5F1)

    // Dark — sumi ink
    val DarkBg = Color(0xFF17181A)
    val DarkSurface = Color(0xFF1F2123)
    val DarkSurfaceVariant = Color(0xFF101112)
    val DarkOutline = Color(0xFF2C2E30)
    val DarkInk = Color(0xFFEDEAE3)
    val DarkInkDim = Color(0xFFA19C90)
    val DarkAccent = Color(0xFF93A8CC)        // soft indigo mist — lightened for AA contrast on dark
    val DarkOnAccent = Color(0xFF17181A)
    val DarkAccentContainer = Color(0xFF2E3A4E)
    val DarkGood = Color(0xFF8CA37E)
    val DarkOnGood = Color(0xFF17181A)
    val DarkCritical = Color(0xFFD08064)
    val DarkOnCritical = Color(0xFF17181A)
}

private val NotiLightScheme = lightColorScheme(
    background = NotiColors.LightBg,
    onBackground = NotiColors.LightInk,
    surface = NotiColors.LightSurface,
    onSurface = NotiColors.LightInk,
    surfaceVariant = NotiColors.LightSurfaceVariant,
    onSurfaceVariant = NotiColors.LightInkDim,
    outline = NotiColors.LightOutline,
    outlineVariant = NotiColors.LightOutline,
    primary = NotiColors.LightAccent,
    onPrimary = NotiColors.LightOnAccent,
    primaryContainer = NotiColors.LightAccentContainer,
    onPrimaryContainer = NotiColors.LightAccent,
    secondary = NotiColors.LightAccent,
    onSecondary = NotiColors.LightOnAccent,
    tertiary = NotiColors.LightGood,
    onTertiary = NotiColors.LightOnGood,
    error = NotiColors.LightCritical,
    onError = NotiColors.LightOnCritical,
    surfaceTint = NotiColors.LightAccent,
)

private val NotiDarkScheme = darkColorScheme(
    background = NotiColors.DarkBg,
    onBackground = NotiColors.DarkInk,
    surface = NotiColors.DarkSurface,
    onSurface = NotiColors.DarkInk,
    surfaceVariant = NotiColors.DarkSurfaceVariant,
    onSurfaceVariant = NotiColors.DarkInkDim,
    outline = NotiColors.DarkOutline,
    outlineVariant = NotiColors.DarkOutline,
    primary = NotiColors.DarkAccent,
    onPrimary = NotiColors.DarkOnAccent,
    primaryContainer = NotiColors.DarkAccentContainer,
    onPrimaryContainer = NotiColors.DarkAccent,
    secondary = NotiColors.DarkAccent,
    onSecondary = NotiColors.DarkOnAccent,
    tertiary = NotiColors.DarkGood,
    onTertiary = NotiColors.DarkOnGood,
    error = NotiColors.DarkCritical,
    onError = NotiColors.DarkOnCritical,
    surfaceTint = NotiColors.DarkAccent,
)

/**
 * One font family everywhere — restraint over decoration. Uses the system
 * default, which already renders Thai through the OS's bundled Noto Sans Thai
 * fallback at zero APK cost. Swap this line for a bundled IBM Plex Sans Thai
 * FontFamily later if the branded typeface is worth ~200-400KB per weight.
 */
private val NotiFontFamily = FontFamily.Default

private val NotiTypography = Typography().let { base ->
    base.copy(
        displayLarge = base.displayLarge.copy(fontFamily = NotiFontFamily),
        displayMedium = base.displayMedium.copy(fontFamily = NotiFontFamily),
        displaySmall = base.displaySmall.copy(fontFamily = NotiFontFamily),
        headlineLarge = base.headlineLarge.copy(fontFamily = NotiFontFamily),
        headlineMedium = base.headlineMedium.copy(fontFamily = NotiFontFamily),
        headlineSmall = base.headlineSmall.copy(fontFamily = NotiFontFamily),
        titleLarge = base.titleLarge.copy(fontFamily = NotiFontFamily),
        titleMedium = base.titleMedium.copy(fontFamily = NotiFontFamily),
        titleSmall = base.titleSmall.copy(fontFamily = NotiFontFamily),
        bodyLarge = base.bodyLarge.copy(fontFamily = NotiFontFamily),
        bodyMedium = base.bodyMedium.copy(fontFamily = NotiFontFamily),
        bodySmall = base.bodySmall.copy(fontFamily = NotiFontFamily),
        labelLarge = base.labelLarge.copy(fontFamily = NotiFontFamily),
        labelMedium = base.labelMedium.copy(fontFamily = NotiFontFamily),
        labelSmall = base.labelSmall.copy(fontFamily = NotiFontFamily),
    )
}

/** Tabular-figure style for stats/timestamps — outside the fixed Typography role set. */
val MonoDataStyle = TextStyle(
    fontFamily = FontFamily.Monospace,
    fontWeight = FontWeight.Medium,
    fontSize = 14.sp,
)

private val NotiShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(10.dp),
    large = RoundedCornerShape(14.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

@Composable
fun NotiKeeperTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (darkTheme) NotiDarkScheme else NotiLightScheme,
        typography = NotiTypography,
        shapes = NotiShapes,
        content = content
    )
}
