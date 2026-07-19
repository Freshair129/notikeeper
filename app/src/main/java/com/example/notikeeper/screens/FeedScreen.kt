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
                    val result = Exporter.uploadJson(
                        Settings.getApiUrl(ctx),
                        Settings.getApiToken(ctx),
                        Exporter.itemsToJson(fresh),
                        Settings.getDeviceName(ctx).ifBlank { Build.MODEL }
                    )
                    Settings.setLastUploadedId(ctx, fresh.maxOf { it.id })
                    Settings.setLastSyncTime(ctx, System.currentTimeMillis())
                    if (result.ackedThroughId > 0) {
                        Settings.setPrunableThroughId(ctx, result.ackedThroughId)
                        if (Settings.getPruneEnabled(ctx)) {
                            withContext(Dispatchers.IO) {
                                NotiStore.get(ctx).pruneAcked(Settings.getPrunableThroughId(ctx), Settings.PRUNE_RETENTION_MS)
                            }
                        }
                    }
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
                    onClick = {
                        AppLock.suppressNextLock = true
                        ctx.startActivity(Intent(AndroidSettings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                    }
                )
            }
            if (!readerOn) {
                PermissionCard(
                    title = "เปิดสิทธิ์ \"การช่วยเหลือพิเศษ\" (Accessibility)",
                    body = "เพื่ออ่านบทสนทนาเต็ม ๆ บนหน้าจอแชท (Messenger/LINE/IG/WhatsApp/Telegram) — เปิด NotiKeeper ในรายการ",
                    button = "เปิดสิทธิ์อ่านหน้าจอ",
                    onClick = {
                        AppLock.suppressNextLock = true
                        ctx.startActivity(Intent(AndroidSettings.ACTION_ACCESSIBILITY_SETTINGS))
                    }
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
