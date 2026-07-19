package com.example.notikeeper

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
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
import androidx.compose.material3.AssistChip
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

private enum class SettingsPage { Menu, Capture, ReadAloud, Device, Sync, About }

@Composable
fun BackupScreen() {
    var page by remember { mutableStateOf(SettingsPage.Menu) }
    when (page) {
        SettingsPage.Menu      -> SettingsMenu(onOpen = { page = it })
        SettingsPage.Capture   -> CaptureFilterScreen(onClose = { page = SettingsPage.Menu })
        SettingsPage.ReadAloud -> ReadAloudScreen(onClose = { page = SettingsPage.Menu })
        SettingsPage.Device    -> DeviceConnectionScreen(onClose = { page = SettingsPage.Menu })
        SettingsPage.Sync      -> BackupExportScreen(onClose = { page = SettingsPage.Menu })
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
                title = "อุปกรณ์ & การเชื่อมต่อ",
                subtitle = if (apiUrl.isBlank()) "ยังไม่ได้เชื่อมต่อ" else "เชื่อมต่ออยู่ · $apiUrl",
                onClick = { onOpen(SettingsPage.Device) }
            )
            SettingsRow(
                title = "สำรอง & ส่งออก",
                subtitle = "JSON / CSV / Downloads",
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
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Text("›", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
private fun BackupExportScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("") }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("สำรอง & ส่งออก") },
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
                        AppLock.suppressNextLock = true
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
                        AppLock.suppressNextLock = true
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

            if (status.isNotBlank()) {
                Spacer(Modifier.height(14.dp))
                Text(status, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DeviceConnectionScreen(onClose: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var deviceName by remember { mutableStateOf(Settings.getDeviceName(ctx).ifBlank { Build.MODEL }) }
    var apiUrl by remember { mutableStateOf(Settings.getApiUrl(ctx)) }
    var apiToken by remember { mutableStateOf(Settings.getApiToken(ctx)) }
    var pruneEnabled by remember { mutableStateOf(Settings.getPruneEnabled(ctx)) }
    var auto by remember { mutableStateOf(Settings.getAutoUpload(ctx)) }
    var lastSync by remember { mutableStateOf(Settings.getLastSyncTime(ctx)) }
    var status by remember { mutableStateOf("") }
    var apps by remember { mutableStateOf(emptyList<AppEntry>()) }
    val captureApps = remember { Settings.getCaptureApps(ctx) }

    LaunchedEffect(Unit) {
        apps = withContext(Dispatchers.IO) { InstalledApps.scan(ctx, NotiStore.get(ctx).distinctApps()) }
    }
    val captureLabels = remember(apps, captureApps) {
        apps.filter { it.pkg in captureApps }.map { it.label }
    }

    // QR pairing — opens ZXing scanner; the QR payload from the PC dashboard is
    // either plain URL or JSON {endpoint, token, updateUrl, captureApps}.
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
                title = { Text("อุปกรณ์ & การเชื่อมต่อ") },
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
            Text("ชื่อเครื่องนี้", fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            OutlinedTextField(
                value = deviceName,
                onValueChange = { deviceName = it; Settings.setDeviceName(ctx, it) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth()
            )

            Spacer(Modifier.height(24.dp))
            Text("สถานะการเชื่อมต่อ", fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(8.dp))
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(
                                    if (apiUrl.isNotBlank()) MaterialTheme.colorScheme.tertiary
                                    else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(
                            if (apiUrl.isNotBlank()) "เชื่อมต่ออยู่" else "ยังไม่ได้เชื่อมต่อ",
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                    if (apiUrl.isNotBlank()) {
                        Spacer(Modifier.height(4.dp))
                        Text(apiUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.height(2.dp))
                        Text(
                            if (lastSync > 0) "ซิงค์ล่าสุด ${relativeTime(lastSync)}" else "ยังไม่เคยซิงค์",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    AppLock.suppressNextLock = true
                    scanLauncher.launch(ScanOptions().apply {
                        setOrientationLocked(false)
                        setPrompt("จ่อกล้องไปที่ QR บนหน้าจอ PC (เปิด NotiKeeper Dashboard → Pair Mobile)")
                        setBeepEnabled(true)
                    })
                },
                modifier = Modifier.fillMaxWidth()
            ) { Text("📷 สแกน QR จาก PC dashboard") }

            Spacer(Modifier.height(20.dp))
            Text("ตัวกรองที่ใช้อยู่", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(6.dp))
            if (captureLabels.isEmpty()) {
                Text(
                    if (captureApps.isEmpty()) "บันทึกทุกแอป" else "กำลังโหลด...",
                    style = MaterialTheme.typography.bodySmall
                )
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    captureLabels.forEach { label -> AssistChip(onClick = {}, label = { Text(label) }) }
                }
            }

            Spacer(Modifier.height(28.dp))
            Text("การเชื่อมต่อขั้นสูง", fontWeight = FontWeight.Bold)
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(
                    checked = pruneEnabled,
                    onCheckedChange = { pruneEnabled = it; Settings.setPruneEnabled(ctx, it) }
                )
                Spacer(Modifier.width(8.dp))
                Column {
                    Text("ลบข้อมูลบนเครื่องหลังซิงค์ขึ้น PC แล้ว")
                    Text(
                        "ลบเฉพาะรายการที่ PC ยืนยันรับแล้วและเก่ากว่า 7 วัน — ข้อมูลบน PC ไม่หายไปไหน",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
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
                            val uploaded = Exporter.uploadJson(apiUrl, apiToken, Exporter.itemsToJson(fresh), deviceName)
                            Settings.setLastUploadedId(ctx, fresh.maxOf { it.id })
                            Settings.setLastSyncTime(ctx, System.currentTimeMillis())
                            if (uploaded.ackedThroughId > 0) {
                                Settings.setPrunableThroughId(ctx, uploaded.ackedThroughId)
                                if (Settings.getPruneEnabled(ctx)) {
                                    withContext(Dispatchers.IO) {
                                        NotiStore.get(ctx).pruneAcked(Settings.getPrunableThroughId(ctx), Settings.PRUNE_RETENTION_MS)
                                    }
                                }
                            }
                            lastSync = Settings.getLastSyncTime(ctx)
                            uploaded.code
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

/** "N นาทีที่แล้ว" / "N ชั่วโมงที่แล้ว" / "N วันที่แล้ว" relative to now, for the last-sync line. */
private fun relativeTime(epochMs: Long): String {
    val diffMin = (System.currentTimeMillis() - epochMs) / 60_000
    return when {
        diffMin < 1 -> "เมื่อสักครู่"
        diffMin < 60 -> "$diffMin นาทีที่แล้ว"
        diffMin < 1440 -> "${diffMin / 60} ชั่วโมงที่แล้ว"
        else -> "${diffMin / 1440} วันที่แล้ว"
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
