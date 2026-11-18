# DT Client for Android

Android 5.0 and later, on every processor family (arm64-v8a, armeabi-v7a, x86_64, x86). Native Kotlin with Jetpack Compose, the same sign-in, profile, notices, refresh and ping as the desktop app.

How it connects: Xray-core runs the panel's outbound behind a SOCKS port on 127.0.0.1 (`core/`, bound with gomobile), and hev-socks5-tunnel (MIT) carries the packets of Android's VPN interface to it. The app itself is left out of the VPN, so Xray's own connections leave directly instead of looping into the tunnel. Android runs the Xray protocols, WireGuard included; OpenVPN and L2TP need system clients an app cannot drive, so those configs are not offered here.

- **Kill switch**: Android's own. In Settings → Network → VPN → DT Client, turn on *Always-on VPN* and *Block connections without VPN*; the app's settings page opens that screen.
- **Apps without VPN**: chosen apps are left out of the VPN (`addDisallowedApplication`).
- **Notices**: banners and the bell as on the desktop, always right to left in Vazirmatn (bundled, OFL, `licenses/`). While connected, a new warning or critical notice also arrives as a notification.

## Build

CI (`.github/workflows/build.yml`, job `android`) builds everything: `gomobile bind` for `core/` into `app/libs/dtcore.aar`, hev-socks5-tunnel with the NDK into `app/src/main/jniLibs`, Xray's geo files into `app/src/main/assets`, then `gradle -p android assembleRelease`. The APKs come out per processor family plus one universal APK.

### Signing key

Android installs an update only when it is signed with the same key as the installed copy. Until the key below is set, CI signs with its runner's throwaway debug key and every build is a new app to Android. Create the key once, keep the file and password safe (losing it means users must uninstall to update), and add four repository secrets (Settings → Secrets and variables → Actions):

```
keytool -genkeypair -keystore dt-client-release.jks -storetype PKCS12 -alias dtclient -keyalg RSA -keysize 4096 -validity 10950 -dname "CN=DataCraft Team"
base64 -w0 dt-client-release.jks   # → ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 line above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `dtclient` |
| `ANDROID_KEY_PASSWORD` | the key password (the same one for PKCS12) |
