#!/usr/bin/env bash
#
# Simorgh Kara — the steps around `helm install`. Idempotent; nothing secret
# is printed or put on a command line.
#
#   deploy/helm/simorgh-kara/scripts/setup.sh secrets    # kara-db, kara-app, pull secret
#   deploy/helm/simorgh-kara/scripts/setup.sh keycloak   # realm kara, clients → kara-keycloak
#   deploy/helm/simorgh-kara/scripts/setup.sh mail       # realm kara's SMTP again (from realm simorgh)
#   deploy/helm/simorgh-kara/scripts/setup.sh theme      # realm kara uses Kara's login and email theme
#   deploy/helm/simorgh-kara/scripts/setup.sh llm-key    # the office LLM key (llm-api-key.sh create kara) → kara-app
#   deploy/helm/simorgh-kara/scripts/setup.sh hr-handoff # a new secret Kara and the HR chatbot share for the
#                                                        # one-click sign-in (kara-app hrHandoffSecret,
#                                                        # hr-chatbot/hr-handoff secret); never printed
#   helm upgrade --install kara deploy/helm/simorgh-kara -n kara
#
# keycloak runs deploy/keycloak/setup-realm.sh realm (read its header): it
# asks for the SMTP password of realm simorgh's sender, or takes SMTP_PASSWORD.

set -euo pipefail
NS="${KARA_NAMESPACE:-kara}"
SRC_NS="${SRC_NAMESPACE:-simorgh}"
HERE="$(cd "$(dirname "$0")" && pwd)"

say() { printf '\n== %s\n' "$*"; }
exists() { kubectl -n "$1" get secret "$2" >/dev/null 2>&1; }
rand() { head -c 64 /dev/urandom | base64 | tr -d '/+=\n' | head -c "$1"; }

namespace() {
  kubectl get ns "$NS" >/dev/null 2>&1 || kubectl create ns "$NS" >/dev/null
  kubectl label ns "$NS" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null
  kubectl annotate ns "$NS" meta.helm.sh/release-name=kara meta.helm.sh/release-namespace="$NS" --overwrite >/dev/null
}

secrets() {
  namespace
  say "kara-db"
  if exists "$NS" kara-db; then echo "exists — left alone"; else
    kubectl -n "$NS" create secret generic kara-db --from-literal=username=kara --from-literal=password="$(rand 32)" >/dev/null && echo created
  fi

  say "kara-app (session signing key)"
  if exists "$NS" kara-app; then echo "exists — left alone"; else
    kubectl -n "$NS" create secret generic kara-app --from-literal=sessionSecret="$(rand 64)" >/dev/null && echo created
  fi

  say "harbor-registry"
  if exists "$NS" harbor-registry; then echo "exists — left alone"; else
    kubectl -n "$SRC_NS" get secret harbor-registry -o json \
      | python3 -c 'import json,sys; s=json.load(sys.stdin); m=s["metadata"]; s["metadata"]={"name":m["name"],"namespace":sys.argv[1]}; print(json.dumps(s))' "$NS" \
      | kubectl apply -f - >/dev/null && echo "copied from $SRC_NS"
  fi

  say "wildcard certificate"
  if exists "$NS" wildcard-simorghai-tls; then echo "exists"; else
    echo "missing — run: ~/simorgh-technical-chatbot-cloud/deploy/scripts/sync-wildcard-cert.sh $NS"
  fi
}

# The office LLM's key for Kara's assistants, asked for (not echoed) and put
# into kara-app as llmApiKey; kara-web restarts to read it.
llm_key() {
  local key
  read -rsp "Kara's LLM key (from llm-api-key.sh create kara): " key; echo
  [ -n "$key" ] || { echo "nothing entered"; exit 1; }
  kubectl -n "$NS" get secret kara-app -o json | KEY="$key" python3 -c '
import base64, json, os, sys
s = json.load(sys.stdin)
s["data"]["llmApiKey"] = base64.b64encode(os.environ["KEY"].encode()).decode()
for k in ("resourceVersion", "uid", "creationTimestamp", "managedFields"): s["metadata"].pop(k, None)
print(json.dumps(s))' | kubectl apply -f - >/dev/null && echo "stored llmApiKey in $NS/kara-app"
  kubectl -n "$NS" rollout restart deploy/kara-web >/dev/null && echo "kara-web restarting"
}

# The secret behind «دستیار هوش مصنوعی»: Kara signs a two-minute token with
# it, the HR chatbot checks it. A new one each run (the old one stops working).
hr_handoff() {
  local hr_ns="${HR_NAMESPACE:-hr-chatbot}" secret
  secret="$(rand 64)"
  kubectl -n "$NS" get secret kara-app -o json | KEY="$secret" python3 -c '
import base64, json, os, sys
s = json.load(sys.stdin)
s["data"]["hrHandoffSecret"] = base64.b64encode(os.environ["KEY"].encode()).decode()
for k in ("resourceVersion", "uid", "creationTimestamp", "managedFields"): s["metadata"].pop(k, None)
print(json.dumps(s))' | kubectl apply -f - >/dev/null && echo "stored hrHandoffSecret in $NS/kara-app"
  kubectl get ns "$hr_ns" >/dev/null 2>&1 || { echo "no namespace $hr_ns"; exit 1; }
  printf '%s' "$secret" | kubectl -n "$hr_ns" create secret generic hr-handoff --from-file=secret=/dev/stdin \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null && echo "stored secret in $hr_ns/hr-handoff"
  unset secret
  kubectl -n "$NS" rollout restart deploy/kara-web >/dev/null && echo "kara-web restarting"
  kubectl -n "$hr_ns" rollout restart deploy/hr-api >/dev/null 2>&1 && echo "hr-api restarting" || true
}

case "${1:-}" in
  secrets) secrets ;;
  keycloak) namespace; KARA_NAMESPACE="$NS" "$HERE/../../../keycloak/setup-realm.sh" realm ;;
  mail) KARA_NAMESPACE="$NS" "$HERE/../../../keycloak/setup-realm.sh" mail ;;
  theme) KARA_NAMESPACE="$NS" "$HERE/../../../keycloak/setup-realm.sh" theme ;;
  llm-key) llm_key ;;
  hr-handoff) hr_handoff ;;
  *) echo "usage: $0 secrets | keycloak | mail | theme | llm-key | hr-handoff"; exit 2 ;;
esac
