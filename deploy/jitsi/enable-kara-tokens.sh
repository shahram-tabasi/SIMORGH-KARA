#!/usr/bin/env bash
#
# Jitsi (meet.simorghai.com, namespace jitsi, chart jitsi-meet) accepts only
# tokens Kara signs (docs/VEO.md §9a): meetings and calls are started from
# Kara, outside guests join through links Kara makes. Nobody can open a room
# anonymously any more.
#
#   deploy/jitsi/enable-kara-tokens.sh            # switch on (run after Kara with calls is deployed)
#   deploy/jitsi/enable-kara-tokens.sh off        # back to open rooms, as before
#
# The shared secret: Secret jitsi/jitsi-jwt (JWT_APP_SECRET, read by prosody)
# and Secret kara/kara-jitsi (jwtSecret, read by kara-api) hold the same value,
# made here once and never printed.
set -euo pipefail
NS="${JITSI_NAMESPACE:-jitsi}"
RELEASE="${JITSI_RELEASE:-jitsi}"
KARA_NS="${KARA_NAMESPACE:-kara}"
REPO="${JITSI_CHART_REPO:-https://jitsi-contrib.github.io/jitsi-helm/}"

say() { printf '\n== %s\n' "$*"; }

chart_version() {
  helm -n "$NS" list -o json | python3 -c '
import json, sys
for r in json.load(sys.stdin):
    if r["name"] == sys.argv[1]: print(r["chart"].rsplit("-", 1)[1])' "$RELEASE"
}
VERSION="$(chart_version)"
[ -n "$VERSION" ] || { echo "no helm release $RELEASE in namespace $NS"; exit 1; }
echo "release $RELEASE: chart jitsi-meet $VERSION"

upgrade() {
  helm upgrade "$RELEASE" jitsi-meet --repo "$REPO" --version "$VERSION" -n "$NS" --reuse-values "$@" --wait --timeout 10m
}

if [ "${1:-on}" = off ]; then
  say "Jitsi back to open rooms"
  upgrade --set enableAuth=false --set enableGuests=true
  echo "done: anyone can open a room again; Kara's calls and meetings still work"
  exit 0
fi

say "the shared secret"
if ! kubectl -n "$NS" get secret jitsi-jwt >/dev/null 2>&1; then
  kubectl -n "$NS" create secret generic jitsi-jwt \
    --from-literal=JWT_APP_SECRET="$(python3 -c 'import secrets; print(secrets.token_hex(32))')" >/dev/null
  echo "made jitsi/jitsi-jwt"
else
  echo "jitsi/jitsi-jwt already there"
fi
SECRET="$(kubectl -n "$NS" get secret jitsi-jwt -o jsonpath='{.data.JWT_APP_SECRET}' | base64 -d)"
kubectl -n "$KARA_NS" create secret generic kara-jitsi --from-literal=jwtSecret="$SECRET" \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
unset SECRET
echo "copied to $KARA_NS/kara-jitsi"

say "kara-api reads it"
kubectl -n "$KARA_NS" rollout restart deploy/kara-api
kubectl -n "$KARA_NS" rollout status deploy/kara-api --timeout=5m

say "Jitsi: tokens only"
upgrade \
  --set enableAuth=true \
  --set enableGuests=false \
  --set prosody.jwt.existingSecretName=jitsi-jwt \
  --set extraCommonEnvs.AUTH_TYPE=jwt \
  --set extraCommonEnvs.JWT_APP_ID=kara \
  --set extraCommonEnvs.JWT_ACCEPTED_ISSUERS=kara \
  --set extraCommonEnvs.JWT_ACCEPTED_AUDIENCES=jitsi
kubectl -n "$NS" get pods

cat <<'DONE'

Done. Check:
  - https://meet.simorghai.com/anything asks for a login: no anonymous rooms.
  - In Kara: "تماس و جلسه" in the menu; call a colleague from a second browser;
    "اتاق جلسه شرکت" opens the company's meeting room.
Undo: deploy/jitsi/enable-kara-tokens.sh off
DONE
