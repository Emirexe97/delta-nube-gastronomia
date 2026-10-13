#!/bin/bash
set -euo pipefail
ROOT=/home/deploy/gastronomy-licensing
[[ $(realpath "$ROOT") == "$ROOT" && $(id -u) == 1000 ]]
[[ -f "$ROOT/scripts/authority-restore-check.mjs" ]]
# No authority/POS data or secrets are mounted. Archive bytes are decrypted on
# Windows in RAM, streamed over SSH, and extracted only in ephemeral tmpfs.
exec docker run --rm -i --network none --read-only --user 1000:1000 \
  --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 32 --memory 256m \
  --tmpfs /restore:rw,noexec,nosuid,size=96m,mode=0700,uid=1000,gid=1000 \
  --mount "type=bind,src=$ROOT/scripts/authority-restore-check.mjs,dst=/check.mjs,readonly" \
  --entrypoint node gastronomy-licensing:manual-v1 /check.mjs
