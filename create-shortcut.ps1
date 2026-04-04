$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$env:USERPROFILE\Desktop\LocalERP.lnk")
$Shortcut.TargetPath = "C:\Users\JordanLytle\local-erp\run-local-erp.bat"
$Shortcut.WorkingDirectory = "C:\Users\JordanLytle\local-erp"
$Shortcut.IconLocation = "C:\Users\JordanLytle\local-erp\localerp-icon.ico, 0"
$Shortcut.Save()
