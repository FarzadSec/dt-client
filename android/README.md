# DT Connect for Android

Android 5.0 and later, on every processor family (arm64-v8a, armeabi-v7a, x86_64, x86). Native Kotlin with Jetpack Compose, the same sign-in, profile, notices, refresh and ping as the desktop app.

## Screens

- **Welcome**: the DT Connect mark over the server map, *Log in*, *Scan sign-in QR code* and where the sign-in details are. The sign-in form takes the subscription link and the username, a pasted sign-in link, the camera or a QR picture.
- **Home**: location search, the map card (glides to the chosen or connected server, the state with its timer and the one button: *Secure my connection* / *Disconnect*), recent locations (or the quickest ones before the first connection), the plan (days and traffic left), *Secured by VPN* (hours connected on each day of this week, kept on the phone only), the connection tools and settings.
- **Locations**: every location grouped by country with its flag and ping, countries with several cities opening to list them, a protocol filter and *Test ping*.
- **Protection**: protocol, Iranian sites without VPN, ad blocking, kill switch (Android's own), apps without VPN, DNS.
- **Notices** (the panel's notices, always right to left in Vazirmatn) and **Account** (plan, refresh, language, dark or light, support, sign out).

Navy and teal from the logo; dark by default, light or the system's on request; Persian and English.

How it connects: Xray-core runs the panel's outbound behind a SOCKS port on 127.0.0.1 (`core/`, bound with gomobile), and hev-socks5-tunnel (MIT) carries the packets of Android's VPN interface to it. The app itself is left out of the VPN, so Xray's own connections leave directly instead of looping into the tunnel. OpenVPN 2.7 runs as its own process (see below). L2TP needs Android's own VPN client, which apps cannot drive, so those configs are not offered here.

- **Kill switch**: Android's own. In Settings → Network → VPN → DT Connect, turn on *Always-on VPN* and *Block connections without VPN*; the app opens that screen.
- **Apps without VPN**: chosen apps are left out of the VPN (`addDisallowedApplication`).
- **Notices**: banners and the notices tab as on the desktop. While connected, a new warning or critical notice also arrives as a notification.

## Tests

`gradle -p android testReleaseUnitTest` runs the JVM tests (sign-in links, this week's bars, both languages complete). On an Android 11 emulator CI then runs:

- `EnginesTest`: the native libraries load, Xray runs the app's configuration.
- `OpenVpnTest`: the app connects through OpenVPN servers set up as Manifold sets them up, over TCP and UDP.
- `ProtocolsTest`: the app signs in to a test panel (`test/mock-panel.mjs`) and connects through VLESS + REALITY + Vision, VMess over WebSocket, Trojan, Shadowsocks 2022 and WireGuard on the kernel (`test/protocol-servers.sh`).
- `UiTourTest`: welcome, sign-in form, signing in by opening the QR code's link, every tab, the location list, connecting, English and light; each screen is kept as the `android-screens` artifact.

## Build

CI (`.github/workflows/build.yml`, job `android`) builds everything: `gomobile bind` for `core/` into `app/libs/dtcore.aar`, hev-socks5-tunnel and OpenVPN with the NDK into `app/src/main/jniLibs`, Xray's geo files into `app/src/main/assets`, then `gradle -p android assembleRelease`. The APKs come out per processor family plus one universal APK.

`openvpn/build.sh` builds OpenVPN for the four processor families with OpenVPN's own CMake build for Android: OpenSSL 3.5 (LTS), LZ4 and LZO linked in statically, so the program needs nothing but Android's libc. The versions are pinned at the top of the script (OpenVPN from its GitHub tag, OpenSSL and LZ4 from theirs, LZO 2.10 from OpenVPN for Android's copy, as LZO has no git home); CI caches the result until the script changes. OpenVPN is GPLv2 and runs as a separate program; its source is the upstream tag the script names, and the licenses of all four are in `licenses/`.

On an Android 11 emulator CI then checks the engines: the tunnel library and Xray run (`EnginesTest`), the OpenVPN program runs, and the app connects through two real OpenVPN servers on the CI machine, over TCP and UDP, set up and with profiles written the way Manifold does (`openvpn/test-server.sh`, `OpenVpnTest`): a ping from the phone reaches the server through the tunnel, and after disconnecting it no longer does.

### Signing key

Android installs an update only when it is signed with the same key as the installed copy. Until the key below is set, CI signs with its runner's throwaway debug key and every build is a new app to Android. Create the key once, keep the file and password safe (losing it means users must uninstall to update), and add four repository secrets (Settings → Secrets and variables → Actions):

```
keytool -genkeypair -keystore dt-client-release.jks -storetype PKCS12 -alias dtclient -keyalg RSA -keysize 4096 -validity 10950 -dname "CN=DataCraft"
base64 -w0 dt-client-release.jks   # → ANDROID_KEYSTORE_BASE64
```

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 line above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `dtclient` |
| `ANDROID_KEY_PASSWORD` | the key password (the same one for PKCS12) |
