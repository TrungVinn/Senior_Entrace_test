param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = 'C:\Users\vinhl\AppData\Local\Microsoft\WindowsApps\python3.11.exe'

function Stop-MatchingProcess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Pattern
    )

    Get-CimInstance Win32_Process |
        Where-Object { $_.CommandLine -and $_.CommandLine -match $Pattern } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        }
}

function Start-ServiceWindow {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,

        [Parameter(Mandatory = $true)]
        [string]$Command
    )

    if ($DryRun) {
        Write-Host "[$Name] $Command"
        return
    }

    Start-Process -FilePath 'powershell.exe' -WorkingDirectory $WorkingDirectory -ArgumentList @(
        '-NoExit',
        '-Command',
        $Command
    ) | Out-Null
}

Write-Host 'Stopping stale local project processes...'
if (-not $DryRun) {
    Stop-MatchingProcess 'stream\.producer'
    Stop-MatchingProcess 'stream\.processor_standalone'
    Stop-MatchingProcess 'ai\.runner'
    Stop-MatchingProcess 'go run \./cmd/main\.go'
    Stop-MatchingProcess 'vite --host 0\.0\.0\.0'
}

Write-Host 'Starting local services...'

Start-ServiceWindow -Name 'Backend' -WorkingDirectory (Join-Path $repoRoot 'backend') -Command @"
Set-Location '$($repoRoot -replace "'", "''")\backend'
go run ./cmd/main.go
"@

Start-ServiceWindow -Name 'Producer' -WorkingDirectory (Join-Path $repoRoot 'jobs\src') -Command @"
Set-Location '$($repoRoot -replace "'", "''")\jobs\src'
& '$python' -m stream.producer
"@

Start-ServiceWindow -Name 'Processor' -WorkingDirectory (Join-Path $repoRoot 'jobs\src') -Command @"
Set-Location '$($repoRoot -replace "'", "''")\jobs\src'
& '$python' -m stream.processor_standalone
"@

Start-ServiceWindow -Name 'AI Runner' -WorkingDirectory (Join-Path $repoRoot 'jobs\src') -Command @"
Set-Location '$($repoRoot -replace "'", "''")\jobs\src'
& '$python' -m ai.runner
"@

Start-ServiceWindow -Name 'Frontend' -WorkingDirectory $repoRoot -Command @"
Set-Location '$($repoRoot -replace "'", "''")'
npm run dev -- --host 0.0.0.0
"@

Write-Host ''
Write-Host 'Project started.'
Write-Host 'Frontend: http://localhost:5173'
Write-Host 'Backend:  http://localhost:8080'
Write-Host 'Tip: run with -DryRun to preview the commands without starting anything.'