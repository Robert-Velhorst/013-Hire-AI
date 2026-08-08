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

$localHealth = "http://127.0.0.1:$Port/healthz"
try {
    $local = Invoke-RestMethod -Uri $localHealth -TimeoutSec 3
} catch {
    throw "Hire.AI is not reachable at $localHealth. Start the Windows runtime first."
}
if ($local.status -ne 'ok') { throw 'The local Hire.AI health response is not healthy.' }

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
    $publicHealth = "$($public.GetLeftPart([UriPartial]::Authority))/healthz"
    $deadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    do {
        if ($process.HasExited) { break }
        Start-Sleep -Seconds 1
        try {
            $response = Invoke-RestMethod -Uri $publicHealth -Headers @{ 'ngrok-skip-browser-warning' = 'true' } -TimeoutSec 5
            $healthy = $response.status -eq 'ok'
        } catch {
            $healthy = $false
        }
    } while (-not $healthy -and (Get-Date) -lt $deadline)

    if (-not $healthy) {
        $details = if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 20 } else { @() }
        throw "The ngrok endpoint did not pass public health verification. $($details -join [Environment]::NewLine)"
    }

    Write-Host "Hire.AI public health verified at $publicHealth"
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
