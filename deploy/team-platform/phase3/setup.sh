#!/usr/bin/env bash
# Phase 3 of the Simorgh Team Platform (docs/TEAM-PLATFORM.md): one sign-in
# (Kara's "GitLab" adapter in front of Keycloak) for Plane and Mattermost,
# and the assistant's language-model key. Run on the k8s master as root,
# after Phase 2 and after kara-api runs the Phase 3 image.
#
#   bash deploy/team-platform/phase3/setup.sh          # all steps
#   bash deploy/team-platform/phase3/setup.sh plane    # only Plane's sign-in settings again
#
# Nothing secret is printed or put on a command line: values move from
# Secret to Secret, or into Plane's database through stdin.
set -euo pipefail
cd "$(dirname "$0")/../../.."

NS_KARA=kara
say()  { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
get()  { kubectl -n "$NS_KARA" get secret kara-team -o "jsonpath={.data.$1}" 2>/dev/null | base64 -d 2>/dev/null || true; }
put()  {  # put <key> — value on stdin, merged into kara-team
  local key="$1" val; val="$(cat)"
  kubectl -n "$NS_KARA" get secret kara-team -o json | KEY="$key" VAL="$val" python3 -c '
import base64, json, os, sys
s = json.load(sys.stdin)
for k in ("resourceVersion", "uid", "creationTimestamp", "managedFields"): s["metadata"].pop(k, None)
s.setdefault("data", {})[os.environ["KEY"]] = base64.b64encode(os.environ["VAL"].encode()).decode()
print(json.dumps(s))' | kubectl apply -f - >/dev/null
}

[ -n "$(get ssoPlaneSecret)" ] || { echo "Secret kara/kara-team has no ssoPlaneSecret: run phase2/setup.sh first" >&2; exit 1; }

keycloak() {
  say "Keycloak client kara-team-sso (realm kara)"
  bash deploy/keycloak/setup-realm.sh team-sso
}

mattermost() {
  say "Mattermost: the adapter's client secret"
  get ssoMattermostSecret | kubectl -n mattermost create secret generic mattermost-sso \
    --from-file=clientSecret=/dev/stdin --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  note "Secret mattermost/mattermost-sso written"
}

plane() {
  say "Plane: sign in through Kara (as GitLab)"
  # Plane keeps these in its database (god-mode → Authentication → GitLab);
  # the secret encrypted with Plane's own key, exactly as god-mode stores it.
  local pod; pod=$(kubectl -n plane get pod -l app.name=plane-plane-api -o jsonpath='{.items[0].metadata.name}')
  get ssoPlaneSecret | kubectl -n plane exec -i "$pod" -- sh -c 'umask 077; cat > /tmp/kara-sso.secret'
  kubectl -n plane exec -i "$pod" -- python manage.py shell <<'PY'
import os
from plane.license.models import InstanceConfiguration
from plane.license.utils.encryption import encrypt_data
path = "/tmp/kara-sso.secret"
secret = open(path).read().strip()
os.remove(path)
values = {
    "IS_GITLAB_ENABLED": ("1", False),
    "GITLAB_HOST": ("https://kara.simorghai.com/sso/gitlab", False),
    "GITLAB_CLIENT_ID": ("plane", False),
    "GITLAB_CLIENT_SECRET": (secret, True),
}
for key, (value, enc) in values.items():
    c, _ = InstanceConfiguration.objects.get_or_create(key=key, defaults={"category": "GITLAB"})
    c.value = encrypt_data(value) if enc else value
    c.is_encrypted = enc
    c.category = "GITLAB"
    c.save()
print("plane: GitLab sign-in set to Kara's adapter")
PY
}

llm() {
  say "The assistant's language model (llm-gateway)"
  if [ -n "$(get llmApiKey)" ] && [ "${RESET_LLM_KEY:-}" != 1 ]; then note "key kept (RESET_LLM_KEY=1 to replace it)"; return; fi
  cat <<'TXT'
   A key for the app "team-assistant" in llm-gateway (llm.simorghai.com), made
   the way the website's and the chatbot's keys were (simorgh-technical-chatbot-cloud
   docs/LLM-API.md). Empty: /ask stays off, /mytasks /project /issue still work.
TXT
  local k; read -rs -p '   llm-gateway key: ' k; echo
  [ -n "$k" ] && { printf '%s' "$k" | put llmApiKey; note "llmApiKey stored"; } || note "skipped"
}

case "${1:-all}" in
  all) keycloak; mattermost; plane; llm ;;
  keycloak) keycloak ;; mattermost) mattermost ;; plane) plane ;; llm) llm ;;
  *) echo "usage: $0 [all|keycloak|mattermost|plane|llm]"; exit 2 ;;
esac
say "Next: README Phase 3, step 3 (kara-api and Mattermost pick these up)"
