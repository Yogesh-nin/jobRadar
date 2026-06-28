$taskName  = "JobScraper"
$runScript = Join-Path $PSScriptRoot "run.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runScript`""

# Runs daily at 9 AM — but StartWhenAvailable means:
# if laptop was off/sleeping at 9 AM, it will run as soon as it wakes up
$trigger = New-ScheduledTaskTrigger -Daily -At "09:00AM"

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable:$false `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
    -WakeToRun:$false

Register-ScheduledTask `
    -TaskName $taskName `
    -Action   $action `
    -Trigger  $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force | Out-Null

Write-Host ""
Write-Host "Task '$taskName' registered successfully." -ForegroundColor Green
Write-Host ""
Write-Host "Schedule : Daily at 9:00 AM"
Write-Host "On wake  : Runs as soon as laptop wakes if 9 AM was missed"
Write-Host "Network  : run.ps1 waits up to 5 min for connection before starting"
Write-Host ""
Write-Host "To run it manually right now:"
Write-Host "  Start-ScheduledTask -TaskName '$taskName'"
Write-Host ""
Write-Host "To remove it:"
Write-Host "  Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
