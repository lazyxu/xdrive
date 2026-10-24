plugins {
    id("com.android.application")
    kotlin("android")
    id("org.jetbrains.kotlin.plugin.compose")
}
val copyXDriveBrand by tasks.registering(Copy::class) {
    from(rootProject.file("../assets/icon/web/pwa-512.png"))
    into(layout.buildDirectory.dir("generated/xdriveBrand/res/drawable-nodpi"))
    rename { "xdrive_brand.png" }
}
android {
    namespace = "com.tfluid.xdrive"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.tfluid.xdrive"
        minSdk = 29
        targetSdk = 35
        versionCode = providers.gradleProperty("androidVersionCode").map { it.toInt().also { code -> require(code in 1..2100000000) } }.getOrElse(4)
        versionName = providers.gradleProperty("androidVersionName").getOrElse("0.1.3")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    buildFeatures { compose = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    val keyPath = System.getenv("ANDROID_KEYSTORE_PATH")
    val storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
    if (keyPath != null || storePassword != null) {
        require(!keyPath.isNullOrBlank() && !storePassword.isNullOrBlank()) { "Both release signing environment variables are required" }
        signingConfigs.create("privateRelease") {
            storeFile = file(keyPath)
            this.storePassword = storePassword
            keyAlias = "xdrive"
            keyPassword = storePassword
        }
    }
    buildTypes { release {
        isMinifyEnabled = false
        signingConfig = signingConfigs.findByName("privateRelease")
    } }
    lint { abortOnError = true }
    sourceSets.getByName("main").res.srcDir(layout.buildDirectory.dir("generated/xdriveBrand/res"))
}
tasks.named("preBuild").configure { dependsOn(copyXDriveBrand) }
dependencies {
    implementation(project(":core"))
    implementation(platform("androidx.compose:compose-bom:2025.04.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.1")
    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.1")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.04.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
