# DT Client for Android

Android 5.0 and later, on every processor family (arm64-v8a, armeabi-v7a, x86_64, x86). Native Kotlin with Jetpack Compose, the same sign-in, profile, notices, refresh and ping as the desktop app.

How it connects:

- **Xray protocols and WireGuard**: Xray-core runs the panel's outbound behind a SOCKS port on 127.0.0.1 (`core/`, bound with gomobile), and hev-socks5-tunnel (MIT) carries the packets of Android's VPN interface to it.
- **OpenVPN**: OpenVPN 2.7 itself, built from the upstream sources for Android (`openvpn/build.sh`) and shipped in the APK as `libovpnexec.so`, runs as its own process with the panel's profile. Built for Android it opens no tun device and sets no routes: over a management socket in the app's private storage it tells the app the address, routes and DNS servers the server pushed, the app opens the VPN interface with exactly those and hands it over, and OpenVPN passes back each socket it opens to the server so the app can keep it out of the tunnel (`vpn/OpenVpn.kt`, following OpenVPN's `doc/android.txt`). The login in the profile goes over that socket, not into a file. Profiles that would run programs, read files or open a control port are refused, as on the desktop. When the phone moves between Wi-Fi and mobile data OpenVPN reconnects at once, keeping the same tunnel.
- **L2TP** is not offered: Android's own L2TP/IPsec client cannot be driven by an app, and Android 12 removed it.

The app itself is left out of the VPN, so the engines' own connections leave directly instead of looping into the tunnel. **Automatic** tries the Xray protocols first, then WireGuard, then OpenVPN. *Iranian sites without VPN* and *ad blocking* are Xray routing rules, so they apply to the Xray protocols and WireGuard, not to OpenVPN.

- **Kill switch**: Android's own. In Settings → Network → VPN → DT Client, turn on *Always-on VPN* and *Block connections without VPN*; the app's settings page opens that screen.
- **Apps without VPN**: chosen apps are left out of the VPN (`addDisallowedApplication`).
- **Notices**: banners and the bell as on the desktop, always right to left in Vazirmatn (bundled, OFL, `licenses/`). While connected, a new warning or critical notice also arrives as a notification.
- **Sign-in** works with `http://` subscription links too (often an IP and port 2096): Android 9 and later refuse plain http unless the app allows it, which it does.

## Build

CI (`.github/workflows/build.yml`, job `android`) builds everything: `gomobile bind` for `core/` into `app/libs/dtcore.aar`, hev-socks5-tunnel and OpenVPN with the NDK into `app/src/main/jniLibs`, Xray's geo files into `app/src/main/assets`, then `gradle -p android assembleRelease`. The APKs come out per processor family plus one universal APK.

`openvpn/build.sh` builds OpenVPN for the four processor families with OpenVPN's own CMake build for Android: OpenSSL 3.5 (LTS), LZ4 and LZO linked in statically, so the program needs nothing but Android's libc. The versions are pinned at the top of the script (OpenVPN from its GitHub tag, OpenSSL and LZ4 from theirs, LZO 2.10 from OpenVPN for Android's copy, as LZO has no git home); CI caches the result until the script changes. OpenVPN is GPLv2 and runs as a separate program; its source is the upstream tag the script names, and the licenses of all four are in `licenses/`.

On an Android 11 emulator CI then checks the engines: the tunnel library and Xray run (`EnginesTest`), the OpenVPN program runs, and the app connects through two real OpenVPN servers on the CI machine, over TCP and UDP, set up and with profiles written the way Manifold does (`openvpn/test-server.sh`, `OpenVpnTest`): a ping from the phone reaches the server through the tunnel, and after disconnecting it no longer does.

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
