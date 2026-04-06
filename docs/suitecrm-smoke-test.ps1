param(
    [string]$ApiBase = "http://127.0.0.1:8011",
    [string]$Token,
    [string]$Module = "Leads"
)

if (-not $Token) {
    throw "Provide -Token with a valid admin JWT."
}

$headers = @{
    Authorization = "Bearer $Token"
    "Content-Type" = "application/json"
}

Write-Host "1) Health check" -ForegroundColor Cyan
$health = Invoke-RestMethod -Method Get -Uri "$ApiBase/admin/suitecrm/health" -Headers $headers
$health | ConvertTo-Json -Depth 8

if ($health.configured -and $health.connected) {
    Write-Host "2) Sample read" -ForegroundColor Cyan
    $read = Invoke-RestMethod -Method Get -Uri "$ApiBase/admin/suitecrm/sample-read?module=$Module&max_results=3" -Headers $headers
    $read | ConvertTo-Json -Depth 8
} else {
    Write-Host "2) Sample read skipped (SuiteCRM not configured)" -ForegroundColor Yellow
}

Write-Host "3) Get or create local record" -ForegroundColor Cyan
$records = Invoke-RestMethod -Method Get -Uri "$ApiBase/crm?limit=1" -Headers $headers
if (-not $records -or $records.Count -eq 0) {
    $newBody = '{"company":"Smoke Co","contact":"smoke@example.com","status":"No Contact","township":1,"range":1,"section":1,"extra_data":{"phone":"5551234567"}}'
    $created = Invoke-RestMethod -Method Post -Uri "$ApiBase/crm" -Headers $headers -Body $newBody
    $recordId = $created.id
} else {
    $recordId = $records[0].id
}
Write-Host "Record ID: $recordId" -ForegroundColor Yellow

Write-Host "4) Dry-run payload" -ForegroundColor Cyan
$dryRun = Invoke-RestMethod -Method Get -Uri "$ApiBase/admin/suitecrm/sync-record/$recordId/dry-run?module=$Module" -Headers $headers
$dryRun | ConvertTo-Json -Depth 12

if ($health.configured -and $health.connected) {
    Write-Host "5) Real sync" -ForegroundColor Cyan
    $sync = Invoke-RestMethod -Method Post -Uri "$ApiBase/admin/suitecrm/sync-record/$recordId?module=$Module" -Headers $headers
    $sync | ConvertTo-Json -Depth 12
} else {
    Write-Host "5) Real sync skipped (SuiteCRM not configured)" -ForegroundColor Yellow
}

Write-Host "6) Recent sync logs" -ForegroundColor Cyan
$logs = Invoke-RestMethod -Method Get -Uri "$ApiBase/admin/suitecrm/sync-log-tail?lines=10" -Headers $headers
$logs | ConvertTo-Json -Depth 12
