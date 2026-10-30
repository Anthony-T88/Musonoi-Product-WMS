param(
 [ValidateSet('init','start','stop','status','backup','restore-test')][string]$Action = 'status',
 [string]$PgBin = 'E:\Odoo 19.0.20260601\PostgreSQL\bin',
 [string]$Archive = '',
 [string]$Database = 'musonoi_inventory_v25_test'
)
$ErrorActionPreference='Stop'
if($Database -notmatch '^musonoi_[a-z0-9_]+_test$') { throw 'Only explicitly named local test databases are supported.' }
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimePath=Join-Path $projectRoot '.runtime'
$dataPath=Join-Path $runtimePath 'pgdata'
$backupPath=Join-Path $projectRoot 'backups'
if (!(Test-Path -LiteralPath (Join-Path $PgBin 'pg_ctl.exe'))) { throw 'PostgreSQL binaries unavailable. Install official PostgreSQL 16+ and pass -PgBin. This script does not touch existing services.' }
function Invoke-Pg([string]$Executable,[string[]]$PgArgs) {
 & (Join-Path $PgBin $Executable) @PgArgs
 if ($LASTEXITCODE -ne 0) { throw "$Executable failed (exit $LASTEXITCODE)" }
}
switch($Action) {
 'init' {
  if(Test-Path -LiteralPath (Join-Path $dataPath 'PG_VERSION')) { throw 'Cluster already exists; init refused.' }
  New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
  $generatedPassword=[Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
  [IO.File]::WriteAllText((Join-Path $runtimePath 'pg-password.txt'),$generatedPassword)
  Invoke-Pg 'initdb.exe' @('-D',$dataPath,'-U','musonoi_owner',"--pwfile=$(Join-Path $runtimePath 'pg-password.txt')",'--auth=scram-sha-256','--encoding=UTF8','--locale=C')
 }
 'start' {
  & (Join-Path $PgBin 'pg_ctl.exe') -D $dataPath status *> $null
  if($LASTEXITCODE -eq 0) { Write-Output 'Project PostgreSQL is already running.'; break }
  Invoke-Pg 'pg_ctl.exe' @('-D',$dataPath,'-l',(Join-Path $runtimePath 'postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start')
 }
 'stop' { Invoke-Pg 'pg_ctl.exe' @('-D',$dataPath,'-m','fast','-w','stop') }
 'status' { Invoke-Pg 'pg_ctl.exe' @('-D',$dataPath,'status') }
 'backup' {
  New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
  $destination=Join-Path $backupPath ('inventory-test-'+(Get-Date -Format 'yyyyMMdd-HHmmssfff')+'.dump')
  $previousPassword=$env:PGPASSWORD
  try {
   $env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $runtimePath 'pg-password.txt')).Trim()
   Invoke-Pg 'pg_dump.exe' @('-h','127.0.0.1','-p','55432','-U','musonoi_owner','-d',$Database,'-Fc','-f',$destination)
  } finally { $env:PGPASSWORD=$previousPassword }
  Get-FileHash -LiteralPath $destination -Algorithm SHA256 | Select-Object Hash,Path | ConvertTo-Json | Set-Content ($destination+'.sha256.json')
  Write-Output "Test backup created: $destination"
 }
 'restore-test' {
  if(!$Archive) { throw 'Supply -Archive with the local test dump path.' }
  $resolvedArchive=(Resolve-Path -LiteralPath $Archive).Path
  if(!$resolvedArchive.StartsWith($backupPath+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Restore only accepts project-local backups.' }
  $manifest=Get-Content -LiteralPath ($resolvedArchive+'.sha256.json') -Raw | ConvertFrom-Json
  if((Get-FileHash -LiteralPath $resolvedArchive -Algorithm SHA256).Hash -ne $manifest.Hash) { throw 'Backup checksum mismatch.' }
  $restoreName='musonoi_restore_test_'+(Get-Date -Format 'yyyyMMddHHmmssfff')
  $previousPassword=$env:PGPASSWORD
  try {
   $env:PGPASSWORD=[IO.File]::ReadAllText((Join-Path $runtimePath 'pg-password.txt')).Trim()
   Invoke-Pg 'createdb.exe' @('-h','127.0.0.1','-p','55432','-U','musonoi_owner','-O','musonoi_owner',$restoreName)
   Invoke-Pg 'pg_restore.exe' @('-h','127.0.0.1','-p','55432','-U','musonoi_owner','--exit-on-error','--no-owner','-d',$restoreName,$resolvedArchive)
   [IO.File]::WriteAllText((Join-Path $runtimePath 'last-restore.json'),(@{database=$restoreName;source=$Database;archive=$resolvedArchive}|ConvertTo-Json))
  } finally { $env:PGPASSWORD=$previousPassword }
  Write-Output "Restored into a NEW isolated database: $restoreName (existing databases unchanged)."
 }
}
