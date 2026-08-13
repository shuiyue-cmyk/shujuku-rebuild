$a = (Get-FileHash 'backups\index.js' -Algorithm SHA256).Hash
$b = (Get-FileHash 'backups\index.baseline.js' -Algorithm SHA256).Hash
if ($a -eq $b) { 'IDENTICAL' } else { 'DIFFERENT' }
Write-Output "index.js      = $a"
Write-Output "baseline.js   = $b"
