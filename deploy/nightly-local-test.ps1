param(
    [Parameter(Mandatory)][ValidateSet('database','logs')][string]$Job,
    [Parameter(Mandatory)][string]$ProfileRoot,
    [Parameter(Mandatory)][string]$Node
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$profilePath = (Resolve-Path -LiteralPath $ProfileRoot).Path
$runtime = Get-Content -Raw -LiteralPath (Join-Path $profilePath 'runtime.private.json') | ConvertFrom-Json
$owner = Get-Content -Raw -LiteralPath (Join-Path $profilePath 'maintenance.private.json') | ConvertFrom-Json
if ($runtime.appConfig.environment -ne 'test' -or $owner.host -ne '127.0.0.1' -or
    $owner.port -ne $runtime.pgPort -or $owner.database -notmatch '^musonoi_[a-z0-9_]+_test$' -or
    $owner.user -eq 'musonoi_app') {
    throw 'This launcher only accepts the local TEST profile and its owner account.'
}

$backup = Join-Path $profilePath 'nightly'
$userPart = [Uri]::EscapeDataString([string]$owner.user)
$passPart = [Uri]::EscapeDataString([string]$owner.password)
$dbPart = [Uri]::EscapeDataString([string]$owner.database)
$env:APP_ENV = 'test'
$env:DEPLOYMENT_TIER = 'local'
$env:DB_EXPECTED_NAME = $owner.database
$env:DATABASE_OWNER_URL = "postgresql://${userPart}:${passPart}@127.0.0.1:$($owner.port)/$dbPart"
$env:WMS_PG_DUMP = Join-Path $runtime.postgresBin 'pg_dump.exe'
$env:WMS_DATABASE_BACKUP_DIR = Join-Path $backup 'database'
$env:WMS_LOG_BACKUP_DIR = Join-Path $backup 'logs'
$env:WMS_BACKUP_KEY_FILE = Join-Path $backup 'backup.key'

$logInput = $null
try {
    if ($Job -eq 'logs') {
        $logInput = Join-Path $backup ('.runtime-log-' + [guid]::NewGuid().ToString('N'))
        $copy = [IO.File]::Open($logInput, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
        try {
            foreach ($name in 'local-test.out.log','local-test.err.log') {
                $source = Join-Path $repo ".runtime/$name"
                $stream = [IO.File]::Open($source,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::ReadWrite)
                try { $stream.CopyTo($copy) } finally { $stream.Dispose() }
                $copy.WriteByte(10)
            }
        } finally { $copy.Dispose() }
        $env:WMS_RUNTIME_LOG_FILE = $logInput
    }
    & $Node (Join-Path $repo 'scripts/nightly-backup.cjs') $Job
    exit $LASTEXITCODE
} finally {
    if ($logInput -and (Test-Path -LiteralPath $logInput -PathType Leaf)) {
        Remove-Item -LiteralPath $logInput
    }
}
