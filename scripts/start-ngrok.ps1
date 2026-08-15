[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PublicUrl,
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$ErrorActionPreference = 'Stop'
$ngrok = Get-Command ngrok.exe -ErrorAction Stop
$public = [Uri]$PublicUrl
if ($public.Scheme -ne 'https' -or -not $public.Host -or $public.UserInfo -or $public.Query -or $public.Fragment -or $public.AbsolutePath -ne '/') {
    throw 'PublicUrl must be an origin-only HTTPS URL, for example https://hire-ai.example.ngrok.app/'
}

$localReadiness = "http://127.0.0.1:$Port/readyz"
try {
    $local = Invoke-RestMethod -Uri $localReadiness -TimeoutSec 3
} catch {
    throw "Hire.AI is not ready at $localReadiness. Start the Windows runtime and verify its database first."
}
if ($local.ready -ne $true) { throw 'The local Hire.AI runtime is not ready.' }
$localInstanceId = [string]$local.instanceId
if ($localInstanceId -notmatch '^[A-Za-z0-9_-]{32,128}$') {
    throw 'The local Hire.AI runtime did not provide a valid process identity.'
}

$expectedConnectorCallback = "$($public.GetLeftPart([UriPartial]::Authority))/api/connectors/oauth/callback"
if ($env:CONNECTOR_OAUTH_REDIRECT_URI -and $env:CONNECTOR_OAUTH_REDIRECT_URI.TrimEnd('/') -ne $expectedConnectorCallback) {
    throw "CONNECTOR_OAUTH_REDIRECT_URI must equal $expectedConnectorCallback before exposing connector OAuth through this tunnel."
}

$stdoutPath = Join-Path $env:TEMP "hire-ai-ngrok-$Port.out.log"
$stderrPath = Join-Path $env:TEMP "hire-ai-ngrok-$Port.err.log"
$process = Start-Process -FilePath $ngrok.Source `
    -ArgumentList @('http', "--url=$($public.GetLeftPart([UriPartial]::Authority))", "http://127.0.0.1:$Port") `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru

try {
    $publicReadiness = "$($public.GetLeftPart([UriPartial]::Authority))/readyz"
    $deadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    $identityMismatch = $false
    do {
        if ($process.HasExited) { break }
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-RestMethod -Uri $publicReadiness -Headers @{ 'ngrok-skip-browser-warning' = 'true' } -TimeoutSec 5
            $identityMismatch = $response.ready -eq $true -and [string]$response.instanceId -ne $localInstanceId
            $healthy = $response.ready -eq $true -and $response.instanceId -eq $localInstanceId
        } catch {
            $healthy = $false
        }
    } while (-not $healthy -and (Get-Date) -lt $deadline)

    if (-not $healthy) {
        $details = if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 20 } else { @() }
        if ($identityMismatch) {
            throw 'The ngrok endpoint is ready but does not match the local Hire.AI runtime. Verify the reserved hostname and tunnel target.'
        }
        throw "The ngrok endpoint did not pass public readiness verification. $($details -join [Environment]::NewLine)"
    }

    Write-Host "Hire.AI public readiness verified at $publicReadiness"
    Write-Host "Connector OAuth callback: $expectedConnectorCallback"
    Write-Host 'Press Ctrl+C to stop the tunnel.'
    Wait-Process -Id $process.Id
    if ($process.ExitCode -ne 0) { throw "ngrok exited with code $($process.ExitCode)." }
} finally {
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
    }
}
