[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000,
    [ValidateSet('127.0.0.1', '0.0.0.0', '::1', '::')]
    [string]$HostAddress = '127.0.0.1',
    [switch]$NoBuild,
    [switch]$SkipDatabaseMigration
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$node = Get-Command node.exe -ErrorAction Stop
$npm = Get-Command npm.cmd -ErrorAction Stop
$environmentNames = @('NODE_ENV', 'PORT', 'HOST')
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = @{
        wasSet = Test-Path "Env:$name"
        value = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
}

Push-Location $repoRoot
try {
    $runtimeEntrypoint = if (Test-Path (Join-Path $repoRoot 'dist\runtime\server.js')) {
        'dist/runtime/server.js'
    } elseif (Test-Path (Join-Path $repoRoot 'dist\index.js')) {
        'dist/index.js'
    } else {
        $null
    }
    if (-not $NoBuild -or -not $runtimeEntrypoint) {
        & $npm.Source run build
        if ($LASTEXITCODE -ne 0) { throw 'Production build failed.' }
        $runtimeEntrypoint = if (Test-Path (Join-Path $repoRoot 'dist\runtime\server.js')) {
            'dist/runtime/server.js'
        } elseif (Test-Path (Join-Path $repoRoot 'dist\index.js')) {
            'dist/index.js'
        } else {
            $null
        }
    }
    if (-not $runtimeEntrypoint) { throw 'Production server entrypoint is missing after build.' }
    $schemaAuditEntrypoint = if ($runtimeEntrypoint -eq 'dist/runtime/server.js') {
        if (Test-Path (Join-Path $repoRoot 'dist\runtime\schema-audit.js')) {
            'dist/runtime/schema-audit.js'
        } else {
            $null
        }
    } elseif (Test-Path (Join-Path $repoRoot 'dist\database-schema-audit.js')) {
        'dist/database-schema-audit.js'
    } else {
        $null
    }
    if (-not $schemaAuditEntrypoint) { throw 'Production schema-audit entrypoint is missing.' }

    $env:NODE_ENV = 'production'
    $env:PORT = [string]$Port
    $env:HOST = $HostAddress
    & $npm.Source run doctor
    if ($LASTEXITCODE -ne 0) {
        throw 'Production configuration audit failed. Correct the reported settings before startup.'
    }

    if (-not $SkipDatabaseMigration) {
        & $node.Source 'scripts/database-migrate.mjs'
        if ($LASTEXITCODE -ne 0) {
            throw 'Database migration failed. The service was not started.'
        }
    }

    & $node.Source $schemaAuditEntrypoint
    if ($LASTEXITCODE -ne 0) {
        throw 'Database schema audit failed. Apply the required migrations before startup.'
    }

    $launchId = 'windows-' + [Guid]::NewGuid().ToString('N')
    $stdoutPath = Join-Path $env:TEMP "hire-ai-$launchId.out.log"
    $stderrPath = Join-Path $env:TEMP "hire-ai-$launchId.err.log"
    $previousLaunchId = $env:HIRE_AI_RUNTIME_INSTANCE_ID
    try {
        # Bind readiness to this child, not an older service already using the port.
        $env:HIRE_AI_RUNTIME_INSTANCE_ID = $launchId
        $process = Start-Process -FilePath $node.Source `
            -ArgumentList @($runtimeEntrypoint) `
            -WorkingDirectory $repoRoot `
            -RedirectStandardOutput $stdoutPath `
            -RedirectStandardError $stderrPath `
            -WindowStyle Hidden `
            -PassThru
    } finally {
        $env:HIRE_AI_RUNTIME_INSTANCE_ID = $previousLaunchId
    }

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
                $healthy = $response.ready -is [bool] -and $response.ready -eq $true `
                    -and $response.instanceId -is [string] -and $response.instanceId -ceq $launchId `
                    -and -not $process.HasExited
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
    foreach ($name in $environmentNames) {
        if ($previousEnvironment[$name].wasSet) {
            [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name].value, 'Process')
        } else {
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
    }
    Pop-Location
}
