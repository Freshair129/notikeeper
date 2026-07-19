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
fun DashboardScreen() {
    val ctx = LocalContext.current
    var stats by remember { mutableStateOf<com.example.notikeeper.data.NotiStore.Stats?>(null) }
    var refresh by remember { mutableStateOf(0) }
    LaunchedEffect(refresh) {
        stats = withContext(Dispatchers.IO) { NotiStore.get(ctx).getStats() }
    }
    val formatter = remember { SimpleDateFormat("dd/MM/yy HH:mm", Locale.getDefault()) }
    val sky = MaterialTheme.colorScheme.primary
    val gold = MaterialTheme.colorScheme.tertiary

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
                Text("กำลังคำนวณ...", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                        color = MaterialTheme.colorScheme.onSurfaceVariant
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
                        Text("ยังไม่มีข้อมูล", color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            Text(count.toString(), color = MaterialTheme.colorScheme.onSurfaceVariant)
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

