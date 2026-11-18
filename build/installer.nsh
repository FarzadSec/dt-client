; Removes what DT Connect set up outside its folder.
!macro customUnInstall
  nsExec::Exec `schtasks /Delete /F /TN "DT Connect"`
  nsExec::Exec `powershell -NoProfile -NonInteractive -Command "Remove-VpnConnection -Name 'DT Connect L2TP' -Force -ErrorAction SilentlyContinue"`
!macroend
