; Removes what DT Connect set up outside its folder; an update (the old version's uninstaller run by
; the new installer) keeps it.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    nsExec::Exec `schtasks /Delete /F /TN "DT Connect"`
    nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Remove-VpnConnection -Name 'DT Connect L2TP' -Force -ErrorAction SilentlyContinue"`
    ; The OpenVPN adapters the app added on first use (src/main/system/openvpnAdapters.ts).
    nsExec::Exec `"$INSTDIR\resources\bin\openvpn\tapctl.exe" delete "DT Connect TAP"`
    nsExec::Exec `"$INSTDIR\resources\bin\openvpn\tapctl.exe" delete "DT Connect DCO"`
  ${endIf}
!macroend
