param([ValidateSet('windows', 'ngrok')][string]$Launcher = 'windows')

$ErrorActionPreference = 'Stop'
$env:CONNECTOR_OAUTH_REDIRECT_URI = ''

# Execute the real launcher without builds, database changes, network or child processes.
function Get-Command {
    param($Name)
    if ($Name -eq 'node.exe') { return @{ Source = 'Invoke-FixtureNode' } }
    if ($Name -eq 'npm.cmd') { return @{ Source = 'Invoke-FixtureNpm' } }
    if ($Name -eq 'ngrok.exe') { return @{ Source = 'fixture-ngrok.exe' } }
    throw "Unexpected command: $Name"
}
function Invoke-FixtureNode { $global:LASTEXITCODE = 0 }
function Invoke-FixtureNpm { $global:LASTEXITCODE = 0 }
function Start-Process {
    param($FilePath, $ArgumentList, $WorkingDirectory, $RedirectStandardOutput,
        $RedirectStandardError, $WindowStyle, [switch]$PassThru)
    $expectedCommand = if ($global:fixture.launcher -eq 'windows') { 'dist/index.js' } else { 'http' }
    if ($ArgumentList[0] -ne $expectedCommand -or $WindowStyle -ne 'Hidden') {
        throw 'Unexpected startup command'
    }
    if ($global:fixture.launcher -eq 'windows') {
        $global:fixture.launchId = $env:HIRE_AI_RUNTIME_INSTANCE_ID
    }
    if ($global:fixture.scenario -eq 'start-failure') { throw 'Fixture start failure' }
    return $global:fixture.child
}
function Start-Sleep { param($Milliseconds, $Seconds) }
function Get-Date {
    $now = [DateTime]::new(2030, 1, 1).AddSeconds(60 * $global:fixture.clock)
    $global:fixture.clock++
    return $now
}
function Invoke-RestMethod {
    param($Uri, $TimeoutSec, $Headers)
    if ($global:fixture.launcher -eq 'ngrok' -and $Uri -eq 'http://127.0.0.1:3000/readyz') {
        if ($global:fixture.scenario -eq 'local-string-ready') {
            return @{ ready = 'true'; instanceId = $global:fixture.launchId }
        }
        return @{ ready = $true; instanceId = $global:fixture.launchId }
    }
    $expectedUrl = if ($global:fixture.launcher -eq 'windows') {
        'http://127.0.0.1:3000/readyz'
    } else { 'https://hire-ai.example.ngrok.app/readyz' }
    if ($Uri -ne $expectedUrl) { throw 'Unexpected readiness URL' }
    $global:fixture.probes++
    if ($global:fixture.probes -gt 1) { $global:fixture.child.HasExited = $true }
    switch ($global:fixture.scenario) {
        'matching' { return @{ ready = $true; instanceId = $global:fixture.launchId } }
        'local-string-ready' { return @{ ready = $true; instanceId = $global:fixture.launchId } }
        'local-newline-id' { return @{ ready = $true; instanceId = $global:fixture.launchId } }
        'foreign' { return @{ ready = $true; instanceId = ('x' * 32) } }
        'case-mismatch' { return @{ ready = $true; instanceId = $global:fixture.launchId.ToUpperInvariant() } }
        'missing' { return @{ ready = $true } }
        'string-ready' { return @{ ready = 'true'; instanceId = $global:fixture.launchId } }
        'exited' {
            $global:fixture.child.HasExited = $true
            return @{ ready = $true; instanceId = $global:fixture.launchId }
        }
        default { throw 'Unexpected scenario' }
    }
}
function Write-Host { $global:fixture.messages += $args -join ' ' }
function Wait-Process { param($Id) $global:fixture.child.HasExited = $true }
function Stop-Process {
    param($Id, [switch]$Force)
    $global:fixture.stopped += $Id
    $global:fixture.child.HasExited = $true
}

$scenarios = @('matching', 'foreign', 'case-mismatch', 'missing', 'string-ready', 'exited', 'start-failure')
if ($Launcher -eq 'ngrok') { $scenarios += @('local-string-ready', 'local-newline-id') }
$results = foreach ($scenario in $scenarios) {
    $global:fixture = @{
        scenario = $scenario
        launcher = $Launcher
        child = [pscustomobject]@{ Id = 424242; HasExited = $false; ExitCode = 0 }
        messages = @(); stopped = @(); launchId = ('local-' + ('a' * 32)); probes = 0; clock = 0
    }
    if ($scenario -eq 'local-newline-id') { $global:fixture.launchId += "`n" }
    $env:HIRE_AI_RUNTIME_INSTANCE_ID = 'parent-value-must-be-restored'
    $failure = $null
    try {
        if ($Launcher -eq 'windows') {
            & (Join-Path $PSScriptRoot '../start-windows.ps1') -NoBuild -SkipDatabaseMigration
        } else {
            & (Join-Path $PSScriptRoot '../start-ngrok.ps1') -PublicUrl 'https://hire-ai.example.ngrok.app/'
        }
    } catch {
        $failure = $_.Exception.Message
    }
    [pscustomobject]@{
        scenario = $scenario
        announced = [bool]($global:fixture.messages -match '^Hire.AI (is ready at|public readiness verified at) ')
        error = $failure
        launchId = $global:fixture.launchId
        restoredId = $env:HIRE_AI_RUNTIME_INSTANCE_ID
        stopped = @($global:fixture.stopped)
    }
}
$results | ConvertTo-Json -Compress
