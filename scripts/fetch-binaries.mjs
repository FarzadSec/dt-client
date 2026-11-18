// Downloads the engines DT Connect runs into resources/bin/<os>-<arch> (CI):
//   node scripts/fetch-binaries.mjs win x64 | linux x64 | linux arm64 | mac x64 | mac arm64
// Xray and sing-box everywhere; on Windows also OpenVPN 2.6 and wintun (run there: it unpacks an MSI).
// Linux and macOS use the system's OpenVPN. Xray's archives are checked against its published digests.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const target = process.argv[2] ?? 'win';
const arch = process.argv[3] ?? 'x64';
if (!['win', 'linux', 'mac'].includes(target) || !['x64', 'arm64'].includes(arch)) throw new Error(`unknown target ${target} ${arch}`);
const bin = path.resolve('resources/bin', `${target}-${arch}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-bin-'));
const headers = { 'User-Agent': 'dt-connect-build', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const versions = [];

async function json(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function download(url, file) {
  const res = await fetch(url, { headers: { 'User-Agent': 'dt-connect-build' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    // Windows' own bsdtar reads zip. Expand-Archive broke when a PowerShell 7 step started
    // Windows PowerShell, which then loaded PowerShell 7's archive module.
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  } else if (zip.endsWith('.zip')) {
    execFileSync('unzip', ['-q', '-o', zip, '-d', dest], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xzf', zip, '-C', dest], { stdio: 'inherit' });
  }
  return dest;
}

// Xray publishes Xray-<os>.zip.dgst beside each archive, with its SHA2-256.
async function checkXrayDigest(rel, name, file) {
  const dgst = rel.assets.find((x) => x.name === `${name}.dgst`);
  if (!dgst) throw new Error(`${rel.tag_name}: no digest for ${name}`);
  const text = Buffer.from(await (await fetch(dgst.browser_download_url, { headers: { 'User-Agent': 'dt-connect-build' }, redirect: 'follow' })).arrayBuffer()).toString();
  const want = /SHA2-256=\s*([0-9a-f]{64})/i.exec(text)?.[1];
  const got = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!want || want.toLowerCase() !== got) throw new Error(`${name}: digest mismatch`);
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

fs.mkdirSync(bin, { recursive: true });
const exe = target === 'win' ? '.exe' : '';

const xrayNames = { 'win-x64': 'Xray-windows-64.zip', 'linux-x64': 'Xray-linux-64.zip', 'linux-arm64': 'Xray-linux-arm64-v8a.zip', 'mac-x64': 'Xray-macos-64.zip', 'mac-arm64': 'Xray-macos-arm64-v8a.zip' };
const xrayName = xrayNames[`${target}-${arch}`];
if (!xrayName) throw new Error(`no Xray build for ${target} ${arch}`);
const xray = await release('XTLS/Xray-core', () => true);
const xrayZip = await download(asset(xray, new RegExp(`^${xrayName.replace(/\./g, '\\.')}$`)), path.join(tmp, 'xray.zip'));
await checkXrayDigest(xray, xrayName, xrayZip);
const xrayDir = unzip(xrayZip, path.join(tmp, 'xray'));
for (const f of [`xray${exe}`, 'geoip.dat', 'geosite.dat']) fs.copyFileSync(path.join(xrayDir, f), path.join(bin, f));
versions.push(`xray ${xray.tag_name}`);

const sbNames = { 'win-x64': /windows-amd64\.zip$/, 'linux-x64': /linux-amd64\.tar\.gz$/, 'linux-arm64': /linux-arm64\.tar\.gz$/, 'mac-x64': /darwin-amd64\.tar\.gz$/, 'mac-arm64': /darwin-arm64\.tar\.gz$/ };
const singbox = await release('SagerNet/sing-box', () => true);
const sbPattern = sbNames[`${target}-${arch}`];
const sbArchive = await download(asset(singbox, sbPattern), path.join(tmp, target === 'win' ? 'sing-box.zip' : 'sing-box.tar.gz'));
const sbDir = unzip(sbArchive, path.join(tmp, 'sing-box'));
fs.copyFileSync(find(sbDir, `sing-box${exe}`), path.join(bin, `sing-box${exe}`));
versions.push(`sing-box ${singbox.tag_name}`);

if (target !== 'win') {
  for (const f of ['xray', 'sing-box']) fs.chmodSync(path.join(bin, f), 0o755);
  fs.writeFileSync(path.join(bin, 'VERSIONS.txt'), versions.join('\n') + '\n');
  console.log(versions.join('\n'));
  process.exit(0);
}
fs.mkdirSync(path.join(bin, 'openvpn'), { recursive: true });

// 2.6 is the last line that drives wintun, which needs no driver installed; 2.7 dropped it.
// Its Windows builds are tags of openvpn-build; a tag can precede its published MSI.
const ovpnTags = execFileSync('git', ['ls-remote', '--tags', 'https://github.com/OpenVPN/openvpn-build'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => /refs\/tags\/(OpenVPN-2\.6\.(\d+)-I(\d+))$/.exec(line))
  .filter(Boolean)
  .sort((a, b) => Number(b[2]) - Number(a[2]) || Number(b[3]) - Number(a[3]))
  .map((m) => m[1]);
const msi = path.join(tmp, 'openvpn.msi');
let ovpn = null;
for (const tag of ovpnTags.slice(0, 8)) {
  for (const url of [
    `https://github.com/OpenVPN/openvpn-build/releases/download/${tag}/${tag}-amd64.msi`,
    `https://swupdate.openvpn.org/community/releases/${tag}-amd64.msi`,
  ]) {
    try {
      await download(url, msi);
      ovpn = { tag_name: tag };
      break;
    } catch (err) {
      console.log(`skip ${url}: ${err.message}`);
    }
  }
  if (ovpn) break;
}
if (!ovpn) throw new Error('no OpenVPN 2.6 MSI found');
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
