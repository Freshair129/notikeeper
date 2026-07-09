package com.example.notikeeper

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.example.notikeeper.data.NotiItem
import com.example.notikeeper.data.NotiStore
import com.example.notikeeper.data.Settings
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import org.json.JSONObject
import android.widget.Toast
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val activity = this
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppRoot(activity)
                }
            }
        }
    }
}

/** Wraps the app in a biometric/PIN lock. Re-locks every time the app is backgrounded. */
@Composable
fun AppRoot(activity: FragmentActivity) {
    var unlocked by remember { mutableStateOf(false) }

    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) unlocked = false
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

@Composable
private fun ThreadsScreen() {
    var selected by remember { mutableStateOf<NotiStore.ThreadSummary?>(null) }
    val sel = selected
    if (sel == null) {
        ThreadsListScreen(onOpen = { selected = it })
    } else {
        ThreadDetailScreen(thread = sel, onClose = { selected = null })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThreadsListScreen(onOpen: (NotiStore.ThreadSummary) -> Unit) {
    val ctx = LocalContext.current
    var threads by remember { mutableStateOf(emptyList<NotiStore.ThreadSummary>()) }
    var refreshKey by remember { mutableStateOf(0) }
    LaunchedEffect(refreshKey) {
        threads = withContext(Dispatchers.IO) { NotiStore.get(ctx).listThreads() }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("การสนทนา") },
                actions = { TextButton(onClick = { refreshKey++ }) { Text("รีเฟรช") } }
            )
        }
    ) { padding ->
        if (threads.isEmpty()) {
            Box(
                modifier = Modifier.padding(padding).fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                Text("ยังไม่มีบทสนทนาที่บันทึกไว้", color = Color.Gray)
            }
        } else {
            LazyColumn(modifier = Modifier.padding(padding).fillMaxSize()) {
                items(threads) { t -> ThreadRow(t, onClick = { onOpen(t) }) }
            }
        }
    }
}

@Composable
private fun ThreadRow(t: NotiStore.ThreadSummary, onClick: () -> Unit) {
    val formatter = remember { SimpleDateFormat("dd/MM/yy HH:mm", Locale.getDefault()) }
    Card(
        onClick = onClick,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
                contentAlignment = Alignment.Center
            ) {
                Text(t.title.trim().take(1).ifBlank { "?" }.uppercase(), fontWeight = FontWeight.Bold)
            }
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
                    Text(
                        t.title,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false)
                    )
                    Text(formatter.format(Date(t.lastTime)), style = MaterialTheme.typography.labelSmall)
                }
                Text(t.appName, style = MaterialTheme.typography.labelSmall, color = Color.Gray)
                if (t.lastText.isNotBlank()) {
                    Text(t.lastText, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                }
            }
            Spacer(Modifier.width(8.dp))
            Text(t.count.toString(), color = Color.Gray, style = MaterialTheme.typography.labelSmall)
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ThreadDetailScreen(thread: NotiStore.ThreadSummary, onClose: () -> Unit) {
    val ctx = LocalContext.current
    var messages by remember { mutableStateOf(emptyList<NotiItem>()) }
    LaunchedEffect(thread) {
        messages = withContext(Dispatchers.IO) { NotiStore.get(ctx).threadMessages(thread.pkg, thread.title) }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(thread.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(thread.appName, style = MaterialTheme.typography.labelSmall)
                    }
                },
                navigationIcon = { TextButton(onClick = onClose) { Text("‹ กลับ") } }
            )
        }
    ) { padding ->
        if (messages.isEmpty()) {
            Box(modifier = Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("กำลังโหลด...", color = Color.Gray)
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .padding(padding)
                    .fillMaxSize()
                    .padding(horizontal = 8.dp),
                reverseLayout = true
            ) {
                items(messages) { m -> MessageBubble(m) }
            }
        }
    }
}

@Composable
private fun MessageBubble(item: NotiItem) {
    val formatter = remember { SimpleDateFormat("HH:mm", Locale.getDefault()) }
    val isMe = item.side == "me"
    val bubbleColor = if (isMe) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val textColor = if (isMe) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 3.dp),
        horizontalArrangement = if (isMe) Arrangement.End else Arrangement.Start
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 280.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(bubbleColor)
                .padding(horizontal = 12.dp, vertical = 8.dp)
        ) {
            if (item.text.isNotBlank()) {
                Text(item.text, color = textColor)
            }
            Text(
                formatter.format(Date(item.postTime)),
                style = MaterialTheme.typography.labelSmall,
                color = textColor.copy(alpha = 0.7f),
                modifier = Modifier.align(if (isMe) Alignment.End else Alignment.Start)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FeedScreen(onNavigateToSettings: () -> Unit) {
    val ctx = LocalContext.current
    var query by remember { mutableStateOf("") }
    var items by remember { mutableStateOf(emptyList<NotiItem>()) }
    var selectedApp by remember { mutableStateOf<String?>(null) }
    var notiOn by remember { mutableStateOf(isNotiAccessEnabled(ctx)) }
    var readerOn by remember { mutableStateOf(isReaderEnabled(ctx)) }
    var refreshKey by remember { mutableStateOf(0) }
    var updateAvail by remember { mutableStateOf<UpdateInfo?>(null) }
    val appNames = remember(items) { items.map { it.appName }.distinct().sorted() }
    val filteredItems = remember(items, selectedApp) {
        selectedApp?.let { app -> items.filter { it.appName == app } } ?: items
    }

    LaunchedEffect(query, refreshKey) {
        items = withContext(Dispatchers.IO) { NotiStore.get(ctx).query(query) }
        notiOn = isNotiAccessEnabled(ctx)
        readerOn = isReaderEnabled(ctx)
    }

    LaunchedEffect(refreshKey) {
        runCatching { updateAvail = Updater.check(ctx) }
    }

    // Auto-upload new rows to the private endpoint, if configured.
    LaunchedEffect(refreshKey) {
        if (Settings.getAutoUpload(ctx) && Settings.getApiUrl(ctx).isNotBlank()) {
            runCatching {
                val last = Settings.getLastUploadedId(ctx)
                val fresh = withContext(Dispatchers.IO) { NotiStore.get(ctx).querySince(last) }
                if (fresh.isNotEmpty()) {
                    Exporter.uploadJson(
                        Settings.getApiUrl(ctx),
                        Settings.getApiToken(ctx),
                        Exporter.itemsToJson(fresh)
                    )
                    Settings.setLastUploadedId(ctx, fresh.maxOf { it.id })
                }
            }
        }
    }

    val owner = LocalLifecycleOwner.current
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) refreshKey++
        }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("NotiKeeper") },
                actions = {
                    TextButton(onClick = { refreshKey++ }) { Text("รีเฟรช") }
                    TextButton(onClick = {
                        NotiStore.get(ctx).clear()
                        refreshKey++
                    }) { Text("ล้าง") }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
        ) {
            updateAvail?.let { info ->
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("มีเวอร์ชันใหม่: ${info.versionName}", fontWeight = FontWeight.Bold)
                        if (info.notes.isNotBlank()) {
                            Spacer(Modifier.height(4.dp))
                            Text(info.notes, style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(Modifier.height(8.dp))
                        Button(onClick = onNavigateToSettings) { Text("ไปอัปเดต") }
                    }
                }
            }
            if (!notiOn) {
                PermissionCard(
                    title = "เปิดสิทธิ์ \"การเข้าถึงการแจ้งเตือน\"",
                    body = "เพื่อเก็บการแจ้งเตือนทุกแอปแบบเบื้องหลัง",
                    button = "เปิดสิทธิ์แจ้งเตือน",
                    onClick = { ctx.startActivity(Intent(AndroidSettings.ACTION_NOTIFICATION_LISTENER_SETTINGS)) }
                )
            }
            if (!readerOn) {
                PermissionCard(
                    title = "เปิดสิทธิ์ \"การช่วยเหลือพิเศษ\" (Accessibility)",
                    body = "เพื่ออ่านบทสนทนาเต็ม ๆ บนหน้าจอแชท (Messenger/LINE/IG/WhatsApp/Telegram) — เปิด NotiKeeper ในรายการ",
                    button = "เปิดสิทธิ์อ่านหน้าจอ",
                    onClick = { ctx.startActivity(Intent(AndroidSettings.ACTION_ACCESSIBILITY_SETTINGS)) }
                )
            }
            if (appNames.isNotEmpty()) {
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    contentPadding = PaddingValues(horizontal = 12.dp),
                    modifier = Modifier.padding(bottom = 6.dp)
                ) {
                    item {
                        FilterChip(
                            selected = selectedApp == null,
                            onClick = { selectedApp = null },
                            label = { Text("ทั้งหมด") }
                        )
                    }
                    items(appNames) { name ->
                        FilterChip(
                            selected = selectedApp == name,
                            onClick = { selectedApp = if (selectedApp == name) null else name },
                            label = { Text(name) }
                        )
                    }
                }
            }
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("ค้นหา (ชื่อแอป / ชื่อผู้ส่ง / ข้อความ)") },
                singleLine = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(12.dp)
            )
            LazyColumn(modifier = Modifier.fillMaxSize()) {
                items(filteredItems) { item -> NotiRow(item) }
            }
        }
    }
}

private enum class SettingsPage { Menu, Capture, ReadAloud, Sync, About }

@Composable
fun BackupScreen() {
    var page by remember { mutableStateOf(SettingsPage.Menu) }
    when (page) {
        SettingsPage.Menu      -> SettingsMenu(onOpen = { page = it })
        SettingsPage.Capture   -> CaptureFilterScreen(onClose = { page = SettingsPage.Menu })
        SettingsPage.ReadAloud -> ReadAloudScreen(onClose = { page = SettingsPage.Menu })
        SettingsPage.Sync      -> SyncBackupScreen(onClose = { page = SettingsPage.Menu })
        SettingsPage.About     -> AboutUpdateScreen(onClose = { page = SettingsPage.Menu })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsMenu(onOpen: (SettingsPage) -> Unit) {
    val ctx = LocalContext.current
    val captureCount = remember { Settings.getCaptureApps(ctx).size }
    val readAloudOn = remember { Settings.getReadAloudNoti(ctx) || Settings.getReadAloudScreen(ctx) }
    val apiUrl = remember { Settings.getApiUrl(ctx) }
    Scaffold(topBar = { TopAppBar(title = { Text("ตั้งค่า") }) }) { padding ->
        Column(modifier = Modifier.padding(padding).fillMaxSize()) {
            SettingsRow(
                title = "ตัวกรองการบันทึก",
                subtitle = if (captureCount == 0) "บันทึกทุกแอป" else "$captureCount แอปที่เลือกไว้",
                onClick = { onOpen(SettingsPage.Capture) }
            )
            SettingsRow(
                title = "อ่านออกเสียง",
                subtitle = if (readAloudOn) "เปิดอยู่" else "ปิดอยู่",
                onClick = { onOpen(SettingsPage.ReadAloud) }
            )
            SettingsRow(
                title = "ซิงค์ & สำรองข้อมูล",
                subtitle = apiUrl.ifBlank { "ยังไม่ได้เชื่อมต่อ" },
                onClick = { onOpen(SettingsPage.Sync) }
            )
            SettingsRow(
                title = "เกี่ยวกับ / อัปเดต",
                subtitle = "v${BuildConfig.VERSION_NAME}",
                onClick = { onOpen(SettingsPage.About) }
            )
        }
    }
}

@Composable
private fun SettingsRow(title: String, subtitle: String, onClick: () -> Unit) {
    Column {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Bold)
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Color.Gray, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("›", style = MaterialTheme.typography.titleLarge, color = Color.Gray)
        }
        HorizontalDivider()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CaptureFilterScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    var apps by remember { mutableStateOf(emptyList<AppEntry>()) }
    var captureFilter by remember { mutableStateOf("") }
    var captureApps by remember { mutableStateOf(Settings.getCaptureApps(ctx)) }
    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) { InstalledApps.scan(ctx, NotiStore.get(ctx).distinctApps()) }
    }
    val filteredCaptureApps = remember(apps, captureFilter) {
        if (captureFilter.isBlank()) apps
        else apps.filter { it.label.contains(captureFilter, ignoreCase = true) || it.pkg.contains(captureFilter, ignoreCase = true) }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("ตัวกรองการบันทึก") },
                navigationIcon = { TextButton(onClick = onClose) { Text("‹ กลับ") } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Text("เลือกแอปที่จะบันทึก", fontWeight = FontWeight.Bold)
            Text(
                "ค่าเริ่มต้น: LINE, Messenger, WhatsApp, Telegram  ·  ไม่เลือกอะไรเลย = บันทึกทุกแอป  ·  ตอนนี้เลือกอยู่ ${captureApps.size} แอป",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = captureFilter,
                onValueChange = { captureFilter = it },
                label = { Text("ค้นหาแอป") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(4.dp))
            if (apps.isEmpty()) {
                Text("กำลังโหลดรายชื่อแอป...", style = MaterialTheme.typography.bodySmall)
            } else {
                filteredCaptureApps.forEach { entry ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = entry.pkg in captureApps,
                            onCheckedChange = { checked ->
                                captureApps = if (checked) captureApps + entry.pkg else captureApps - entry.pkg
                                Settings.setCaptureApps(ctx, captureApps)
                            }
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(entry.label)
                    }
                }
                if (filteredCaptureApps.isEmpty()) {
                    Text("ไม่พบแอปที่ตรง", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ReadAloudScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    var readNoti by remember { mutableStateOf(Settings.getReadAloudNoti(ctx)) }
    var readScreen by remember { mutableStateOf(Settings.getReadAloudScreen(ctx)) }
    var apps by remember { mutableStateOf(emptyList<AppEntry>()) }
    var appFilter by remember { mutableStateOf("") }
    var speakApps by remember { mutableStateOf(Settings.getSpeakApps(ctx)) }
    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) { InstalledApps.scan(ctx, NotiStore.get(ctx).distinctApps()) }
    }
    val filteredApps = remember(apps, appFilter) {
        if (appFilter.isBlank()) apps
        else apps.filter { it.label.contains(appFilter, ignoreCase = true) || it.pkg.contains(appFilter, ignoreCase = true) }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("อ่านออกเสียง") },
                navigationIcon = { TextButton(onClick = onClose) { Text("‹ กลับ") } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Text("อ่านออกเสียง (สำหรับขับรถ)", fontWeight = FontWeight.Bold)
            Text(
                "ให้เครื่องอ่านข้อความออกเสียงผ่านหูฟัง ไม่ต้องมองจอ — เพลงจะหรี่ลงตอนพูดแล้วดังกลับ",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(
                    checked = readNoti,
                    onCheckedChange = { readNoti = it; Settings.setReadAloudNoti(ctx, it); if (it) Speaker.init(ctx) }
                )
                Spacer(Modifier.width(8.dp))
                Text("อ่านการแจ้งเตือนออกเสียง")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(
                    checked = readScreen,
                    onCheckedChange = { readScreen = it; Settings.setReadAloudScreen(ctx, it); if (it) Speaker.init(ctx) }
                )
                Spacer(Modifier.width(8.dp))
                Text("อ่านข้อความบนจอออกเสียง (แอปแชต/ไรเดอร์)")
            }

            Spacer(Modifier.height(8.dp))
            Text(
                "เลือกแอปที่จะอ่าน (${speakApps.size} เลือก / ${apps.size} ทั้งหมด — ไม่เลือก = อ่านทุกแอป)",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = appFilter,
                onValueChange = { appFilter = it },
                label = { Text("ค้นหาแอป (พิมพ์เพื่อกรอง)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(4.dp))
            if (apps.isEmpty()) {
                Text("กำลังโหลดรายชื่อแอป...", style = MaterialTheme.typography.bodySmall)
            } else {
                filteredApps.forEach { entry ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Checkbox(
                            checked = entry.pkg in speakApps,
                            onCheckedChange = { checked ->
                                speakApps = if (checked) speakApps + entry.pkg else speakApps - entry.pkg
                                Settings.setSpeakApps(ctx, speakApps)
                            }
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(entry.label)
                    }
                }
                if (filteredApps.isEmpty()) {
                    Text("ไม่พบแอปที่ตรง", style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SyncBackupScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var apiUrl by remember { mutableStateOf(Settings.getApiUrl(ctx)) }
    var apiToken by remember { mutableStateOf(Settings.getApiToken(ctx)) }
    var auto by remember { mutableStateOf(Settings.getAutoUpload(ctx)) }
    var status by remember { mutableStateOf("") }

    // QR pairing — opens ZXing scanner; the QR payload from the PC dashboard is
    // either plain URL or JSON {endpoint, token, updateUrl}.
    val scanLauncher = rememberLauncherForActivityResult(ScanContract()) { result ->
        val raw = result.contents ?: return@rememberLauncherForActivityResult
        var endpoint: String? = null
        var token: String? = null
        var update: String? = null
        var capturePkgs: Set<String>? = null
        runCatching {
            val o = JSONObject(raw)
            endpoint = o.optString("endpoint").takeIf { it.isNotBlank() }
            token = o.optString("token").takeIf { it.isNotBlank() }
            update = o.optString("updateUrl").takeIf { it.isNotBlank() }
            o.optJSONArray("captureApps")?.let { arr ->
                capturePkgs = (0 until arr.length()).map { arr.getString(it) }.toSet()
            }
        }
        if (endpoint == null && raw.startsWith("http")) endpoint = raw.trim()
        if (endpoint != null) {
            apiUrl = endpoint!!
            Settings.setApiUrl(ctx, endpoint!!)
            if (token != null) { apiToken = token!!; Settings.setApiToken(ctx, token!!) }
            if (update != null) { Settings.setUpdateUrl(ctx, update!!) }
            capturePkgs?.let { Settings.setCaptureApps(ctx, it) }
            status = "ตั้งค่าเสร็จ — endpoint: $endpoint" +
                (capturePkgs?.let { " · ตัวกรองการบันทึก ${it.size} แอปจาก PC" } ?: "")
            Toast.makeText(ctx, "Pair สำเร็จ", Toast.LENGTH_SHORT).show()
        } else {
            status = "QR ไม่ถูกฟอร์แมต"
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("ซิงค์ & สำรองข้อมูล") },
                navigationIcon = { TextButton(onClick = onClose) { Text("‹ กลับ") } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Text("ส่งออกเป็นไฟล์", fontWeight = FontWeight.Bold)
            Text(
                "แชร์ไปได้ทุกที่: Google Drive, อีเมล, Nearby, ส่งเข้าคอม ฯลฯ",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    scope.launch {
                        val all = withContext(Dispatchers.IO) { NotiStore.get(ctx).querySince(-1L) }
                        Exporter.share(ctx, "notikeeper.json", "application/json", Exporter.itemsToJson(all))
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("แชร์ JSON") }
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    scope.launch {
                        val all = withContext(Dispatchers.IO) { NotiStore.get(ctx).querySince(-1L) }
                        Exporter.share(ctx, "notikeeper.csv", "text/csv", Exporter.itemsToCsv(all))
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("แชร์ CSV (เปิดใน Excel/Sheets)") }
            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    scope.launch {
                        val all = withContext(Dispatchers.IO) { NotiStore.get(ctx).querySince(-1L) }
                        val okJson = Exporter.saveToDownloads(
                            ctx, "notikeeper.json", "application/json", Exporter.itemsToJson(all)
                        )
                        val okCsv = Exporter.saveToDownloads(
                            ctx, "notikeeper.csv", "text/csv", Exporter.itemsToCsv(all)
                        )
                        status = if (okJson && okCsv) "บันทึกลง Downloads แล้ว (${all.size} รายการ)"
                        else "บันทึกไม่สำเร็จ"
                    }
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("บันทึกลงโฟลเดอร์ Downloads") }

            Spacer(Modifier.height(24.dp))
            Text("อัปโหลดไป Cloud/Server ส่วนตัว (API)", fontWeight = FontWeight.Bold)
            Text(
                "POST แบบ JSON ไปยัง endpoint ของคุณ (แนบ Bearer token ถ้ามี)",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(10.dp))
            OutlinedTextField(
                value = apiUrl,
                onValueChange = { apiUrl = it; Settings.setApiUrl(ctx, it) },
                label = { Text("Endpoint URL (https://...)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    scanLauncher.launch(ScanOptions().apply {
                        setOrientationLocked(false)
                        setPrompt("จ่อกล้องไปที่ QR บนหน้าจอ PC (เปิด NotiKeeper Dashboard → Pair Mobile)")
                        setBeepEnabled(true)
                    })
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("📷 สแกน QR จาก PC dashboard") }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = apiToken,
                onValueChange = { apiToken = it; Settings.setApiToken(ctx, it) },
                label = { Text("Token (ถ้ามี)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(checked = auto, onCheckedChange = { auto = it; Settings.setAutoUpload(ctx, it) })
                Spacer(Modifier.width(8.dp))
                Text("อัปโหลดอัตโนมัติเมื่อเปิดแอป (เฉพาะรายการใหม่)")
            }
            Spacer(Modifier.height(10.dp))
            Button(
                onClick = {
                    scope.launch {
                        status = "กำลังอัปโหลด..."
                        val result = runCatching {
                            val last = Settings.getLastUploadedId(ctx)
                            val fresh = withContext(Dispatchers.IO) { NotiStore.get(ctx).querySince(last) }
                            if (fresh.isEmpty()) return@runCatching -1
                            val code = Exporter.uploadJson(apiUrl, apiToken, Exporter.itemsToJson(fresh))
                            Settings.setLastUploadedId(ctx, fresh.maxOf { it.id })
                            code
                        }
                        status = result.fold(
                            { if (it == -1) "ไม่มีรายการใหม่" else "อัปโหลดสำเร็จ (HTTP $it)" },
                            { "ผิดพลาด: ${it.message}" }
                        )
                    }
                },
                enabled = apiUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth()
            ) { Text("อัปโหลดตอนนี้ (เฉพาะใหม่)") }

            if (status.isNotBlank()) {
                Spacer(Modifier.height(14.dp))
                Text(status, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AboutUpdateScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var updateUrl by remember { mutableStateOf(Settings.getUpdateUrl(ctx)) }
    var updateStatus by remember { mutableStateOf("") }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("เกี่ยวกับ / อัปเดต") },
                navigationIcon = { TextButton(onClick = onClose) { Text("‹ กลับ") } }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
        ) {
            Text("อัปเดตแอป", fontWeight = FontWeight.Bold)
            Text(
                "เวอร์ชันปัจจุบัน: ${BuildConfig.VERSION_NAME}",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = updateUrl,
                onValueChange = { updateUrl = it; Settings.setUpdateUrl(ctx, it) },
                label = { Text("URL ตรวจอัปเดต (version.json)") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            Button(
                onClick = {
                    scope.launch {
                        updateStatus = "กำลังตรวจ..."
                        runCatching {
                            val info = Updater.check(ctx)
                            if (info == null) {
                                updateStatus = "เป็นเวอร์ชันล่าสุดแล้ว (${BuildConfig.VERSION_NAME})"
                            } else {
                                updateStatus = "พบเวอร์ชัน ${info.versionName} — กำลังดาวน์โหลด..."
                                val f = Updater.download(ctx, info.apkUrl)
                                updateStatus = "กำลังเปิดตัวติดตั้ง..."
                                Updater.install(ctx, f)
                            }
                        }.onFailure { updateStatus = "ผิดพลาด: ${it.message}" }
                    }
                },
                enabled = updateUrl.isNotBlank(),
                modifier = Modifier.fillMaxWidth()
            ) { Text("ตรวจ & อัปเดตตอนนี้") }
            if (updateStatus.isNotBlank()) {
                Spacer(Modifier.height(6.dp))
                Text(updateStatus, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen() {
    val ctx = LocalContext.current
    var stats by remember { mutableStateOf<com.example.notikeeper.data.NotiStore.Stats?>(null) }
    var refresh by remember { mutableStateOf(0) }
    LaunchedEffect(refresh) {
        stats = withContext(Dispatchers.IO) { NotiStore.get(ctx).getStats() }
    }
    val formatter = remember { SimpleDateFormat("dd/MM/yy HH:mm", Locale.getDefault()) }
    val sky = Color(0xFF5EC1FF)
    val gold = Color(0xFFFFC857)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Dashboard") },
                actions = { TextButton(onClick = { refresh++ }) { Text("รีเฟรช") } }
            )
        }
    ) { padding ->
        val s = stats
        if (s == null) {
            Box(Modifier.padding(padding).fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("กำลังคำนวณ...", color = Color.Gray)
            }
            return@Scaffold
        }
        Column(
            modifier = Modifier
                .padding(padding)
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // ---- KPI tiles (2x2) ----
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile("ข้อความรวม", s.total.toString(), Modifier.weight(1f), sky)
                val top = s.topApps.firstOrNull()
                StatTile(
                    "แอปบนสุด",
                    top?.first ?: "—",
                    Modifier.weight(1f),
                    gold,
                    sub = top?.let { "${it.second} ข้อความ" } ?: ""
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatTile(
                    "แจ้งเตือน / หน้าจอ",
                    "${s.notiCount} / ${s.screenCount}",
                    Modifier.weight(1f),
                    sky
                )
                val range = if (s.total > 0)
                    "${formatter.format(Date(s.minTime))}  →  ${formatter.format(Date(s.maxTime))}"
                else "—"
                StatTile("ช่วงเวลา", range, Modifier.weight(1f), gold, isSmall = true)
            }

            // ---- 24h sparkline ----
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("กิจกรรม 24 ชม. ล่าสุด", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "รวม ${s.hourlyLast24h.sum()} ข้อความ · จุดละ 1 ชั่วโมง",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color.Gray
                    )
                    Spacer(Modifier.height(12.dp))
                    Sparkline(s.hourlyLast24h, sky, Modifier.fillMaxWidth().height(80.dp))
                }
            }

            // ---- Top apps bar chart ----
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text("Top แอป", fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(12.dp))
                    if (s.topApps.isEmpty()) {
                        Text("ยังไม่มีข้อมูล", color = Color.Gray)
                    } else {
                        val maxC = s.topApps.first().second.coerceAtLeast(1)
                        s.topApps.forEach { (name, count) ->
                            AppBar(name, count, maxC, sky)
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    accent: Color,
    sub: String = "",
    isSmall: Boolean = false,
) {
    Card(modifier = modifier) {
        Column(modifier = Modifier.padding(14.dp)) {
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = Color.Gray)
            Spacer(Modifier.height(6.dp))
            Text(
                value,
                fontWeight = FontWeight.Bold,
                color = accent,
                fontSize = if (isSmall) 13.sp else 22.sp,
                lineHeight = if (isSmall) 18.sp else 26.sp,
            )
            if (sub.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(sub, style = MaterialTheme.typography.bodySmall, color = Color.Gray)
            }
        }
    }
}

@Composable
private fun AppBar(name: String, count: Long, max: Long, accent: Color) {
    val fraction = (count.toFloat() / max).coerceIn(0.02f, 1f)
    Column {
        Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
            Text(name, fontWeight = FontWeight.SemiBold)
            Text(count.toString(), color = Color.Gray)
        }
        Spacer(Modifier.height(4.dp))
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(accent.copy(alpha = 0.15f))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(fraction)
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(accent)
            )
        }
    }
}

@Composable
private fun Sparkline(values: LongArray, color: Color, modifier: Modifier) {
    Canvas(modifier = modifier) {
        if (values.isEmpty()) return@Canvas
        val maxV = (values.max().takeIf { it > 0 } ?: 1L).toFloat()
        val w = size.width
        val h = size.height
        val stepX = if (values.size > 1) w / (values.size - 1) else w
        val path = Path()
        val fill = Path()
        values.forEachIndexed { i, v ->
            val x = i * stepX
            val y = h - (v / maxV) * (h - 4f) - 2f
            if (i == 0) {
                path.moveTo(x, y); fill.moveTo(x, h)
                fill.lineTo(x, y)
            } else {
                path.lineTo(x, y); fill.lineTo(x, y)
            }
        }
        fill.lineTo(w, h); fill.close()
        drawPath(fill, color = color.copy(alpha = 0.18f))
        drawPath(path, color = color, style = Stroke(width = 3f))
        // dots
        values.forEachIndexed { i, v ->
            val x = i * stepX
            val y = h - (v / maxV) * (h - 4f) - 2f
            drawCircle(color = color, radius = 2.5f, center = Offset(x, y))
        }
    }
}

@Composable
fun PermissionCard(title: String, body: String, button: String, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(title, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(body, style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onClick) { Text(button) }
        }
    }
}

@Composable
fun NotiRow(item: NotiItem) {
    val formatter = remember { SimpleDateFormat("dd/MM/yy HH:mm", Locale.getDefault()) }
    val tag = when {
        item.source == "screen" && item.side == "me" -> "หน้าจอ · ฉัน"
        item.source == "screen" -> "หน้าจอ · เขา"
        else -> "แจ้งเตือน"
    }
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("${item.appName} · $tag", fontWeight = FontWeight.Bold)
                Text(
                    formatter.format(Date(item.postTime)),
                    style = MaterialTheme.typography.labelSmall
                )
            }
            if (item.title.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(item.title, fontWeight = FontWeight.SemiBold)
            }
            if (item.text.isNotBlank()) {
                Spacer(Modifier.height(2.dp))
                Text(item.text)
            }
        }
    }
}

/** True if our NotificationListenerService is enabled in system settings. */
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
