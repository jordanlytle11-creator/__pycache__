param(
    [Parameter(Mandatory = $true)]
    [string]$SuiteCrmBaseUrl
)

$base = $SuiteCrmBaseUrl.TrimEnd('/')
$rest = "$base/service/v4_1/rest.php"

Write-Host "Testing SuiteCRM REST endpoint: $rest" -ForegroundColor Cyan

try {
    $response = Invoke-WebRequest -Uri $rest -MaximumRedirection 8 -ErrorAction Stop
    [pscustomobject]@{
        ok = $true
        status_code = $response.StatusCode
        final_url = $response.BaseResponse.ResponseUri.AbsoluteUri
    } | ConvertTo-Json -Depth 6
}
catch {
    $status = $null
    $body = $null
    $finalUrl = $null

    if ($_.Exception.Response) {
        try { $status = $_.Exception.Response.StatusCode.value__ } catch {}
        try {
            $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
            $body = $reader.ReadToEnd()
        } catch {}
        try { $finalUrl = $_.Exception.Response.ResponseUri.AbsoluteUri } catch {}
    }

    [pscustomobject]@{
        ok = $false
        status_code = $status
        final_url = $finalUrl
        error = $_.Exception.Message
        response_body = $body
    } | ConvertTo-Json -Depth 8
}