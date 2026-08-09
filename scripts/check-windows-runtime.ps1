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

$distEntry = Join-Path $repoRoot 'dist\index.js'
if (Test-Path -LiteralPath $distEntry -PathType Container) {
    throw "Production entry path is unexpectedly a directory: $distEntry"
}

Write-Host "Validated $($launcherPaths.Count) Windows launcher scripts."
