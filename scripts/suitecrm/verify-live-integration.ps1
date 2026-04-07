param(
    [string]$ApiBase = "https://www.vaquerocrm.com",
    [string]$Username = "admin@localerp.com",
    [string]$Password = "admin"
)

$base = $ApiBase.TrimEnd('/')

Write-Host "Authenticating against $base/token" -ForegroundColor Cyan
$tokenResponse = Invoke-RestMethod -Method Post -Uri "$base/token" -Body "username=$([uri]::EscapeDataString($Username))&password=$([uri]::EscapeDataString($Password))" -ContentType "application/x-www-form-urlencoded"
$token = $tokenResponse.access_token

if (-not $token) {
    throw "Failed to obtain access token."
}

$headers = @{ Authorization = "Bearer $token" }

Write-Host "Checking /admin/suitecrm/health" -ForegroundColor Cyan
$health = Invoke-RestMethod -Method Get -Uri "$base/admin/suitecrm/health" -Headers $headers
$health | ConvertTo-Json -Depth 8

Write-Host "Checking /admin/suitecrm/sample-read" -ForegroundColor Cyan
try {
    $read = Invoke-RestMethod -Method Get -Uri "$base/admin/suitecrm/sample-read?module=Leads&max_results=3" -Headers $headers
    $read | ConvertTo-Json -Depth 8
}
catch {
    Write-Host "sample-read failed:" -ForegroundColor Yellow
    Write-Host $_.Exception.Message -ForegroundColor Yellow
}