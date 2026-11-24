**DT Connect 1.2.0**

- **Sign in with the subscription link alone.** No username to type: the app reads the account from the link. A sign-in QR code or `dtconnect://` link still works.
- **Several accounts on one device.** Settings → Account on the desktop and the Account tab on Android list every subscription signed in on the device; add another with its link, switch between them, or remove one.
- **Real ping.** The delay shown for each server is measured the way the panel's outbound test does it: a request to Google's empty page (`generate_204`) through each V2Ray and WireGuard config, and for OpenVPN and L2TP/IPsec the server's own answer to the first handshake message. A relay in front of a server no longer makes it look close.
- **Traffic is checked, not just the connection.** A connection counts only once the test page comes back through it. While connected, the app keeps checking: if traffic stops passing, **Auto** switches to another protocol by itself, and a chosen protocol shows a warning to switch.
- **Live chart** of download, upload and ping in the map card while connected; a red **Timeout** when the test page does not come back.
- **Protocol and location on the home page**, in the map card, where they are seen.
- **Leak protection**: strict routes on the V2Ray/WireGuard tunnel by default (DNS and everything else stay inside), and IPv6 held back while OpenVPN or L2TP (which carry IPv4 only) is connected, so nothing leaves from the real address. Android already sends everything, IPv6 included, into the tunnel.
- **App and site lock**: pick apps and sites that must not be used without the VPN. While it is off, locked sites do not open and locked apps are closed (Android: their traffic is held back); the app offers **Connect now** or a 15-minute skip.
- **Plan warnings**: two days or 3 GB before the plan ends (and once it has), a warning every time the app is opened, and a notification when it happens in the background.
- **The subscription is fetched every time the app is opened**, then every 10 minutes by the clock (also after the computer or phone wakes), with no cache in between. The home page shows when it was last fetched.
- **Android: a more compact layout** (smaller cards, map, buttons and type), and round flag images that sit straight in their circles.

**DT Connect 1.1.4**

- **macOS: browsers work over V2Ray and WireGuard.** The Mac kept asking its network's DNS server (usually the router) for names, outside the tunnel, so filtered sites came back with the filter's addresses and did not open, while Telegram, which needs no DNS, worked. While connected with V2Ray, WireGuard or OpenVPN, the app now sets the Mac's DNS servers to the ones in the DNS setting (1.1.1.1 and 8.8.8.8 by default), which go through the tunnel, and puts the previous ones back when it disconnects. If the app or the Mac stopped while connected, they are put back the next time its service starts.

**DT Connect 1.1.3**

- Downloads now come from the DataCraft download page, [github.com/DataCraft-Team/DT-Connect](https://github.com/DataCraft-Team/DT-Connect).
- **WireGuard on Windows now runs on the official WireGuard engine**, the tunnel service and WireGuardNT driver of WireGuard for Windows, which ship with the app. A config that works in the official WireGuard app now works in DT Connect too. Kill switch, Iran direct and the DNS setting apply to it; per-app split tunnelling does not cover WireGuard on Windows.
- Disconnecting, or connecting again, while a connection is still being tested now stops that test at once. Before, the earlier attempt kept running and could mark the new one as failed.
- After a WireGuard attempt that fails, the app tells the panel the device left, so a limited account's slot is free at once.

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
