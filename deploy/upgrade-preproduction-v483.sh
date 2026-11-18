#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
commit=${1:?Supply the verified release commit}
[[ $commit =~ ^[0-9a-f]{40}$ ]]
project=musonoi-preproduction-pg16
target=musonoi_preproduction_test
envfile=/etc/musonoi/preproduction.env
repo=/opt/musonoi-wms-release-v4.8.3
override=/etc/musonoi/preproduction-v483-build.override.yaml
source_revision=4.8.1-ui6
target_revision=4.8.3
target_version=4.8.3
release_branch=release/v4.8.3
migration=195_v482_dispatch_vehicle_month.sql
migration_count=195
case "${2:-base}" in
  base) ;;
  ui1)
    repo+=-ui1
    override=/etc/musonoi/preproduction-v483-ui1-build.override.yaml
    source_revision=4.8.3
    target_revision=4.8.3-ui1
    ;;
  v484)
    repo=/opt/musonoi-wms-release-v4.8.4
    override=/etc/musonoi/preproduction-v484-build.override.yaml
    source_revision=4.8.3-ui1
    target_revision=4.8.4
    target_version=4.8.4
    release_branch=release/v4.8.4
    ;;
  v485)
    repo=/opt/musonoi-wms-release-v4.8.5
    override=/etc/musonoi/preproduction-v485-build.override.yaml
    source_revision=4.8.4
    target_revision=4.8.5
    target_version=4.8.5
    release_branch=release/v4.8.5
    site_target=("${3:?Expected cobalt project code}" "${4:?Expected cobalt warehouse code}" "${5:?Expected authorized administrator}")
    ;;
  v485-ui1)
    repo=/opt/musonoi-wms-release-v4.8.5-ui1
    override=/etc/musonoi/preproduction-v485-ui1-build.override.yaml
    source_revision=4.8.5
    target_revision=4.8.5-ui1
    target_version=4.8.5
    release_branch=release/v4.8.5
    ;;
  v485-ui2)
    repo=/opt/musonoi-wms-release-v4.8.5-ui2
    override=/etc/musonoi/preproduction-v485-ui2-build.override.yaml
    source_revision=4.8.5-ui1
    target_revision=4.8.5-ui2
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=196_v485_vehicle_arrival_confirmation.sql
    migration_count=196
    ;;
  v485-ui3)
    repo=/opt/musonoi-wms-release-v4.8.5-ui3
    override=/etc/musonoi/preproduction-v485-ui3-build.override.yaml
    source_revision=4.8.5-ui2
    target_revision=4.8.5-ui3
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=196_v485_vehicle_arrival_confirmation.sql
    migration_count=196
    ;;
  v485-ui4)
    repo=/opt/musonoi-wms-release-v4.8.5-ui4
    override=/etc/musonoi/preproduction-v485-ui4-build.override.yaml
    source_revision=4.8.5-ui3
    target_revision=4.8.5-ui4
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=196_v485_vehicle_arrival_confirmation.sql
    migration_count=196
    ;;
  v485-ui5)
    repo=/opt/musonoi-wms-release-v4.8.5-ui5
    override=/etc/musonoi/preproduction-v485-ui5-build.override.yaml
    source_revision=4.8.5-ui4
    target_revision=4.8.5-ui5
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=196_v485_vehicle_arrival_confirmation.sql
    migration_count=196
    ;;
  v485-ui6)
    repo=/opt/musonoi-wms-release-v4.8.5-ui6
    override=/etc/musonoi/preproduction-v485-ui6-build.override.yaml
    source_revision=4.8.5-ui5
    target_revision=4.8.5-ui6
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=196_v485_vehicle_arrival_confirmation.sql
    migration_count=196
    ;;
  v485-ui7)
    repo=/opt/musonoi-wms-release-v4.8.5-ui7
    override=/etc/musonoi/preproduction-v485-ui7-build.override.yaml
    source_revision=4.8.5-ui6
    target_revision=4.8.5-ui7
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=196_v485_vehicle_arrival_confirmation.sql
    migration_count=196
    ;;
  v485-ui8)
    repo=/opt/musonoi-wms-release-v4.8.5-ui8
    override=/etc/musonoi/preproduction-v485-ui8-build.override.yaml
    source_revision=4.8.5-ui7
    target_revision=4.8.5-ui8
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=196_v485_vehicle_arrival_confirmation.sql
    migration_count=196
    ;;
  v485-ui9)
    repo=/opt/musonoi-wms-release-v4.8.5-ui9
    override=/etc/musonoi/preproduction-v485-ui9-build.override.yaml
    source_revision=4.8.5-ui8
    target_revision=4.8.5-ui9
    target_version=4.8.5
    release_branch=release/v4.8.5
    migration=197_v485_historical_departure_and_sales_links.sql
    migration_count=197
    ;;
  v486)
    repo=/opt/musonoi-wms-release-v4.8.6
    override=/etc/musonoi/preproduction-v486-build.override.yaml
    source_revision=4.8.5-ui9
    target_revision=4.8.6
    target_version=4.8.6
    release_branch=release/v4.8.6
    migration=197_v485_historical_departure_and_sales_links.sql
    migration_count=197
    ;;
  v486-ui1)
    repo=/opt/musonoi-wms-release-v4.8.6-ui1
    override=/etc/musonoi/preproduction-v486-ui1-build.override.yaml
    source_revision=4.8.6
    target_revision=4.8.6-ui1
    target_version=4.8.6
    release_branch=release/v4.8.6
    migration=197_v485_historical_departure_and_sales_links.sql
    migration_count=197
    ;;
  *) printf 'Unrecognized release mode\n'; exit 1 ;;
esac
release_id=${target_version//./}
stage=$(mktemp -d "/root/musonoi-v${release_id}.XXXXXXXX")
mapfile -t running < <(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=app')
[[ ${#running[@]} == 1 ]]
old_app=$(docker inspect --format '{{.Id}}' "${running[0]}")
old_image=$(docker inspect --format '{{.Image}}' "$old_app")
project_dir=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$old_app")
IFS=, read -ra files <<< "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$old_app")"
[[ -d "$project_dir" && -r "$envfile" && ${#files[@]} -ge 2 ]]
old=(docker compose -p "$project" --project-directory "$project_dir" --env-file "$envfile")
for config in "${files[@]}"; do
  [[ $config = /* && -r $config && $config != "$override" ]]
  old+=(-f "$config")
done
status(){ curl -fsS --max-time 6 "http://127.0.0.1:4184/api/v1/$1"; }
json_is(){ python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[sys.argv[1]]==sys.argv[2]' "$@"; }
query(){ "${old[@]}" exec -T database psql -X -qAt -v ON_ERROR_STOP=1 -U musonoi_owner "$@"; }
mounts(){ docker inspect --format '{{range .Mounts}}{{println .Name .Destination .Source}}{{end}}' "$1" | sort; }
status health | json_is database ok
status config | json_is frontendRevision "$source_revision"
[[ $(query -d "$target" -c 'SELECT environment FROM system_info WHERE singleton') == test ]]
before=$(query -d "$target" -c 'SELECT version FROM security_schema_status')
case "$before" in
  "$migration") added=0 ;;
  196_v485_vehicle_arrival_confirmation.sql) [[ $target_revision == 4.8.5-ui9 ]]; added=1 ;;
  195_v482_dispatch_vehicle_month.sql) [[ $target_revision == 4.8.5-ui2 ]]; added=1 ;;
  194_v481_dispatch_and_approval.sql) [[ $source_revision == 4.8.1-ui6 ]]; added=1 ;;
  *) printf 'Unexpected migration version %s\n' "$before"; exit 1 ;;
esac
old_db=$("${old[@]}" ps -q database)
[[ -n "$old_db" ]]
mounts "$old_app" > "$stage/app-mounts"
mounts "$old_db" > "$stage/db-mounts"

if [[ ! -d "$repo/.git" ]]; then
  (umask 022; git clone --quiet --single-branch --branch "$release_branch" \
    https://github.com/Anthony-T88/Musonoi-Product-WMS.git "$repo")
fi
[[ $(git -C "$repo" rev-parse HEAD) == "$commit" && -z $(git -C "$repo" status --porcelain) ]]
cat > "$stage/build.yaml" <<YAML
services:
  app:
    build:
      context: $repo
  migrate:
    build:
      context: $repo
YAML
if [[ -e "$override" ]]; then cmp "$override" "$stage/build.yaml"; else cp "$stage/build.yaml" "$override"; fi
new=("${old[@]}" -f "$override")
"${old[@]}" --profile maintenance config --format json > "$stage/compose-before.json"
"${new[@]}" --profile maintenance config --format json > "$stage/compose-after.json"
python3 - "$stage" "$repo" <<'PY'
import json, sys
from pathlib import Path
stage=Path(sys.argv[1])
old, new=(json.loads((stage / name).read_text()) for name in ("compose-before.json","compose-after.json"))
for service in ("app","migrate"):
    assert new["services"][service]["build"]["context"]==sys.argv[2]
    new["services"][service]["build"]["context"]=old["services"][service]["build"]["context"]
assert old==new
assert old["services"]["app"]["environment"]["DB_EXPECTED_NAME"]=="musonoi_preproduction_test"
(stage / "compose-after.json").unlink()
PY

docker image tag "$old_image" "musonoi-wms:rollback-before-v${release_id}-$(date +%s)"
"${new[@]}" --profile maintenance build app migrate
for service in app migrate; do
  "${new[@]}" run --rm --no-deps "$service" node -e '
    const a=require("node:assert/strict"),r=require("./server/release.cjs");
    a.equal(r.version,process.argv[2]); a.equal(r.frontendRevision,process.argv[1]);
    a.equal(r.requiredMigration,process.argv[3]);
  ' "$target_revision" "$target_version" "$migration"
done
check_migration(){
  python3 -c 'import json,sys; d=json.load(sys.stdin); assert (d["status"],d["migrations"],d["added"])==(sys.argv[1],int(sys.argv[2]),int(sys.argv[3])); print(d)' "$1" "$migration_count" "$added"
}
"${new[@]}" run --rm --no-deps migrate node scripts/preproduction-db.cjs | check_migration DRY_RUN_ROLLED_BACK
[[ $("${old[@]}" ps -q app) == "$old_app" ]]
cat > "$stage/reconcile.sql" <<'SQL'
SELECT 'users',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY id),'')) FROM users x;
SELECT 'scopes',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY id),'')) FROM user_scopes x;
SELECT 'permissions',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY role_code,permission_code),'')) FROM role_permissions x;
SELECT 'registrations',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY id),'')) FROM registration_requests x;
SELECT 'preparation_plans',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY id),'')) FROM preparation_plans x;
SELECT 'historical',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY source_id),'')) FROM historical_backfills x;
SELECT 'historical_sources',count(*),md5(coalesce(string_agg(concat_ws(':',id,source_sha256,voided_at),E'\n' ORDER BY id),'')) FROM historical_movement_documents;
SELECT 'cobalt_inventory',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY bag_id),'')) FROM co_inventory x;
SELECT 'cobalt_locations_of_stock',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY bag_id),'')) FROM co_positions x;
SELECT 'loading_plan_groups',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY id),'')) FROM loading_plan_groups x;
SELECT 'vehicle_arrivals',count(*),md5(coalesce(string_agg((to_jsonb(x)-'registration_phase')::text,E'\n' ORDER BY id),'')) FROM vehicle_arrivals x;
SELECT 'co_vehicle_arrivals',count(*),md5(coalesce(string_agg((to_jsonb(x)-'registration_phase')::text,E'\n' ORDER BY id),'')) FROM co_vehicle_arrivals x;
SELECT 'loads',count(*),md5(coalesce(string_agg(to_jsonb(x)::text,E'\n' ORDER BY id),'')) FROM loading_orders x;
SQL
tar -czf "$stage/configs.tgz" "$envfile" "${files[@]}" "$override"
trap 'rc=$?; if ((rc)); then
  printf "Rollout stopped. Protected backups and evidence: %s\n" "$stage"
  version=$(query -d "$target" -c "SELECT version FROM security_schema_status" || true)
  if [[ "$version" == "$before" && -z "$(docker ps -q --filter "id=$old_app")" ]]; then docker start "$old_app" || true; fi
fi' EXIT
"${old[@]}" stop app
query -d "$target" < "$stage/reconcile.sql" > "$stage/before"
"${old[@]}" exec -T database pg_dump -Fc -U musonoi_owner "$target" > "$stage/database.dump"
docker run --rm --network none --volumes-from "$old_app":ro --entrypoint tar "$old_image" -czf - -C /app uploads > "$stage/uploads.tgz"
tar -tzf "$stage/uploads.tgz" >/dev/null
(cd "$stage"; sha256sum database.dump uploads.tgz configs.tgz > SHA256SUMS; sha256sum -c SHA256SUMS)
restore=musonoi_v${release_id}_verify_$(date +%s)_test
"${old[@]}" exec -T database createdb -U musonoi_owner "$restore"
"${old[@]}" exec -T database pg_restore --exit-on-error -U musonoi_owner -d "$restore" < "$stage/database.dump"
query -d "$restore" < "$stage/reconcile.sql" > "$stage/restored"
cmp "$stage/before" "$stage/restored"
[[ $(query -d "$restore" -c 'SELECT version FROM security_schema_status') == "$before" ]]
printf 'RESTORE_VERIFIED\n'
if ((added)); then
  "${new[@]}" run --rm --no-deps -e TEST_BACKUP_VERIFIED=yes migrate node scripts/preproduction-db.cjs --apply --confirm-database "$target" | check_migration APPLIED
fi
[[ $(query -d "$target" -c 'SELECT version FROM security_schema_status') == "$migration" ]]
if [[ ${2:-base} == v485 ]]; then
  "${new[@]}" run --rm --no-deps migrate node scripts/preproduction-cobalt-map.cjs "${site_target[@]}" | json_is status CO_SITE_DRY_RUN_ROLLED_BACK
  "${new[@]}" run --rm --no-deps -e TEST_BACKUP_VERIFIED=yes migrate \
    node scripts/preproduction-cobalt-map.cjs "${site_target[@]}" --apply --confirm-database "$target" | tee "$stage/cobalt-site.json" | json_is status CO_SITE_APPLIED
fi
query -d "$target" < "$stage/reconcile.sql" > "$stage/after"
cmp "$stage/before" "$stage/after"
"${new[@]}" up -d --no-deps app
for attempt in $(seq 1 30); do
  if status health 2>/dev/null | json_is database ok 2>/dev/null; then break; fi
  sleep 2
done
status health | json_is database ok
status config | json_is version "$target_version"
status config | json_is frontendRevision "$target_revision"
[[ $("${new[@]}" ps -q database) == "$old_db" ]]
mounts "$old_db" | cmp "$stage/db-mounts"
mounts "$("${new[@]}" ps -q app)" | cmp "$stage/app-mounts"
trap - EXIT
printf 'V%s_DEPLOY_VERIFIED commit=%s migration=%s evidence=%s\n' "$release_id" "$commit" "$migration" "$stage"
