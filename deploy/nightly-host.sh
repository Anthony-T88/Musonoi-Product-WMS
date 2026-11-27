#!/usr/bin/env bash
set -euo pipefail
umask 077

job=${1:?Select database, logs or mail}
if [[ ! $job =~ ^(database|logs|mail)$ || $# -ne 1 ]]; then
  printf 'Invalid maintenance job\n' >&2
  exit 2
fi

repo=${WMS_REPO_DIR:?Absolute release directory required}
export WMS_REPO_DIR
export WMS_BACKUP_HOST_DIR=${WMS_BACKUP_HOST_DIR:-/var/lib/musonoi/nightly}
export WMS_BACKUP_SECRET_DIR=${WMS_BACKUP_SECRET_DIR:-/etc/musonoi/nightly-backup}
export WMS_BACKUP_JOB_ENV_FILE=${WMS_BACKUP_JOB_ENV_FILE:-/etc/musonoi/nightly-backup.env}
export WMS_PG_CLIENT_MAJOR=${WMS_PG_CLIENT_MAJOR:-17}
export WMS_REPORT_SECRET_DIR=${WMS_REPORT_SECRET_DIR:-/etc/musonoi/report-mail}
export WMS_REPORT_JOB_ENV_FILE=${WMS_REPORT_JOB_ENV_FILE:-/etc/musonoi/report-job.env}
export WMS_REPORT_STATE_DIR=${WMS_REPORT_STATE_DIR:-/var/lib/musonoi/report-mail}
compose=(docker compose --project-name "${WMS_COMPOSE_PROJECT:?Compose project required}"
  --env-file "${WMS_COMPOSE_ENV_FILE:?Compose interpolation file required}"
  -f "${WMS_COMPOSE_FILE:?Current deployment Compose file required}")
if [[ -n ${WMS_COMPOSE_OVERRIDES_FILE:-} ]]; then
  while IFS= read -r override; do
    [[ -z $override ]] || compose+=(-f "$override")
  done < "$WMS_COMPOSE_OVERRIDES_FILE"
fi
jobs=("${compose[@]}" -f "$repo/deploy/compose.nightly.yaml")

if [[ $job == mail ]]; then
  if [[ ! -f $WMS_REPORT_SECRET_DIR/reports.json ]]; then
    printf 'Report email is disabled\n'
    exit 0
  fi
  test -r "$WMS_REPORT_JOB_ENV_FILE"
  exec "${jobs[@]}" run --rm --no-deps -T report-mail
fi
test -r "$WMS_BACKUP_JOB_ENV_FILE"

if [[ $job == database ]]; then
  exec "${jobs[@]}" run --rm --no-deps -T nightly-backup node scripts/nightly-backup.cjs database
fi

day=$(TZ=Africa/Lubumbashi date +%F)
end=$(date -u -d "$day 00:00:00 +0200" +%FT%TZ)
start=$(date -u -d "@$(($(date -u -d "$end" +%s)-86400))" +%FT%TZ)
runtime=$(mktemp "$WMS_BACKUP_HOST_DIR/.runtime-log.XXXXXXXX")
trap 'rm -f -- "$runtime"' EXIT
if [[ -z $("${compose[@]}" ps --all --quiet app) ]]; then
  printf 'WMS app container could not be found for log archival\n' >&2
  exit 1
fi
"${compose[@]}" logs --no-color --no-log-prefix --timestamps --since "$start" --until "$end" app > "$runtime"
chown 1000:1000 "$runtime"
WMS_RUNTIME_LOG_SOURCE="$runtime" "${jobs[@]}" run --rm --no-deps -T nightly-backup node scripts/nightly-backup.cjs logs
