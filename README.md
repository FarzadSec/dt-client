# DT Client

The VPN app of DataCraft Team. A customer signs in with the subscription link of their service and their username; the app then shows their account and servers and connects with the protocols the service offers.

Version 0.1 runs on Windows 10 and 11 (64-bit). macOS, Linux and Android follow. iOS users keep using the subscription link in Streisand, Happ or other apps, and share the same device limit with the app.

## How it works

The app talks to the Manifold panel's app API on the subscription server (`<subscription link>/app/v1`):

| Call | What it does |
| --- | --- |
| `POST /login` | The username of one of the link's accounts plus a device id (from Windows' MachineGuid) returns a session token. The device takes a slot of the account's device limit. |
| `GET /profile` | The account (usage, expiry, devices), the locations and every configuration of the subscription, with the Xray outbound of each one Xray runs. |
| `POST /logout` | Ends the session. |

App access is switched on in the panel under **Settings → App**, where each server also gets its name, country, city and timezone.

Engines, all started by the app (which runs as administrator):

| Protocols | Engine |
| --- | --- |
| VLESS, VMess, Trojan, Shadowsocks, Hysteria 2, WireGuard | `xray.exe` with the outbound from the panel, behind `sing-box.exe` as the system-wide TUN (wintun). The engines' own traffic leaves directly; DNS goes through the tunnel. |
| OpenVPN | `openvpn.exe` 2.6 with the panel's profile, on wintun, stopped through its management port. |
| L2TP/IPsec | Windows' own client: a VPN connection added with `Add-VpnConnection` and dialled with `rasdial`. |

**Automatic** tries the Xray protocols of the chosen location first, then WireGuard, OpenVPN and L2TP, and keeps the first that answers (an Xray config must fetch `https://www.gstatic.com/generate_204` through itself).

The window follows the layout of the big VPN apps: a rail of pages (home, locations, settings), a location search in the title bar, a home page with a world map that moves to the chosen server, the connection state and a quick-connect button, recent locations, time connected over the last seven days, the account and the protection switches; a location list grouped by country with ping and a protocol filter; and settings in sections. Persian (right to left) and English, dark, light or the system's theme. The map is Natural Earth (via `world-atlas`), drawn once by `scripts/gen-map.mjs` into `src/renderer/geo/`.

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

`node scripts/fetch-binaries.mjs` (Windows) downloads the engines into `resources/bin`: the latest Xray and sing-box, OpenVPN 2.6 (the last line that drives wintun) from its MSI, and wintun. `npm run dist:win` builds `release/DT-Client-Setup-<version>.exe`.

CI (`.github/workflows/build.yml`) runs the tests on Linux, then on Windows fetches the engines, checks the configurations the app writes with `xray run -test` and `sing-box check`, and builds the installer, uploaded as the `DT-Client-Setup` artifact. A `v*` tag publishes it as a release.

The installer is not code-signed yet, so Windows SmartScreen asks once before running it (More info → Run anyway).
