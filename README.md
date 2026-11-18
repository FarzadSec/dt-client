# DT Connect

The VPN app of DataCraft (Persian: دی‌تی کانکت). A customer signs in with the subscription link of their service and their username; the app then shows their account and servers and connects with the protocols the service offers.

## Signing in

The DataCraft bot's delivery message carries both values and a **sign-in QR code**. Its content is a link:

```
dtconnect://login?sub=<subscription link, percent-encoded>&user=<username, percent-encoded>
```

- **Android**: *Scan sign-in QR code* on the welcome page opens the camera (ZXing, works without Google services); *Choose a QR picture* reads the QR code from a screenshot or the photo the bot sent, for a customer whose QR code is on the same phone. Tapping the link opens the app and signs in.
- **Windows, Linux, macOS**: the app registers `dtconnect://`, so opening the link signs in; pasting it into the subscription link field fills both fields.
- A plain subscription link (QR code or pasted) fills the link and asks for the username.

Opening a link of another account while signed in asks before switching.

Runs on Windows 10 and 11 (64-bit), Linux (Debian, Ubuntu and their family, Fedora, RHEL, openSUSE, Arch and Manjaro; x64 and ARM64) macOS 12 or later (Intel and Apple silicon) and Android 5.0 or later (every processor family; see `android/README.md`). iOS users keep using the subscription link in Streisand, Happ or other apps, and share the same device limit with the app.

## Installing

| System | Installer | How |
| --- | --- | --- |
| Windows | `DT-Connect-Setup-<version>.exe` | Run it. Windows SmartScreen asks once (More info → Run anyway) until the installer is code-signed. |
| Debian, Ubuntu, Mint, Pop!_OS | `DT-Connect-<version>-linux-amd64.deb` (`arm64` on ARM) | `sudo apt install ./DT-Connect-<version>-linux-amd64.deb` |
| Fedora, RHEL, Rocky, AlmaLinux, openSUSE | `DT-Connect-<version>-linux-x86_64.rpm` (`aarch64` on ARM) | `sudo dnf install ./DT-Connect-<version>-linux-x86_64.rpm` (openSUSE: `sudo zypper install …`) |
| Arch, Manjaro, EndeavourOS | `DT-Connect-<version>-linux-x64.pacman` (`aarch64` on ARM) | `sudo pacman -U ./DT-Connect-<version>-linux-x64.pacman` |
| macOS, Apple silicon | `DT-Connect-<version>-mac-arm64.pkg` | Open it. Until the package is notarized macOS refuses the first time: open **System Settings → Privacy & Security** and press **Open Anyway**. |
| macOS, Intel | `DT-Connect-<version>-mac-x64.pkg` | As above. |
| Android 5.0+ | `DT-Connect-<version>-android-arm64-v8a.apk` (most phones), `armeabi-v7a` (older phones), `x86_64`/`x86` (emulators, a few tablets), or `universal` (any) | Open the APK and allow installing from that source once. |

Each package installs the app and its helper service and removes both when uninstalled (`sudo apt remove dt-connect`, `sudo dnf remove dt-connect`, `sudo pacman -R dt-connect`; on macOS `sudo "/Applications/DT Connect.app/Contents/Resources/uninstall.sh"`). Nothing else is installed or left running. Every release lists the SHA-256 of each file in `SHA256SUMS.txt`.

### Linux and macOS: the helper

A VPN needs administrator rights for the tunnel, routes, DNS and timezone, while the app's window should run as the user. So on Linux and macOS the engines run in a small root helper, the same program started without its window: a systemd service (`dt-connect-helper`) on Linux and a LaunchDaemon (`team.datacraft.dtclient.helper`) on macOS. The app talks to it over a local socket (`/run/dt-connect/helper.sock`, `/var/run/dt-connect.sock`) with four requests: who are you, status, connect, disconnect. The helper checks what it is given, since anyone on the computer can reach the socket: OpenVPN profiles that would run programs, read files or open a control port are refused, Xray outbounds lose any file they would read, and DNS, timezone and program names must be plain values.

What differs by system:

| | Windows | Linux | macOS | Android |
| --- | --- | --- | --- | --- |
| Xray protocols and WireGuard | ✓ | ✓ | ✓ | ✓ |
| OpenVPN | bundled (2.6, wintun) | the system's `openvpn` package (installed with the app) | Homebrew's: `brew install openvpn` | bundled (2.7, built from source, see `android/README.md`) |
| L2TP/IPsec | Windows' own client | NetworkManager with its L2TP plugin (`network-manager-l2tp`, `NetworkManager-l2tp` or `networkmanager-l2tp`, recommended by the package) | not offered: macOS sets up L2TP only from a profile the user installs by hand | not offered: apps cannot drive Android's own client, and Android 12 removed it |
| Kill switch, split tunneling, Iranian sites direct | ✓ | ✓ | ✓ | Android's own kill switch, apps without VPN; Iranian sites direct on Xray and WireGuard |
| WebRTC leak protection | Chrome, Edge, Brave policy | the same policy as a file in `/etc/…/policies/managed` | not offered | not offered |
| Match timezone | `tzutil` | `timedatectl` | `systemsetup` | not offered |
| Launch at startup | scheduled task | `~/.config/autostart` | login item | Android's Always-on VPN |

## How it works

The app talks to the Manifold panel's app API on the subscription server (`<subscription link>/app/v1`):

| Call | What it does |
| --- | --- |
| `POST /login` | The username of one of the link's accounts plus a device id (from Windows' MachineGuid) returns a session token. The device takes a slot of the account's device limit. |
| `GET /profile` | The account (usage, expiry, devices), the locations, every configuration of the subscription, with the Xray outbound of each one Xray runs, and the panel's notices (Manifold 0.18+). |
| `POST /logout` | Ends the session. |

App access is switched on in the panel under **Settings → App**, where each server also gets its name, country, city and timezone.

The app fetches the profile again every 10 minutes, when the computer wakes, and when the refresh button in the title bar is pressed, so locations, configs and notices changed on the panel reach it within that time. When the panel cannot be reached the last profile is kept and the button says so.

**Notices** are published from the panel under **Settings → App notices** at a level: info goes to the bell in the title bar, warning and critical also show as an amber or red banner at the top of every page until closed with its ✕, and one that arrives while the window is in the tray comes as a system notification too. Notices are written in Persian, so they are always laid out right to left in Vazirmatn, also when the app is in English. The bell counts what arrived since it was last opened.

OpenVPN and L2TP need a login: the panel puts the account's username and password in the OpenVPN profile (always, for the app) and in the L2TP link, and the app connects with them, so the customer never types them.

Engines, all started by the app (which runs as administrator):

| Protocols | Engine |
| --- | --- |
| VLESS, VMess, Trojan, Shadowsocks, Hysteria 2, WireGuard | `xray.exe` with the outbound from the panel, behind `sing-box.exe` as the system-wide TUN (wintun). The engines' own traffic leaves directly; DNS goes through the tunnel. |
| OpenVPN | `openvpn.exe` 2.6 with the panel's profile, on wintun, stopped through its management port. |
| L2TP/IPsec | Windows' own client: a VPN connection added with `Add-VpnConnection` and dialled with `rasdial`. |

**Automatic** tries the Xray protocols of the chosen location first, then WireGuard, OpenVPN and L2TP, and keeps the first that answers (an Xray config must fetch `https://www.gstatic.com/generate_204` through itself).

The window follows the layout of the big VPN apps: a rail of pages (home, locations, settings), a location search in the title bar, a home page with a world map that moves to the chosen server, the connection state and a quick-connect button, recent locations, time connected over the last seven days with the plan's traffic as a bar under it (amber from 80%, red from 95%), the account and the protection switches; a location list grouped by country with ping, a **Test ping** button and a protocol filter; and settings in sections. Ping is the TCP connect time to each server, or an ICMP echo through the system's `ping` for servers that answer on UDP only (WireGuard, Hysteria, L2TP, OpenVPN over UDP) or refuse the TCP connect. Persian (right to left) and English, dark, light or the system's theme. The map is Natural Earth (via `world-atlas`), drawn once by `scripts/gen-map.mjs` into `src/renderer/geo/`.

Settings:

- **Protocol**: automatic, or only Xray, WireGuard, OpenVPN or L2TP.
- **Kill switch** (Xray and WireGuard): the TUN runs with `strict_route`, and if Xray stops the tunnel stays up with nothing behind it until the user disconnects.
- **Reconnect automatically**: a dropped connection is tried again up to three times.
- **Block ads and trackers**: `geosite:category-ads-all` goes to Xray's blackhole.
- **Custom DNS**: the servers sing-box asks through the tunnel and Xray resolves server names with.
- **Split tunneling** (Xray and WireGuard): chosen `.exe` files leave directly by sing-box process rule, and **Iranian sites without VPN** sends `geosite:category-ir`, `.ir` and `geoip:ir` direct.
- **WebRTC leak protection**: sets the `WebRtcIPHandling` policy of Chrome, Edge and Brave to `disable_non_proxied_udp` while connected, and restores it after.
- **Match timezone**: sets Windows' timezone to the location's (`tzutil`) while connected and restores it after.
- Launch at startup (a scheduled task, since the app needs administrator rights), launch minimized to the tray, connect when the app starts, connection notifications, language and appearance.

The session token and the profile are stored sealed with Electron's `safeStorage` (DPAPI).

## Development

Node 22. The app is Electron with a React window; the main process is bundled with esbuild, the window with Vite.

```
npm ci
npm test          # unit tests
npm run typecheck
npm run build     # dist/
```

`node scripts/fetch-binaries.mjs <win|linux|mac> <x64|arm64>` downloads the engines into `resources/bin/<os>-<arch>`: the latest Xray (checked against its published SHA-256) and sing-box from their GitHub releases, and on Windows OpenVPN 2.6 (the last line that drives wintun) from its MSI, and wintun. `npm run dist:win`, `dist:linux` and `dist:mac` build the installers into `release/`. The helper is `src/helper/helper.ts`, bundled to `dist/helper/helper.js`.

CI (`.github/workflows/build.yml`) runs the tests, then for each system fetches the engines, checks the configurations the app writes with the real `xray run -test` and `sing-box check`, and builds the installers. On Linux it installs the deb on the runner, checks the helper service answers on its socket and removes the package, and installs the deb, rpm and pacman packages in Debian, Ubuntu, Fedora and Arch containers to check every dependency resolves. macOS (Intel and Apple silicon from one runner) builds for a release and when the workflow is started by hand with **macOS** ticked; it installs the Apple silicon package, checks the signature, that the helper answers, and uninstalls. A push to `main` whose `package.json` version has no release yet (or a `v*` tag, or a release made on GitHub's Releases page) publishes every installer with `SHA256SUMS.txt` as that version's release; macOS is built for it too.

Nothing is code-signed with a paid certificate yet: Windows SmartScreen asks once (More info → Run anyway) and macOS needs **Open Anyway** once. The macOS app is signed ad hoc, which Apple silicon requires to run at all. A Windows code-signing certificate and an Apple Developer ID (with notarization) remove both prompts; the build only needs them added as secrets.
