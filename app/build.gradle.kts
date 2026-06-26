plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.example.notikeeper"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.notikeeper"
        // minSdk 30 (Android 11): lets us use the clean BIOMETRIC_STRONG | DEVICE_CREDENTIAL
        // app-lock combo without per-version workarounds.
        minSdk = 30
        targetSdk = 34
        versionCode = 7
        versionName = "1.6"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.2")
    implementation("androidx.fragment:fragment-ktx:1.8.2")
    implementation(platform("androidx.compose:compose-bom:2024.09.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.6")

    // Encrypted database (AES-256 full-file encryption)
    implementation("net.zetetic:android-database-sqlcipher:4.5.4")
    implementation("androidx.sqlite:sqlite-ktx:2.4.0")

    // Keystore-backed storage for the DB passphrase
    implementation("androidx.security:security-crypto:1.1.0-alpha06")

    // App lock: fingerprint / device PIN
    implementation("androidx.biometric:biometric:1.1.0")
}
