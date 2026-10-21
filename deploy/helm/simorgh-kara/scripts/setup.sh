#!/usr/bin/env bash
#
# Simorgh Kara — the steps around `helm install`. Idempotent; nothing secret
# is printed or put on a command line.
#
#   deploy/helm/simorgh-kara/scripts/setup.sh secrets    # kara-db, kara-app, pull secret
#   deploy/helm/simorgh-kara/scripts/setup.sh keycloak   # realm kara, clients → kara-keycloak
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

case "${1:-}" in
  secrets) secrets ;;
  keycloak) namespace; KARA_NAMESPACE="$NS" "$HERE/../../../keycloak/setup-realm.sh" realm ;;
  *) echo "usage: $0 secrets | keycloak"; exit 2 ;;
esac
