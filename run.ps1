$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile   = Join-Path $scriptDir "output\run.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "$ts - $msg"
    Write-Host $line
    Add-Content $logFile $line
}

New-Item -ItemType Directory -Path (Join-Path $scriptDir "output") -Force | Out-Null

Log "=== Job Scraper task started ==="

# Wait up to 5 minutes for network (10 x 30s)
$maxAttempts = 10
$attempt     = 0

while ($attempt -lt $maxAttempts) {
    if (Test-Connection 8.8.8.8 -Count 1 -Quiet -ErrorAction SilentlyContinue) {
        Log "Network available"
        break
    }
    $attempt++
    Log "No network (attempt $attempt/$maxAttempts), retrying in 30s..."
    Start-Sleep -Seconds 30
}

if ($attempt -eq $maxAttempts) {
    Log "Network unavailable after 5 minutes — aborting"
    exit 1
}

# Run the scraper (pipe "0" to auto-select all company lists)
Set-Location $scriptDir
Log "Running: node scrape.js"

$proc = Start-Process "powershell.exe" `
    -ArgumentList "-Command `"echo 0 | node scrape.js`"" `
    -WorkingDirectory $scriptDir `
    -Wait -PassThru -NoNewWindow

Log "Scraper exited with code $($proc.ExitCode)"
Log "=== Done ==="

exit $proc.ExitCode
