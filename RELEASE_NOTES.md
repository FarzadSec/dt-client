**DT Connect 1.0.1**

- Windows: the L2TP connection is now set up by a script that ships with the app, instead of an encoded PowerShell command, a pattern that security software treats as suspicious. Nothing else changes.

**DT Connect 1.0**: the app formerly called DT Client, under its new name and logo.

- New Android app: a welcome page and sign-in with a **sign-in QR code** (camera, or a QR picture from the gallery), a home page with the server map, recent locations, the plan and this week's protected hours, a location list by country and city, and Protection, Notices and Account tabs.
- Every app opens `dtconnect://` sign-in links: the link in the bot's delivery message signs in with one tap.
- Android connects with VLESS, VMess, Trojan, Shadowsocks, WireGuard and OpenVPN.
- Linux packages are now `dt-connect` and replace `dt-client` when installed over it.

Installers for every system are attached below. Check a download against `SHA256SUMS.txt`.

| System | File |
| --- | --- |
| Windows 10 / 11 (64-bit) | `DT-Connect-Setup-<version>.exe` |
| Debian, Ubuntu, Linux Mint, Pop!_OS, elementary | `DT-Connect-<version>-linux-amd64.deb` (`arm64` for ARM) |
| Fedora, RHEL, Rocky, AlmaLinux, openSUSE | `DT-Connect-<version>-linux-x86_64.rpm` (`aarch64` for ARM) |
| Arch, Manjaro, EndeavourOS | `DT-Connect-<version>-linux-x64.pacman` (`aarch64` for ARM) |
| macOS 12+ on Apple silicon (M1 and later) | `DT-Connect-<version>-mac-arm64.pkg` |
| macOS 12+ on Intel | `DT-Connect-<version>-mac-x64.pkg` |
| Android 5.0+, most phones | `DT-Connect-<version>-android-arm64-v8a.apk` |
| Android, older 32-bit phones | `DT-Connect-<version>-android-armeabi-v7a.apk` |
| Android, any device | `DT-Connect-<version>-android-universal.apk` |

See the README for how to install on each system.
