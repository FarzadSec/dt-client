// Downloads the engines DT Client runs into resources/bin (CI, Windows): Xray, sing-box, OpenVPN and wintun.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bin = path.resolve('resources/bin');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bin-'));
const headers = { 'User-Agent': 'dt-client-build', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const versions = [];

async function json(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dt-client-build' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function unzip(zip, dest) {
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dest}' -Force`], { stdio: 'inherit' });
  return dest;
}

function find(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = find(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return null;
}

async function release(repo, pick) {
  const releases = await json(`https://api.github.com/repos/${repo}/releases?per_page=60`);
  const chosen = releases.find((r) => !r.draft && !r.prerelease && pick(r.tag_name));
  if (!chosen) throw new Error(`${repo}: no matching release`);
  return chosen;
}

function asset(rel, pattern) {
  const a = rel.assets.find((x) => pattern.test(x.name));
  if (!a) throw new Error(`${rel.tag_name}: no asset matching ${pattern}`);
  return a.browser_download_url;
}

fs.mkdirSync(path.join(bin, 'openvpn'), { recursive: true });

const xray = await release('XTLS/Xray-core', () => true);
const xrayDir = unzip(await download(asset(xray, /^Xray-windows-64\.zip$/), path.join(tmp, 'xray.zip')), path.join(tmp, 'xray'));
for (const f of ['xray.exe', 'geoip.dat', 'geosite.dat']) fs.copyFileSync(path.join(xrayDir, f), path.join(bin, f));
versions.push(`xray ${xray.tag_name}`);

const singbox = await release('SagerNet/sing-box', () => true);
const sbDir = unzip(await download(asset(singbox, /windows-amd64\.zip$/), path.join(tmp, 'sing-box.zip')), path.join(tmp, 'sing-box'));
fs.copyFileSync(find(sbDir, 'sing-box.exe'), path.join(bin, 'sing-box.exe'));
versions.push(`sing-box ${singbox.tag_name}`);

// 2.6 is the last line that drives wintun, which needs no driver installed; 2.7 dropped it.
// Its Windows builds are tags of openvpn-build, not GitHub releases; the MSI is on swupdate.
const ovpnTag = execFileSync('git', ['ls-remote', '--tags', 'https://github.com/OpenVPN/openvpn-build'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => /refs\/tags\/(OpenVPN-2\.6\.(\d+)-I(\d+))$/.exec(line))
  .filter(Boolean)
  .sort((a, b) => Number(a[2]) - Number(b[2]) || Number(a[3]) - Number(b[3]))
  .pop()?.[1];
if (!ovpnTag) throw new Error('no OpenVPN 2.6 build tag');
const ovpn = { tag_name: ovpnTag };
const msi = await download(`https://swupdate.openvpn.org/community/releases/${ovpnTag}-amd64.msi`, path.join(tmp, 'openvpn.msi'));
const ovpnDir = path.join(tmp, 'openvpn');
execFileSync('msiexec.exe', ['/a', msi, '/qn', `TARGETDIR=${ovpnDir}`], { stdio: 'inherit' });
const ovpnExe = find(ovpnDir, 'openvpn.exe');
if (!ovpnExe) throw new Error('openvpn.exe not found in the MSI');
for (const f of fs.readdirSync(path.dirname(ovpnExe))) {
  if (/\.(exe|dll)$/i.test(f)) fs.copyFileSync(path.join(path.dirname(ovpnExe), f), path.join(bin, 'openvpn', f));
}
versions.push(`openvpn ${ovpn.tag_name}`);

const wintunDir = unzip(await download('https://www.wintun.net/builds/wintun-0.14.1.zip', path.join(tmp, 'wintun.zip')), path.join(tmp, 'wintun'));
fs.copyFileSync(path.join(wintunDir, 'wintun', 'bin', 'amd64', 'wintun.dll'), path.join(bin, 'openvpn', 'wintun.dll'));
versions.push('wintun 0.14.1');

fs.writeFileSync(path.join(bin, 'VERSIONS.txt'), versions.join('\n') + '\n');
console.log(versions.join('\n'));
