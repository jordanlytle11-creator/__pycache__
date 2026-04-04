$project = 'C:\Users\JordanLytle\local-erp'
$desktopShortcut = "$env:USERPROFILE\Desktop\LocalERP.lnk"

# ensure venv exists
if (!(Test-Path "$project\.venv")) { python -m venv "$project\.venv" }

# install requirements
& "$project\.venv\Scripts\pip.exe" install -r "$project\requirements.txt"

# create desktop shortcut
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($desktopShortcut)
$sc.TargetPath = 'C:\Windows\System32\cmd.exe'
$sc.Arguments = '/k cd /d C:\Users\JordanLytle\local-erp && .venv\Scripts\activate.bat && uvicorn app.main:app --reload --host 127.0.0.1 --port 8000'
$sc.WorkingDirectory = $project
$sc.IconLocation = 'C:\Windows\System32\shell32.dll, 1'
$sc.Save()

# schedule daily export task for SharePoint sync, if not exists
$taskName = 'LocalERP_SharePoint_Export'
$action = New-ScheduledTaskAction -Execute 'PowerShell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command \"cd '$project'; .\.venv\Scripts\Activate.ps1; Invoke-RestMethod -Uri 'http://127.0.0.1:8000/sharepoint/export' -Method Post -Headers @{'Authorization'='Bearer PUT_YOUR_TOKEN_HERE'}\""
$trigger = New-ScheduledTaskTrigger -Daily -At 23:00
try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force
} catch {
    Write-Output "Task registration failed: $_"
}

Write-Output 'Setup complete. Shortcut created and scheduled task configured. Run the API using the shortcut.'
