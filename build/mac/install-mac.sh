#!/bin/bash
# DT Connect for macOS: downloads the newest installer for this Mac, checks it and installs it.
#   curl -fsSL https://github.com/DataCraft-Team/DT-Connect/releases/latest/download/install-mac.sh | bash
# A file curl downloads carries no quarantine mark, so macOS installs it without the "Apple could not
# verify" block that a pkg downloaded in a browser gets while the app has no Apple Developer ID.
set -euo pipefail

repo="${DT_CONNECT_REPO:-DataCraft-Team/DT-Connect}"
# CI points this at the packages it just built.
base="${DT_CONNECT_BASE:-https://github.com/${repo}/releases/latest/download}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This installer is for macOS." >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) arch=arm64 ;;
  x86_64) arch=x64 ;;
  *) echo "Unsupported Mac: $(uname -m)" >&2; exit 1 ;;
esac
# A Terminal running under Rosetta says x86_64 on Apple silicon.
if [ "$arch" = x64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi

pkg="DT-Connect-mac-${arch}.pkg"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading DT Connect for this Mac (${arch})..."
curl -fL --retry 3 --progress-bar -o "$tmp/$pkg" "$base/$pkg"
curl -fsSL --retry 3 -o "$tmp/SHA256SUMS.txt" "$base/SHA256SUMS.txt"
want="$(awk -v f="$pkg" '$2 == f || $2 == "*" f { print $1 }' "$tmp/SHA256SUMS.txt")"
got="$(shasum -a 256 "$tmp/$pkg" | awk '{ print $1 }')"
if [ -z "$want" ] || [ "$want" != "$got" ]; then
  echo "The download does not match SHA256SUMS.txt; nothing was installed. Try again." >&2
  exit 1
fi

echo "Installing. macOS asks for this Mac's password (nothing shows while you type it)."
sudo installer -pkg "$tmp/$pkg" -target /
echo "DT Connect is installed."
[ -n "${DT_CONNECT_NO_OPEN:-}" ] || open -a "DT Connect" >/dev/null 2>&1 || true
