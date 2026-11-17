; Removes what DT Client set up outside its folder.
!macro customUnInstall
  nsExec::Exec `schtasks /Delete /F /TN "DT Client"`
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Remove-VpnConnection -Name 'DT Client L2TP' -Force -ErrorAction SilentlyContinue"`
!macroend
