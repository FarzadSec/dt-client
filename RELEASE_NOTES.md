**DT Connect 1.1.2**

- **macOS: Connect works after installing the package.** 1.1.1's package could only install into the user's own Applications folder, without administrator rights, so the helper that runs the VPN never got set up and every connection ended with "the DT Connect service is not running". The package now installs for all users (it asks for the Mac's password), sets up the helper and fails the installation if the helper does not start, instead of reporting success. It removes the 1.1.1 copy left in the user's Applications folder. Customers on 1.1.1 only need to install 1.1.2 over it.
- On macOS that message now gives the Mac's own command (`launchctl`), not Linux's `systemctl`.
- On Linux and macOS, an error from a running helper is shown as such, no longer as "the service is not running".

**DT Connect 1.1.1**

- **Disconnecting OpenVPN now ends the session on the server too.** Over UDP the app sends OpenVPN's exit notification and lets OpenVPN finish, where it used to stop it at once (on Windows by ending the process). The server lets go of the session within about five seconds instead of holding it, and the account's device slot, for up to two minutes, so switching to another location or protocol right after a disconnect works.
- The app tells the panel when it leaves a connection: which protocol, at which location, and for OpenVPN the tunnel address it had. A panel that counts simultaneous users can then free the slot at once. WireGuard has no message of its own for this. Panels without this feature are unaffected.

**DT Connect 1.1.0**

- **Report a problem**: every app keeps a log since it started (each connection attempt and why it failed, the VPN engines' messages), with passwords, keys and links taken out. Settings → Support on the desktop and Account → Report a problem on Android show it, copy it, save or share it, and send it with a message to support, who see it under the user's account (on panels that take reports).
- **WireGuard** connects again on every system: the app builds it from the config's link, since the panel's version of it could carry a broken key.
- **OpenVPN on Windows** connects: the app now ships the TAP-Windows6 and ovpn-dco drivers and adds its own adapters the first time OpenVPN is used (uninstalling removes them).
- **Android** runs the same Xray release as the desktop app (it had been left on March's), and every system looks a server's name up before connecting, so a config with a server name no longer waits on itself.
- VLESS and Trojan without TLS (often to a relay in the country), which current Xray refuses, connect.

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
