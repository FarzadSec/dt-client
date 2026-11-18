#!/bin/sh
# Removes DT Client from a Mac: sudo "/Applications/DT Client.app/Contents/Resources/uninstall.sh"
if [ "$(id -u)" != 0 ]; then echo "Run with sudo." >&2; exit 1; fi
launchctl bootout system/team.datacraft.dtclient.helper >/dev/null 2>&1 || true
rm -f /Library/LaunchDaemons/team.datacraft.dtclient.helper.plist /var/run/dt-client.sock
rm -rf "/Library/Application Support/DT Client" "/Applications/DT Client.app"
pkgutil --forget team.datacraft.dtclient >/dev/null 2>&1 || true
echo "DT Client removed."
