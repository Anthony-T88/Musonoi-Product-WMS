param([string]$Database='musonoi_v26_development_test',[string]$PgBin='E:\Odoo 19.0.20260601\PostgreSQL\bin',[switch]$VerifyRestore,[int]$Daily=14,[int]$Weekly=8,[int]$Monthly=12)
$ErrorActionPreference='Stop'
if($Database -notmatch '^musonoi_[a-z0-9_]+_test$' -or $Daily -lt 1 -or $Weekly -lt 1 -or $Monthly -lt 1){throw 'Explicit TEST database and positive retention required'}
$taskRoot=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskBackup=Join-Path $taskRoot 'backups'
$taskRuntime=Join-Path $taskRoot '.runtime'
New-Item -ItemType Directory -Path $taskBackup,$taskRuntime -Force | Out-Null
$taskLock=[IO.File]::Open((Join-Path $taskRuntime 'v27-backup.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$taskRun=[ordered]@{database=$Database;started_at=[DateTimeOffset]::UtcNow.ToString('o');finished_at=$null;status='FAILED';file_name=$null;sha256=$null;bytes=$null;error_code=$null;restore_database=$null;restore_verified=$false;daily=$Daily;weekly=$Weekly;monthly=$Monthly}
Push-Location $taskRoot
try {
 $taskBefore=@(Get-ChildItem -LiteralPath $taskBackup -Filter 'inventory-test-*.dump' | ForEach-Object FullName)
 & (Join-Path $PSScriptRoot 'local-db.ps1') -Action backup -Database $Database -PgBin $PgBin
 $taskNew=@(Get-ChildItem -LiteralPath $taskBackup -Filter 'inventory-test-*.dump' | Where-Object FullName -NotIn $taskBefore)
 if($taskNew.Count -ne 1){throw 'BACKUP_OUTPUT_AMBIGUOUS'}
 $taskFile=$taskNew[0]
 $taskRun.file_name=$taskFile.Name;$taskRun.sha256=(Get-FileHash -LiteralPath $taskFile.FullName -Algorithm SHA256).Hash;$taskRun.bytes=$taskFile.Length
 if($taskRun.bytes -lt 1){throw 'EMPTY_BACKUP'}
 if($VerifyRestore){
  & (Join-Path $PSScriptRoot 'local-db.ps1') -Action restore-test -Archive $taskFile.FullName -Database $Database -PgBin $PgBin
  $taskRestore=Get-Content -LiteralPath (Join-Path $taskRuntime 'last-restore.json') -Raw | ConvertFrom-Json
  $taskRun.restore_database=$taskRestore.database
  & node (Join-Path $PSScriptRoot 'verify-backup-v27.cjs') $taskRestore.database $Database
  if($LASTEXITCODE -ne 0){throw 'RESTORE_VERIFICATION_FAILED'}
  $taskRun.restore_verified=$true
 }
 $taskRun.status='SUCCESS'
}catch{$taskRun.error_code='BACKUP_OR_RESTORE_FAILED';Write-Warning 'Backup or restore verification failed; inspect protected service logs. No database was replaced.'}
finally{
 $taskRun.finished_at=[DateTimeOffset]::UtcNow.ToString('o')
 $taskRecord=Join-Path $taskRuntime ('backup-run-'+(Get-Date -Format 'yyyyMMddHHmmssfff')+'.json')
 [IO.File]::WriteAllText($taskRecord,($taskRun|ConvertTo-Json -Depth 8))
 Add-Content -LiteralPath (Join-Path $taskRuntime 'backup-runs.jsonl') -Value ($taskRun|ConvertTo-Json -Compress)
 & node (Join-Path $PSScriptRoot 'record-backup-v27.cjs') $taskRecord
 if($LASTEXITCODE -ne 0){Write-Warning 'Database execution record unavailable; protected filesystem record retained.'}
 $taskLock.Dispose();Pop-Location
}
if($taskRun.status -ne 'SUCCESS'){throw 'Backup validation failed; retention was not applied'}
# Only this wrapper's own successful, database-specific manifests participate in retention.
$taskManifest=Join-Path $taskBackup ($taskRun.file_name+'.v27.json')
[IO.File]::WriteAllText($taskManifest,($taskRun|ConvertTo-Json -Depth 8))
$taskHistory=@(Get-ChildItem -LiteralPath $taskBackup -Filter '*.dump.v27.json' | ForEach-Object { $r=Get-Content -LiteralPath $_.FullName -Raw|ConvertFrom-Json;if($r.database -eq $Database -and $r.status -eq 'SUCCESS'){[pscustomobject]@{file=$_;record=$r;at=[DateTimeOffset]::Parse($r.started_at)}} } | Sort-Object at -Descending)
$taskKeep=[Collections.Generic.HashSet[string]]::new()
foreach($r in @($taskHistory | Select-Object -First $Daily)){$null=$taskKeep.Add($r.file.FullName)}
foreach($r in @($taskHistory | Group-Object {$_.at.UtcDateTime.ToString('yyyy')+'-'+[Globalization.ISOWeek]::GetWeekOfYear($_.at.UtcDateTime)} | Sort-Object {$_.Group[0].at} -Descending | Select-Object -First $Weekly | ForEach-Object {$_.Group|Select-Object -First 1})){$null=$taskKeep.Add($r.file.FullName)}
foreach($r in @($taskHistory | Group-Object {$_.at.UtcDateTime.ToString('yyyy-MM')} | Sort-Object {$_.Group[0].at} -Descending | Select-Object -First $Monthly | ForEach-Object {$_.Group|Select-Object -First 1})){$null=$taskKeep.Add($r.file.FullName)}
foreach($r in $taskHistory){if($taskKeep.Contains($r.file.FullName)){continue};if($r.record.file_name -notmatch '^inventory-test-[0-9-]+\.dump$'){throw 'Unsafe retention filename'};$taskTarget=[IO.Path]::GetFullPath((Join-Path $taskBackup $r.record.file_name));if(!$taskTarget.StartsWith($taskBackup+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe retention path'};foreach($p in @($taskTarget,$taskTarget+'.sha256.json',$r.file.FullName)){if(Test-Path -LiteralPath $p){Remove-Item -LiteralPath $p}}}
Write-Output 'Backup succeeded; retention applies only to this wrapper database and never removes upgrade archives.'
