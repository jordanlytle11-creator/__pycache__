param(
    [Parameter(Mandatory = $true)]
    [string]$ApiKey,

    [Parameter(Mandatory = $true)]
    [string]$ServiceId,

    [switch]$ClearBuildCache,

    [int]$PollSeconds = 8,

    [int]$TimeoutMinutes = 20
)

$base = "https://api.render.com/v1"
$headers = @{
    Authorization = "Bearer $ApiKey"
    Accept = "application/json"
    "Content-Type" = "application/json"
}

$deployBody = @{}
if ($ClearBuildCache.IsPresent) {
    $deployBody.clearCache = "clear"
}

Write-Host "Triggering Render deploy for service $ServiceId" -ForegroundColor Cyan
$trigger = Invoke-RestMethod -Method Post -Uri "$base/services/$ServiceId/deploys" -Headers $headers -Body (($deployBody | ConvertTo-Json -Compress))

$deployId = $trigger.id
if (-not $deployId) {
    throw "Render deploy trigger did not return a deploy id."
}

Write-Host "Deploy started: $deployId" -ForegroundColor Yellow

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds $PollSeconds
    $status = Invoke-RestMethod -Method Get -Uri "$base/services/$ServiceId/deploys/$deployId" -Headers $headers
    $rawState = ''
    if ($null -ne $status -and $null -ne $status.status) {
        $rawState = [string]$status.status
    }
    $state = $rawState.ToLowerInvariant()
    Write-Host "Status: $($status.status)" -ForegroundColor Gray

    if ($state -in @('live', 'succeeded', 'success')) {
        Write-Host "Deploy finished successfully." -ForegroundColor Green
        $status | ConvertTo-Json -Depth 8
        exit 0
    }

    if ($state -in @('build_failed', 'update_failed', 'failed', 'canceled')) {
        Write-Host "Deploy failed." -ForegroundColor Red
        $status | ConvertTo-Json -Depth 8
        exit 1
    }
}

Write-Host "Timed out waiting for deploy completion." -ForegroundColor Red
exit 2