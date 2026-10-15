#!/bin/bash
set -euo pipefail
umask 077
ROOT=/home/deploy/gastronomy-licensing
API=gastronomy_licensing-api-1
IMAGE=$(docker inspect "$API" --format '{{.Config.Image}}')
COMPOSE="$ROOT/docker/licensing/compose.yml"
[[ $(realpath "$ROOT") == "$ROOT" && $(id -u) == 1000 ]]
[[ $(docker inspect "$API" --format '{{index .Config.Labels "com.docker.compose.project"}}') == gastronomy_licensing ]]
[[ $(docker inspect "$API" --format '{{.State.Health.Status}}') == healthy ]]
[[ -d "$ROOT/licensing-data" && -d "$ROOT/licensing-secrets" ]]
[[ -z $(find "$ROOT/licensing-data" "$ROOT/licensing-secrets" -type l -print -quit) ]]
[[ -f "$ROOT/licensing-data/licenses.sqlite" && -f "$ROOT/licensing-secrets/private-key.pem" && -f "$ROOT/licensing-secrets/admin-token" ]]
mkdir -p "$ROOT/operations"
exec 9>"$ROOT/operations/authority-maintenance.lock"
flock -n 9 || exit 75
NAME="gastronomy_authority_backup_$(date +%s)_$$"
STOPPED=0
cleanup() {
  local rc=$?
  trap - EXIT HUP INT TERM
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  if [[ $STOPPED == 1 ]]; then
    docker compose -p gastronomy_licensing -f "$COMPOSE" start api >&2 || rc=1
    for i in $(seq 1 30); do
      if [[ $(docker inspect "$API" --format '{{.State.Health.Status}}') == healthy ]]; then
        echo 'Licensing authority restarted and healthy.' >&2
        exit "$rc"
      fi
      sleep 1
    done
    echo 'Licensing authority health verification failed.' >&2
    rc=1
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
STOPPED=1
docker compose -p gastronomy_licensing -f "$COMPOSE" stop -t 15 api >&2
# Only the authority is paused. All bytes go directly through SSH; no archive
# with raw secrets is written on either host. POS resources are never mounted.
docker run --rm --name "$NAME" --network none --read-only --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 32 --memory 64m \
  --mount "type=bind,src=$ROOT/licensing-data,dst=/snapshot/licensing-data,readonly" \
  --mount "type=bind,src=$ROOT/licensing-secrets,dst=/snapshot/licensing-secrets,readonly" \
  --entrypoint tar "$IMAGE" -C /snapshot -cf - licensing-data licensing-secrets
