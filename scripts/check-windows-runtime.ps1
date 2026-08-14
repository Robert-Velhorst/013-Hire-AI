[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$launcherPaths = @(
    (Join-Path $PSScriptRoot 'start-windows.ps1'),
    (Join-Path $PSScriptRoot 'start-ngrok.ps1')
)

foreach ($launcherPath in $launcherPaths) {
    if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
        throw "Required Windows launcher is missing: $launcherPath"
    }

    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $launcherPath,
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null

    if ($parseErrors.Count -gt 0) {
        $details = $parseErrors | ForEach-Object {
            "$($_.Extent.File):$($_.Extent.StartLineNumber):$($_.Extent.StartColumnNumber) $($_.Message)"
        }
        throw "Windows launcher syntax validation failed.$([Environment]::NewLine)$($details -join [Environment]::NewLine)"
    }
}

$windowsLauncher = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'start-windows.ps1') -Raw
$migrationPosition = $windowsLauncher.IndexOf("'scripts/database-migrate.mjs'")
$schemaAuditPosition = $windowsLauncher.IndexOf("'dist/database-schema-audit.js'")
$serverStartPosition = $windowsLauncher.IndexOf('Start-Process -FilePath $node.Source')
if ($migrationPosition -lt 0 -or $schemaAuditPosition -lt 0 -or $serverStartPosition -lt 0) {
    throw 'The Windows launcher must migrate, audit, and start the database-backed runtime.'
}
if (-not ($migrationPosition -lt $schemaAuditPosition -and $schemaAuditPosition -lt $serverStartPosition)) {
    throw 'The Windows launcher must migrate and audit the database before starting the server.'
}

$distEntry = Join-Path $repoRoot 'dist\index.js'
if (Test-Path -LiteralPath $distEntry -PathType Container) {
    throw "Production entry path is unexpectedly a directory: $distEntry"
}

Write-Host "Validated $($launcherPaths.Count) Windows launcher scripts."
