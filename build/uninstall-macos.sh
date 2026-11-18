#!/bin/sh
# Removes DT Connect from a Mac: sudo "/Applications/DT Connect.app/Contents/Resources/uninstall.sh"
if [ "$(id -u)" != 0 ]; then echo "Run with sudo." >&2; exit 1; fi
launchctl bootout system/team.datacraft.dtclient.helper >/dev/null 2>&1 || true
rm -f /Library/LaunchDaemons/team.datacraft.dtclient.helper.plist /var/run/dt-connect.sock
rm -rf "/Library/Application Support/DT Connect" "/Applications/DT Connect.app"
pkgutil --forget team.datacraft.dtclient >/dev/null 2>&1 || true
echo "DT Connect removed."
