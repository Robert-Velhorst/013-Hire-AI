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
$publicOrigin = $public.GetLeftPart([UriPartial]::Authority)
$node = Get-Command node.exe -ErrorAction Stop
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    $runtimeConfigJson = & $node.Source --input-type=commonjs -e "require('dotenv').config({ quiet: true }); process.stdout.write(JSON.stringify({ publicAppOrigin: process.env.PUBLIC_APP_ORIGIN || '', connectorRedirectUri: process.env.CONNECTOR_OAUTH_REDIRECT_URI || '' }));"
    if ($LASTEXITCODE -ne 0) {
        throw 'Hire.AI runtime configuration could not be read.'
    }
} finally {
    Pop-Location
}
try {
    $runtimeConfig = ($runtimeConfigJson -join [Environment]::NewLine) | ConvertFrom-Json
} catch {
    throw 'Hire.AI runtime configuration could not be read.'
}
if ([string]::IsNullOrWhiteSpace($runtimeConfig.publicAppOrigin)) {
    throw 'PUBLIC_APP_ORIGIN must be set to the same canonical HTTPS origin as PublicUrl before exposing the runtime.'
}
try {
    $configuredAppOrigin = [Uri]$runtimeConfig.publicAppOrigin
} catch {
    throw 'PUBLIC_APP_ORIGIN must be set to the same canonical HTTPS origin as PublicUrl before exposing the runtime.'
}
if (
    $configuredAppOrigin.Scheme -ne 'https' -or
    -not $configuredAppOrigin.Host -or
    $configuredAppOrigin.UserInfo -or
    $configuredAppOrigin.Query -or
    $configuredAppOrigin.Fragment -or
    $configuredAppOrigin.AbsolutePath -ne '/' -or
    $configuredAppOrigin.GetLeftPart([UriPartial]::Authority) -ine $publicOrigin
) {
    throw "PUBLIC_APP_ORIGIN must be the same canonical HTTPS origin as PublicUrl ($publicOrigin)."
}

$localReadiness = "http://127.0.0.1:$Port/readyz"
try {
    $local = Invoke-RestMethod -Uri $localReadiness -TimeoutSec 3
} catch {
    throw "Hire.AI is not ready at $localReadiness. Start the Windows runtime and verify its database first."
}
if ($local.ready -isnot [bool] -or $local.ready -ne $true) { throw 'The local Hire.AI runtime is not ready.' }
$localInstanceId = [string]$local.instanceId
if ($local.instanceId -isnot [string] -or $localInstanceId -notmatch '\A[A-Za-z0-9_-]{32,128}\z') {
    throw 'The local Hire.AI runtime did not provide a valid process identity.'
}

$expectedConnectorCallback = "$publicOrigin/api/connectors/oauth/callback"
if ($runtimeConfig.connectorRedirectUri -and $runtimeConfig.connectorRedirectUri.TrimEnd('/') -ne $expectedConnectorCallback) {
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
            $ready = $response.ready -is [bool] -and $response.ready -eq $true
            $identityMatches = $response.instanceId -is [string] -and $response.instanceId -ceq $localInstanceId
            $identityMismatch = $ready -and -not $identityMatches
            $healthy = $ready -and $identityMatches -and -not $process.HasExited
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
