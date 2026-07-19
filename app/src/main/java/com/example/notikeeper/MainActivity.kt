package com.example.notikeeper

import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val activity = this
        setContent {
            NotiKeeperTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppRoot(activity)
                }
            }
        }
    }
}

/**
 * One-shot suppression for the re-lock-on-background check. Launching our own
 * trusted sub-activity (QR scanner, share sheet) triggers the same ON_STOP as
 * the user backgrounding the whole app — set this immediately before such a
 * launch so AppRoot skips exactly one re-lock instead of tearing down the
 * screen (and its pending activity-result callback) before the result arrives.
 */
object AppLock {
    var suppressNextLock = false
}

/** Wraps the app in a biometric/PIN lock. Re-locks every time the app is backgrounded. */
@Composable
fun AppRoot(activity: FragmentActivity) {
    var unlocked by remember { mutableStateOf(false) }

    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) {
                if (AppLock.suppressNextLock) {
                    AppLock.suppressNextLock = false
                } else {
                    unlocked = false
                }
            }
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }

    LaunchedEffect(unlocked) {
        if (!unlocked) authenticate(activity) { unlocked = true }
    }

    if (unlocked) {
        AppScreen()
    } else {
        LockScreen(onUnlock = { authenticate(activity) { unlocked = true } })
    }
}

@Composable
fun LockScreen(onUnlock: () -> Unit) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "NotiKeeper",
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.headlineSmall
            )
            Spacer(Modifier.height(8.dp))
            Text("ล็อกอยู่ — ยืนยันตัวตนเพื่อเปิด")
            Spacer(Modifier.height(16.dp))
            Button(onClick = onUnlock) { Text("ปลดล็อก") }
        }
    }
}

/** Show the system biometric / device-credential prompt; call [onSuccess] when authenticated. */
fun authenticate(activity: FragmentActivity, onSuccess: () -> Unit) {
    val authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG or
        BiometricManager.Authenticators.DEVICE_CREDENTIAL

    if (BiometricManager.from(activity).canAuthenticate(authenticators)
        != BiometricManager.BIOMETRIC_SUCCESS
    ) {
        onSuccess()
        return
    }

    val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onSuccess()
            }
        }
    )
    val info = BiometricPrompt.PromptInfo.Builder()
        .setTitle("ปลดล็อก NotiKeeper")
        .setSubtitle("ยืนยันด้วยลายนิ้วมือ หรือ PIN/รหัสเครื่อง")
        .setAllowedAuthenticators(authenticators)
        .build()
    prompt.authenticate(info)
}

private enum class Screen(val label: String, val icon: String) {
    Feed("Feed", "◆"),
    Threads("Threads", "◇"),
    Dashboard("Dashboard", "▤"),
    Settings("ตั้งค่า", "⚙")
}

@Composable
fun AppScreen() {
    var screen by remember { mutableStateOf(Screen.Feed) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                Screen.values().forEach { s ->
                    NavigationBarItem(
                        selected = screen == s,
                        onClick = { screen = s },
                        icon = { Text(s.icon) },
                        label = { Text(s.label) }
                    )
                }
            }
        }
    ) { padding ->
        Box(modifier = Modifier.padding(padding).fillMaxSize()) {
            when (screen) {
                Screen.Feed      -> FeedScreen(onNavigateToSettings = { screen = Screen.Settings })
                Screen.Threads   -> ThreadsScreen()
                Screen.Dashboard -> DashboardScreen()
                Screen.Settings  -> BackupScreen()
            }
        }
    }
}

fun isNotiAccessEnabled(ctx: Context): Boolean {
    val flat = AndroidSettings.Secure.getString(
        ctx.contentResolver,
        "enabled_notification_listeners"
    ) ?: return false
    val component = ComponentName(ctx, NotiLoggerService::class.java)
    return flat.split(":").any { it.equals(component.flattenToString(), ignoreCase = true) }
}

/** True if our AccessibilityService (screen reader) is enabled in system settings. */
fun isReaderEnabled(ctx: Context): Boolean {
    val flat = AndroidSettings.Secure.getString(
        ctx.contentResolver,
        AndroidSettings.Secure.ENABLED_ACCESSIBILITY_SERVICES
    ) ?: return false
    val component = ComponentName(ctx, MessengerReaderService::class.java)
    return flat.split(":").any { it.equals(component.flattenToString(), ignoreCase = true) }
}
