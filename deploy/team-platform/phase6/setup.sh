#!/usr/bin/env bash
# Phase 6 of the Simorgh Team Platform (docs/TEAM-PLATFORM.md): documents for
# the assistant from Nextcloud. Run on the k8s master as root.
#
#   NEXTCLOUD_URL=http://<nextcloud service>:<port> bash deploy/team-platform/phase6/setup.sh
#
# Before: in Nextcloud, as an admin,
#   1. a user  kara-reader  (no quota, not in any group),
#   2. a folder  Kara  shared with kara-reader (read only), and inside it one
#      folder per company slug (e.g. Kara/ekc), sub-folders named exactly like
#      Kara's units (Engineering/Electrical …); files for everyone in the
#      company at the company folder's root or under _all,
#   3. as kara-reader: Settings → Security → "Create new app password" → copy it.
# Asks for that app password; stores it in Secret kara/kara-team; points
# kara-api at Nextcloud. Nothing secret is printed.
set -euo pipefail
cd "$(dirname "$0")/../../.."
: "${NEXTCLOUD_URL:?set NEXTCLOUD_URL (the in-cluster address, e.g. http://nextcloud.nextcloud.svc.cluster.local:8080)}"

read -rs -p 'kara-reader app password: ' pw; echo
[ -n "$pw" ] || { echo "no password" >&2; exit 1; }

# A check before storing: the account sees /Kara.
code=$(printf 'kara-reader:%s' "$pw" | kubectl -n kara exec -i deploy/kara-api -- /nodejs/bin/node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",async()=>{
  const r=await fetch(process.argv[1]+"/remote.php/dav/files/kara-reader/Kara/",{method:"PROPFIND",headers:{Depth:"0",Authorization:"Basic "+Buffer.from(s).toString("base64")}});
  console.log(r.status)})' "$NEXTCLOUD_URL" 2>&1 | tail -1)
[ "$code" = 207 ] || { echo "Nextcloud answered $code for /Kara as kara-reader (want 207): check the URL, the share and the password" >&2; exit 1; }
echo "kara-reader sees /Kara"

kubectl -n kara get secret kara-team -o json | VAL="$pw" python3 -c '
import base64, json, os, sys
s = json.load(sys.stdin)
for k in ("resourceVersion", "uid", "creationTimestamp", "managedFields"): s["metadata"].pop(k, None)
s["data"]["nextcloudAppPassword"] = base64.b64encode(os.environ["VAL"].encode()).decode()
print(json.dumps(s))' | kubectl apply -f - >/dev/null
unset pw
echo "stored in kara/kara-team (nextcloudAppPassword)"

helm upgrade kara deploy/helm/simorgh-kara -n kara --reset-then-reuse-values --set api.team.nextcloud.url="$NEXTCLOUD_URL" --wait --timeout 10m >/dev/null
echo "kara-api points at $NEXTCLOUD_URL; first sync in 30 s:"
echo "  kubectl -n kara logs deploy/kara-api -f | grep -i nextcloud"
