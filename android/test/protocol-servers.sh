#!/usr/bin/env bash
# Servers for the emulator tests, one per protocol the app runs through Xray, set up the way Manifold
# sets them up: VLESS + REALITY + Vision, VMess over WebSocket, Trojan, Shadowsocks 2022 (all in one
# Xray, recording who connected in its access log), and WireGuard on the kernel (wg) with NAT, as
# Manifold's wg-quick inbounds are. Each client side, as the panel's app API hands it to the app,
# goes to <out>/<name>.json. The emulator reaches this machine as 10.0.2.2.
# Usage: protocol-servers.sh <xray binary> <out dir>
set -euo pipefail

xray=$(readlink -f "$1")
out=$(mkdir -p "$2" && cd "$2" && pwd)
host=${TEST_REMOTE:-10.0.2.2}

b64url() { base64 -w0 | tr '+/' '-_' | tr -d '='; }
# An X25519 key pair as REALITY and WireGuard write them: url-safe base64 (REALITY), plain base64 (WireGuard).
x25519() {
  openssl genpkey -algorithm x25519 -out "$out/key.pem" 2>/dev/null
  priv=$(openssl pkey -in "$out/key.pem" -outform DER | tail -c 32 | base64 -w0)
  pub=$(openssl pkey -in "$out/key.pem" -pubout -outform DER | tail -c 32 | base64 -w0)
  rm -f "$out/key.pem"
}

uuid_vless=$(cat /proc/sys/kernel/random/uuid)
uuid_vmess=$(cat /proc/sys/kernel/random/uuid)
trojan_pass=$(openssl rand -hex 12)
ss_key=$(openssl rand -base64 16)
short_id=$(openssl rand -hex 4)
x25519
reality_priv=$(printf '%s' "$priv" | base64 -d | b64url)
reality_pub=$(printf '%s' "$pub" | base64 -d | b64url)

cat >"$out/server.json" <<JSON
{
  "log": {"loglevel": "warning", "access": "$out/access.log", "error": "$out/error.log"},
  "inbounds": [
    {"tag": "vless", "port": 8443, "protocol": "vless",
     "settings": {"clients": [{"id": "$uuid_vless", "flow": "xtls-rprx-vision", "email": "vless@test"}], "decryption": "none"},
     "streamSettings": {"network": "tcp", "security": "reality",
       "realitySettings": {"dest": "www.microsoft.com:443", "serverNames": ["www.microsoft.com"], "privateKey": "$reality_priv", "shortIds": ["$short_id"]}}},
    {"tag": "vmess", "port": 8080, "protocol": "vmess",
     "settings": {"clients": [{"id": "$uuid_vmess", "email": "vmess@test"}]},
     "streamSettings": {"network": "ws", "wsSettings": {"path": "/vm"}}},
    {"tag": "trojan", "port": 8081, "protocol": "trojan",
     "settings": {"clients": [{"password": "$trojan_pass", "email": "trojan@test"}]},
     "streamSettings": {"network": "tcp"}},
    {"tag": "shadowsocks", "port": 8388, "protocol": "shadowsocks",
     "settings": {"method": "2022-blake3-aes-128-gcm", "password": "$ss_key", "network": "tcp,udp", "email": "shadowsocks@test"}}
  ],
  "outbounds": [{"protocol": "freedom"}]
}
JSON
"$xray" run -test -c "$out/server.json"
nohup "$xray" run -c "$out/server.json" >"$out/xray.out" 2>&1 &
echo $! >"$out/xray.pid"

# What the panel's app API gives the app: the Xray outbound of each config.
cat >"$out/vless.json" <<JSON
{"protocol": "vless", "settings": {"vnext": [{"address": "$host", "port": 8443, "users": [{"id": "$uuid_vless", "flow": "xtls-rprx-vision", "encryption": "none"}]}]},
 "streamSettings": {"network": "tcp", "security": "reality", "realitySettings": {"serverName": "www.microsoft.com", "fingerprint": "chrome", "publicKey": "$reality_pub", "shortId": "$short_id", "spiderX": "/"}}}
JSON
cat >"$out/vmess.json" <<JSON
{"protocol": "vmess", "settings": {"vnext": [{"address": "$host", "port": 8080, "users": [{"id": "$uuid_vmess", "security": "auto"}]}]},
 "streamSettings": {"network": "ws", "wsSettings": {"path": "/vm"}}}
JSON
cat >"$out/trojan.json" <<JSON
{"protocol": "trojan", "settings": {"servers": [{"address": "$host", "port": 8081, "password": "$trojan_pass"}]}, "streamSettings": {"network": "tcp"}}
JSON
cat >"$out/shadowsocks.json" <<JSON
{"protocol": "shadowsocks", "settings": {"servers": [{"address": "$host", "port": 8388, "method": "2022-blake3-aes-128-gcm", "password": "$ss_key"}]}}
JSON

# WireGuard on the kernel, as Manifold runs it, with NAT so the tunnel reaches the internet.
command -v wg >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq wireguard-tools >/dev/null; }
x25519
wg_server_priv=$priv wg_server_pub=$pub
x25519
wg_client_priv=$priv wg_client_pub=$pub
# wg reads the key where Manifold keeps them: AppArmor lets it read /etc/wireguard, not a user's /tmp.
sudo mkdir -p /etc/wireguard
printf '%s' "$wg_server_priv" | sudo tee /etc/wireguard/wgtest.key >/dev/null
sudo chmod 600 /etc/wireguard/wgtest.key
sudo ip link add wgtest type wireguard
sudo wg set wgtest listen-port 51820 private-key /etc/wireguard/wgtest.key peer "$wg_client_pub" allowed-ips 10.66.66.2/32
sudo ip address add 10.66.66.1/24 dev wgtest
sudo ip link set wgtest up
sudo sysctl -qw net.ipv4.ip_forward=1
# Docker on the runner drops forwarded traffic by default; the test's tunnel goes first.
sudo iptables -I FORWARD 1 -i wgtest -j ACCEPT
sudo iptables -I FORWARD 1 -o wgtest -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
sudo iptables -t nat -A POSTROUTING -s 10.66.66.0/24 ! -o wgtest -j MASQUERADE
cat >"$out/wireguard.json" <<JSON
{"protocol": "wireguard", "settings": {"secretKey": "$wg_client_priv", "address": ["10.66.66.2/32"],
 "peers": [{"publicKey": "$wg_server_pub", "endpoint": "$host:51820", "allowedIPs": ["0.0.0.0/0", "::/0"], "keepAlive": 25}], "mtu": 1420}}
JSON

sleep 1
sudo wg show wgtest
ss -ltnu | grep -E ':(8443|8080|8081|8388|51820)\b' || true
