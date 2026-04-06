param(
    [string]$ApiBase,
    [string]$Token,
    [string]$Username = 'admin@localerp.com',
    [string]$Password = 'admin',
    [string]$Module = 'Leads',
    [int]$HealthChecks = 10,
    [int]$ReadChecks = 10,
    [int]$WriteChecks = 20,
    [double]$MinWriteSuccessRate = 0.95
)

if (-not $ApiBase) {
    throw 'Provide -ApiBase with the deployed application URL.'
}

$ApiBase = $ApiBase.TrimEnd('/')

if (-not $Token) {
    $loginBody = @{ username = $Username; password = $Password }
    $loginResponse = Invoke-RestMethod -Method Post -Uri "$ApiBase/token" -Body $loginBody
    $Token = $loginResponse.access_token
}

if (-not $Token) {
    throw 'Could not obtain a bearer token.'
}

$headers = @{
    Authorization = "Bearer $Token"
    'Content-Type' = 'application/json'
}

function Invoke-JsonGet {
    param(
        [string]$Uri
    )

    Invoke-RestMethod -Method Get -Uri $Uri -Headers $headers
}

function Invoke-JsonPost {
    param(
        [string]$Uri,
        [string]$Body
    )

    if ($null -ne $Body) {
        Invoke-RestMethod -Method Post -Uri $Uri -Headers $headers -Body $Body
    } else {
        Invoke-RestMethod -Method Post -Uri $Uri -Headers $headers
    }
}

function New-SmokeRecordBody {
    param(
        [int]$Index
    )

    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
    $payload = @{
        company = "Spike Company $stamp $Index"
        contact = "suitecrm-spike-$stamp-$Index@example.com"
        status = 'No Contact'
        township = 1
        range = 1
        section = ($Index % 36) + 1
        extra_data = @{
            phone = ('555{0:D7}' -f ($Index + 1000))
        }
    }

    return ($payload | ConvertTo-Json -Depth 8 -Compress)
}

$healthPass = 0
$readPass = 0
$writePass = 0
$writeResults = @()
$idempotencyPass = $false
$logAuditPass = $false
$healthConfigured = $false

Write-Host "Running $HealthChecks SuiteCRM health checks against $ApiBase" -ForegroundColor Cyan
for ($i = 1; $i -le $HealthChecks; $i++) {
    try {
        $response = Invoke-JsonGet -Uri "$ApiBase/admin/suitecrm/health"
        if ($response.configured -and $response.connected) {
            $healthPass++
            $healthConfigured = $true
        }
    } catch {
    }
}

Write-Host "Running $ReadChecks SuiteCRM sample reads" -ForegroundColor Cyan
for ($i = 1; $i -le $ReadChecks; $i++) {
    try {
        $null = Invoke-JsonGet -Uri "$ApiBase/admin/suitecrm/sample-read?module=$Module&max_results=3"
        $readPass++
    } catch {
    }
}

Write-Host "Running $WriteChecks SuiteCRM sync attempts" -ForegroundColor Cyan
for ($i = 1; $i -le $WriteChecks; $i++) {
    $recordBody = New-SmokeRecordBody -Index $i
    try {
        $created = Invoke-JsonPost -Uri "$ApiBase/crm" -Body $recordBody
        $sync = Invoke-JsonPost -Uri "$ApiBase/admin/suitecrm/sync-record/$($created.id)?module=$Module" -Body $null
        $suitecrmId = $null
        if ($sync -and $sync.suitecrm_id) {
            $suitecrmId = $sync.suitecrm_id
        }
        $writePass++
        $writeResults += [pscustomobject]@{
            local_record_id = $created.id
            suitecrm_id = $suitecrmId
            ok = $true
        }
    } catch {
        $writeResults += [pscustomobject]@{
            local_record_id = $null
            suitecrm_id = $null
            ok = $false
            error = $_.Exception.Message
        }
    }
}

$writeRate = 0.0
if ($WriteChecks -gt 0) {
    $writeRate = $writePass / $WriteChecks
}

$firstSuccessfulWrite = $writeResults | Where-Object { $_.ok -and $_.suitecrm_id } | Select-Object -First 1
if ($null -ne $firstSuccessfulWrite) {
    try {
        $repeatSync = Invoke-JsonPost -Uri "$ApiBase/admin/suitecrm/sync-record/$($firstSuccessfulWrite.local_record_id)?module=$Module" -Body $null
        if ($repeatSync.suitecrm_id -and $repeatSync.suitecrm_id -eq $firstSuccessfulWrite.suitecrm_id) {
            $idempotencyPass = $true
        }
    } catch {
    }
}

try {
    $logs = Invoke-JsonGet -Uri "$ApiBase/admin/suitecrm/sync-log-tail?lines=100"
    if ($logs.lines) {
        $matchingLogLines = @($logs.lines | Where-Object {
            $_.payload -and $_.payload.local_record_id
        })
        if ($matchingLogLines.Count -gt 0) {
            $logAuditPass = $true
        }
    }
} catch {
}

$summary = [pscustomobject]@{
    api_base = $ApiBase
    module = $Module
    configured = $healthConfigured
    health_checks_passed = $healthPass
    health_checks_required = $HealthChecks
    health_gate_pass = ($healthPass -eq $HealthChecks)
    read_checks_passed = $readPass
    read_checks_required = $ReadChecks
    read_gate_pass = ($readPass -eq $ReadChecks)
    write_checks_passed = $writePass
    write_checks_required = $WriteChecks
    write_success_rate = [Math]::Round($writeRate, 4)
    write_gate_pass = ($writeRate -ge $MinWriteSuccessRate)
    idempotency_pass = $idempotencyPass
    auditability_pass = $logAuditPass
    manual_checks_remaining = @(
        'Spot-check mapping fidelity for 10 records in SuiteCRM',
        'Disable SuiteCRM env vars in Render and confirm routes fail safely without breaking non-SuiteCRM CRM routes'
    )
}

$summary | ConvertTo-Json -Depth 8