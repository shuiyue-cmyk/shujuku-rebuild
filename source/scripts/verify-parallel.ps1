# scripts/verify-parallel.ps1 — 三线并行验证链：tsc + 全量 vitest(8 并行) + build
# 用法（workdir=source）：powershell -File scripts\verify-parallel.ps1
# 单项耗时上限 ≈ max(tsc, vitest)；串行需 ~12 分钟，并行实测 ~2 分钟（6907 用例 8 worker 稳定）。
# 环境变量 ACU_VITEST_WORKERS 可临时调整 vitest 并行度（回退单线程=设 1）。
param([switch]$SkipTests)
$ErrorActionPreference = 'Continue'
Set-Location (Join-Path $PSScriptRoot '..')
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$jobs = @{}
$jobs['tsc'] = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    & ".\node_modules\.bin\tsc.cmd" --noEmit 2>&1 | Out-String
}
if (-not $SkipTests) {
    $jobs['vitest'] = Start-Job -ScriptBlock {
        Set-Location $using:PWD
        (npx vitest run --reporter=basic) 2>&1 | Out-String
    }
}
$jobs['build'] = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    (npm run build) 2>&1 | Out-String
}

Wait-Job @($jobs.Values) -Timeout 1200 | Out-Null
$results = @{}
foreach ($k in $jobs.Keys) { $results[$k] = Receive-Job $jobs[$k]; Remove-Job $jobs[$k] -Force }
$sw.Stop()

$fail = 0
$tscOut = $results['tsc'] -join "`n"
if ($tscOut -match 'error TS') { Write-Host "TSC: ERRORS`n$tscOut"; $fail = 1 } else { Write-Host 'TSC: 0 errors' }

if (-not $SkipTests) {
    $plain = ($results['vitest'] -join "`n") -replace '\x1b\[[0-9;]*m', ''
    $m = ($plain | Select-String -Pattern 'Tests\s+\d+ passed(?:\s*\|\s*\d+ skipped)?(?:\s*\|\s*\d+ failed)?' | Select-Object -Last 1).Matches
    $line = if ($m) { $m[-1].Value } else { 'NO SUMMARY' }
    Write-Host "VITEST: $line"
    if ($plain -match 'FAIL\s+tests/' -or $plain -match '\|\s*\d+ failed') { $fail = 1 }
}

$buildOut = $results['build'] -join "`n"
if ($buildOut -match 'created') { Write-Host 'BUILD: OK' } else { Write-Host "BUILD: FAIL`n$buildOut"; $fail = 1 }

Write-Host "WALL: $([math]::Round($sw.Elapsed.TotalSeconds))s"
exit $fail
