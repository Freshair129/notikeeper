package com.example.notikeeper

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager

data class AppEntry(val pkg: String, val label: String)

/**
 * Lists user-visible apps installed on the device, for the read-aloud picker.
 * Includes anything with a launcher activity OR anything we've already seen
 * deliver a notification (captured in our DB), so the picker works even before
 * an app is ever notified.
 */
object InstalledApps {
    fun scan(context: Context, includeFromDb: List<Pair<String, String>> = emptyList()): List<AppEntry> {
        val pm = context.packageManager
        val seen = HashMap<String, AppEntry>()

        // 1) Anything with a launcher activity (excludes most system services).
        val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val infos = pm.queryIntentActivities(launcher, 0)
        for (info in infos) {
            val act = info.activityInfo ?: continue
            val pkg = act.packageName ?: continue
            if (pkg == context.packageName) continue
            val label = runCatching { info.loadLabel(pm).toString() }.getOrDefault(pkg)
            seen.putIfAbsent(pkg, AppEntry(pkg, label))
        }

        // 2) Anything we already have notifications from (covers apps without a launcher icon).
        for ((pkg, name) in includeFromDb) {
            seen.putIfAbsent(pkg, AppEntry(pkg, name))
        }

        return seen.values.sortedBy { it.label.lowercase() }
    }
}
