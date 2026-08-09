[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000,
    [ValidateSet('127.0.0.1', '0.0.0.0', '::1', '::')]
    [string]$HostAddress = '127.0.0.1',
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node.exe -ErrorAction Stop
$npm = Get-Command npm.cmd -ErrorAction Stop

Push-Location $repoRoot
try {
    if (-not $NoBuild -or -not (Test-Path (Join-Path $repoRoot 'dist\index.js'))) {
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
    }

    $env:NODE_ENV = 'production'
    $env:PORT = [string]$Port
    $env:HOST = $HostAddress
    & $npm.Source run doctor
    if ($LASTEXITCODE -ne 0) {
        throw 'Production configuration audit failed. Correct the reported settings before startup.'
    }

    $stdoutPath = Join-Path $env:TEMP "hire-ai-windows-$Port.out.log"
    $stderrPath = Join-Path $env:TEMP "hire-ai-windows-$Port.err.log"
    $process = Start-Process -FilePath $node.Source `
        -ArgumentList @('dist/index.js') `
        -WorkingDirectory $repoRoot `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -WindowStyle Hidden `
        -PassThru

    try {
        $healthHost = if ($HostAddress -in @('0.0.0.0', '::')) { '127.0.0.1' } elseif ($HostAddress -eq '::1') { '[::1]' } else { $HostAddress }
        $readinessUrl = "http://${healthHost}:$Port/readyz"
        $deadline = (Get-Date).AddSeconds(45)
        $healthy = $false
        do {
            if ($process.HasExited) { break }
            Start-Sleep -Milliseconds 500
            try {
                $response = Invoke-RestMethod -Uri $readinessUrl -TimeoutSec 3
                $healthy = $response.ready -eq $true
            } catch {
                $healthy = $false
            }
        } while (-not $healthy -and (Get-Date) -lt $deadline)

        if (-not $healthy) {
            $details = @()
            if (Test-Path $stderrPath) { $details += Get-Content $stderrPath -Tail 20 }
            if (Test-Path $stdoutPath) { $details += Get-Content $stdoutPath -Tail 20 }
            throw "Hire.AI did not become ready. Check database availability and runtime configuration. $($details -join [Environment]::NewLine)"
        }

        Write-Host "Hire.AI is ready at http://${healthHost}:$Port/"
        Write-Host 'Press Ctrl+C to stop the local service.'
        Wait-Process -Id $process.Id
        if ($process.ExitCode -ne 0) { throw "Hire.AI exited with code $($process.ExitCode)." }
    } finally {
        if ($process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
            Wait-Process -Id $process.Id -ErrorAction SilentlyContinue
        }
    }
} finally {
    Pop-Location
}
