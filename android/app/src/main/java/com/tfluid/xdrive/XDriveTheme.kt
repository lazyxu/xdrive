package com.tfluid.xdrive

import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

internal val LocalXDriveDarkTheme = staticCompositionLocalOf { false }

@Composable
fun XDriveTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (darkTheme) darkColorScheme(
        primary = Color(SharedVisuals.darkPrimary), onPrimary = Color(SharedVisuals.darkOnPrimary),
        background = Color(SharedVisuals.darkBackground), onBackground = Color(SharedVisuals.darkText),
        surface = Color(SharedVisuals.darkSurface), onSurface = Color(SharedVisuals.darkText),
        surfaceVariant = Color(SharedVisuals.darkSurface), onSurfaceVariant = Color(SharedVisuals.darkSecondaryText),
        surfaceContainerLowest = Color(SharedVisuals.darkBackground), surfaceContainerLow = Color(SharedVisuals.darkSurface),
        surfaceContainer = Color(SharedVisuals.darkSurface), surfaceContainerHigh = Color(SharedVisuals.darkSurface),
        surfaceContainerHighest = Color(SharedVisuals.darkSurface),
        outline = Color(SharedVisuals.darkDivider), outlineVariant = Color(SharedVisuals.darkDivider),
        error = Color(SharedVisuals.darkError), surfaceTint = Color.Transparent,
    ) else lightColorScheme(
        primary = Color(SharedVisuals.lightPrimary), onPrimary = Color(SharedVisuals.lightOnPrimary),
        background = Color(SharedVisuals.lightBackground), onBackground = Color(SharedVisuals.lightText),
        surface = Color(SharedVisuals.lightSurface), onSurface = Color(SharedVisuals.lightText),
        surfaceVariant = Color(SharedVisuals.lightSurface), onSurfaceVariant = Color(SharedVisuals.lightSecondaryText),
        surfaceContainerLowest = Color(SharedVisuals.lightBackground), surfaceContainerLow = Color(SharedVisuals.lightSurface),
        surfaceContainer = Color(SharedVisuals.lightSurface), surfaceContainerHigh = Color(SharedVisuals.lightSurface),
        surfaceContainerHighest = Color(SharedVisuals.lightSurface),
        outline = Color(SharedVisuals.lightDivider), outlineVariant = Color(SharedVisuals.lightDivider),
        error = Color(SharedVisuals.lightError), surfaceTint = Color.Transparent,
    )
    CompositionLocalProvider(LocalXDriveDarkTheme provides darkTheme) {
        MaterialTheme(
            colorScheme = colors,
            typography = Typography(),
            shapes = Shapes(
                extraSmall = RoundedCornerShape(4.dp), small = RoundedCornerShape(10.dp),
                medium = RoundedCornerShape(10.dp), large = RoundedCornerShape(14.dp),
                extraLarge = RoundedCornerShape(14.dp),
            ), content = content,
        )
    }
}

@Composable
fun XDriveBrand(modifier: Modifier = Modifier, size: Dp = 34.dp) {
    Image(
        painterResource(R.drawable.xdrive_brand), contentDescription = "xDrive",
        modifier = modifier.size(size).clip(RoundedCornerShape(size * (242f / 1024f))),
    )
}
