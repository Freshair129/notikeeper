package com.example.notikeeper

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings as AndroidSettings
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
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

@Composable
fun AppScreen() {
    var showBackup by remember { mutableStateOf(false) }
    if (showBackup) {
        BackupScreen(onClose = { showBackup = false })
    } else {
        MainList(onOpenBackup = { showBackup = true })
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainList(onOpenBackup: () -> Unit) {
    val ctx = LocalContext.current
    var query by remember { mutableStateOf("") }
    var items by remember { mutableStateOf(emptyList<NotiItem>()) }
    var notiOn by remember { mutableStateOf(isNotiAccessEnabled(ctx)) }
    var readerOn by remember { mutableStateOf(isReaderEnabled(ctx)) }
    var refreshKey by remember { mutableStateOf(0) }
    var updateAvail by remember { mutableStateOf<UpdateInfo?>(null) }

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
                    TextButton(onClick = onOpenBackup) { Text("สำรอง") }
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
                        Button(onClick = onOpenBackup) { Text("ไปอัปเดต") }
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
                items(items) { item -> NotiRow(item) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackupScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var apiUrl by remember { mutableStateOf(Settings.getApiUrl(ctx)) }
    var apiToken by remember { mutableStateOf(Settings.getApiToken(ctx)) }
    var auto by remember { mutableStateOf(Settings.getAutoUpload(ctx)) }
    var status by remember { mutableStateOf("") }
    var readNoti by remember { mutableStateOf(Settings.getReadAloudNoti(ctx)) }
    var readScreen by remember { mutableStateOf(Settings.getReadAloudScreen(ctx)) }
    var apps by remember { mutableStateOf(emptyList<Pair<String, String>>()) }
    var speakApps by remember { mutableStateOf(Settings.getSpeakApps(ctx)) }
    var updateUrl by remember { mutableStateOf(Settings.getUpdateUrl(ctx)) }
    var updateStatus by remember { mutableStateOf("") }
    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) { NotiStore.get(ctx).distinctApps() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("สำรอง / ส่งออกข้อมูล") },
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

            Spacer(Modifier.height(24.dp))
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
                "เลือกแอปที่จะอ่าน (ไม่เลือก = อ่านทุกแอป)",
                style = MaterialTheme.typography.bodySmall
            )
            if (apps.isEmpty()) {
                Text(
                    "ยังไม่มีข้อมูลแอป — รอการแจ้งเตือนเข้ามาสักครู่แล้วเปิดหน้านี้ใหม่",
                    style = MaterialTheme.typography.bodySmall
                )
            } else {
                apps.forEach { (pkg, name) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(
                            checked = pkg in speakApps,
                            onCheckedChange = { checked ->
                                speakApps = if (checked) speakApps + pkg else speakApps - pkg
                                Settings.setSpeakApps(ctx, speakApps)
                            }
                        )
                        Spacer(Modifier.width(4.dp))
                        Text(name)
                    }
                }
            }

            Spacer(Modifier.height(24.dp))
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
