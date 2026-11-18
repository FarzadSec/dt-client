import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The desktop app's version, so every platform of a release carries the same one.
val appVersion: String = providers.gradleProperty("appVersion").getOrElse("0.1.0")
val versionParts = appVersion.split(".").map { it.toIntOrNull() ?: 0 }
val keystore: String? = System.getenv("DT_KEYSTORE")

android {
    namespace = "team.datacraft.dtclient"
    compileSdk = 35

    defaultConfig {
        applicationId = "team.datacraft.dtclient"
        // Android 5.0 and later: every phone and tablet still in use.
        minSdk = 21
        targetSdk = 35
        versionCode = versionParts[0] * 10000 + versionParts.getOrElse(1) { 0 } * 100 + versionParts.getOrElse(2) { 0 }
        versionName = appVersion
    }

    signingConfigs {
        if (keystore != null) {
            create("release") {
                storeFile = file(keystore)
                storePassword = System.getenv("DT_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("DT_KEY_ALIAS")
                keyPassword = System.getenv("DT_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (keystore != null) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    // One APK per processor family, and one universal APK that runs on all of them.
    splits {
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")
            isUniversalApk = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    // Xray-core, bound by gomobile from ../core (CI builds it).
    implementation(files("libs/dtcore.aar"))
    implementation(platform("androidx.compose:compose-bom:2025.01.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
}
