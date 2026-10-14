plugins {
  id("com.android.library")
}

android {
  namespace = "com.legalwhat.spectra.collector"
  compileSdk = 36

  defaultConfig {
    minSdk = 31
    consumerProguardFiles("consumer-rules.pro")
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
}

dependencies {
  implementation("androidx.annotation:annotation:1.9.1")
}
