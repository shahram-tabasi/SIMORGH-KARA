#!/usr/bin/env bash
# Phase 4 of the Simorgh Team Platform (docs/TEAM-PLATFORM.md): the scheduled
# digests in n8n. The notices (Plane assignments, new kartabl items and tasks)
# need nothing here: kara-api sends them as soon as the Phase 4 image runs.
#
#   bash deploy/team-platform/phase4/setup.sh
#
# Imports the credential "Kara assistant (service token)" (from Secret
# n8n/n8n-kara, made by phase2/setup.sh) and the two workflows, then
# publishes them. Safe to run again. Nothing secret is printed.
set -euo pipefail
cd "$(dirname "$0")"
NS=n8n
say() { printf '\n== %s\n' "$*"; }

token=$(kubectl -n "$NS" get secret n8n-kara -o 'jsonpath={.data.KARA_ASSISTANT_TOKEN}' | base64 -d)
[ -n "$token" ] || { echo "Secret n8n/n8n-kara has no token: run phase2/setup.sh first" >&2; exit 1; }

say "credential"
TOKEN="$token" python3 - <<'PY' | kubectl -n "$NS" exec -i deploy/n8n -- sh -c 'umask 077; cat > /tmp/kara-cred.json && n8n import:credentials --input=/tmp/kara-cred.json; rc=$?; rm -f /tmp/kara-cred.json; exit $rc'
import json, os
print(json.dumps([{"id": "KaraAssistant001", "name": "Kara assistant (service token)", "type": "httpHeaderAuth",
                   "data": {"name": "Authorization", "value": "Bearer " + os.environ["TOKEN"]}}]))
PY
unset token

say "workflows"
for f in n8n/*.json; do
  id=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' "$f")
  kubectl -n "$NS" exec deploy/n8n -- n8n unpublish:workflow --id="$id" >/dev/null 2>&1 || true
  kubectl -n "$NS" exec -i deploy/n8n -- sh -c 'cat > /tmp/wf.json && n8n import:workflow --input=/tmp/wf.json; rc=$?; rm -f /tmp/wf.json; exit $rc' < "$f"
  kubectl -n "$NS" exec deploy/n8n -- n8n publish:workflow --id="$id"
done
kubectl -n "$NS" rollout restart deploy/n8n >/dev/null
kubectl -n "$NS" rollout status deploy/n8n --timeout=300s >/dev/null && echo "n8n restarted with the digests published"
