#!/usr/bin/env bash
# Phase 2 of the Simorgh Team Platform (docs/TEAM-PLATFORM.md): the
# credentials Kara and n8n use to talk to Plane and Mattermost, in Secret
# kara-team (namespace kara) and n8n's copy. Run on the k8s master as root.
#
#   bash deploy/team-platform/phase2/setup.sh
#
# Safe to run again: what exists is kept (a token is made only when the
# Secret has none). Nothing secret is printed. It asks for two values from
# Plane's screens (Plane has no API to make them):
#   - a personal access token of a Plane workspace admin
#   - the secret of the workspace webhook to Kara
set -euo pipefail

NS_KARA=${NS_KARA:-kara}
NS_MM=${NS_MM:-mattermost}
SECRET=kara-team
say()  { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
hex()  { openssl rand -hex "${1:-24}"; }
mm()   { kubectl -n "$NS_MM" exec deploy/mattermost -- mmctl --local "$@"; }
get()  { kubectl -n "$NS_KARA" get secret "$SECRET" -o "jsonpath={.data.$1}" 2>/dev/null | base64 -d 2>/dev/null || true; }

declare -A V
for k in planeApiKey planeWebhookSecret mattermostAdminToken mattermostBotToken mattermostCommandTokens \
         assistantServiceToken ssoPlaneSecret ssoMattermostSecret ssoKeycloakSecret llmApiKey; do
  V[$k]=$(get "$k")
done

# ── Mattermost: two bots ────────────────────────────────────────────────────
say "Mattermost bots"
bot() {  # bot <username> <display name> <description>
  local out
  if out=$(mm bot create "$1" --display-name "$2" --description "$3" 2>&1); then note "$1 created"
  elif grep -qiE 'exist|taken' <<<"$out"; then note "$1 exists"
  else echo "$out" >&2; exit 1; fi
}
token() {  # token <bot>  → prints the new token (captured, never shown)
  mm token generate "$1" "kara $(date +%F)" --json | python3 -c 'import json,sys; d=json.load(sys.stdin); d=d[0] if isinstance(d,list) else d; print(d["token"])'
}
bot kara-provisioner "Kara" "Kara's provisioner: accounts and teams. Not for people."
bot simorgh-assistant "Simorgh Assistant" "دستیار سیمرغ — /ask /mytasks /project /report"
# The provisioner manages accounts: system admin. The assistant stays a plain bot.
mm roles system-admin kara-provisioner >/dev/null && note "kara-provisioner is system admin"
[ -n "${V[mattermostAdminToken]}" ] && note "admin token kept" || { V[mattermostAdminToken]=$(token kara-provisioner); note "admin token made"; }
[ -n "${V[mattermostBotToken]}" ] && note "bot token kept" || { V[mattermostBotToken]=$(token simorgh-assistant); note "bot token made"; }

# ── Plane: an API token and the webhook ────────────────────────────────────
say "Plane"
if [ -z "${V[planeApiKey]}" ] || [ "${RESET_PLANE_KEY:-}" = 1 ]; then
  cat <<'TXT'
   In Plane, signed in as the workspace admin:
     Profile (bottom left) → Settings → Personal access tokens → Add token
     name "kara", no expiry → copy the token.
TXT
  read -rs -p '   Plane token: ' 'V[planeApiKey]'; echo
  [ -n "${V[planeApiKey]}" ] || { echo "no token" >&2; exit 1; }
else
  note "API token kept (RESET_PLANE_KEY=1 to replace it)"
fi
if [ -z "${V[planeWebhookSecret]}" ] || [ "${RESET_PLANE_WEBHOOK:-}" = 1 ]; then
  cat <<'TXT'
   In Plane: Workspace settings → Webhooks → Add webhook
     URL:    http://kara-api.kara.svc.cluster.local:3001/v1/team/plane/webhook
     Events: Individual → Projects, Work items (issues), Work item comments
   Plane then shows the webhook's secret key once → copy it.
TXT
  read -rs -p '   Webhook secret: ' 'V[planeWebhookSecret]'; echo
  [ -n "${V[planeWebhookSecret]}" ] || { echo "no secret" >&2; exit 1; }
else
  note "webhook secret kept (RESET_PLANE_WEBHOOK=1 to replace it)"
fi

# ── Kara's own: the service token n8n uses, the sign-in adapter's secrets ──
say "Kara"
for k in assistantServiceToken ssoPlaneSecret ssoMattermostSecret; do
  [ -n "${V[$k]}" ] || { V[$k]=$(hex 32); note "$k made"; }
done
note "(ssoKeycloakSecret and llmApiKey are filled by Phase 3's setup)"

# ── Write ───────────────────────────────────────────────────────────────────
args=()
for k in "${!V[@]}"; do args+=(--from-literal="$k=${V[$k]}"); done
kubectl -n "$NS_KARA" create secret generic "$SECRET" "${args[@]}" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
note "Secret $NS_KARA/$SECRET written (keys only):"
kubectl -n "$NS_KARA" get secret "$SECRET" -o go-template='{{range $k, $v := .data}}     {{$k}}{{"\n"}}{{end}}'

# n8n calls Kara as the assistant with this token (Phase 3 workflows).
kubectl -n n8n create secret generic n8n-kara \
  --from-literal=KARA_ASSISTANT_TOKEN="${V[assistantServiceToken]}" \
  --from-literal=KARA_API_URL=http://kara-api.kara.svc.cluster.local:3001 \
  --dry-run=client -o yaml | kubectl apply -f - >/dev/null
note "Secret n8n/n8n-kara written"
unset V
say "Next: helm upgrade kara (README Phase 2, step 3) so kara-api reads them"
