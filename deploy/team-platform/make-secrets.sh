#!/usr/bin/env bash
# Phase 1 of the Simorgh Team Platform: namespaces and Secrets for Plane and
# Mattermost. Run on the k8s master as root, before the helm installs
# (README.md in this folder, step 2).
#
#   bash deploy/team-platform/make-secrets.sh
#
# Safe to run again: whatever already exists is kept (passwords already in a
# Secret are never regenerated: a database was initialised with them). Prints
# no secret value. What it makes:
#
#   ns plane, mattermost       labelled for ambient + baseline PSS
#   harbor-registry            copied from ns simorgh (image pulls via Harbor)
#   Ceph RGW users plane, mattermost  (on worker1 through cephadm)
#   plane:      plane-app-keys, plane-doc-store
#               /root/team-platform-secrets/plane-values-secrets.yaml (helm -f)
#   mattermost: mattermost-db, mattermost-s3, mattermost-smtp (empty password
#               until the team@ mailbox exists: SMTP_PASSWORD=… to set it)
set -euo pipefail

CEPH_HOST=${CEPH_HOST:-worker1}
CEPHADM=${CEPHADM:-/root/cephadm}
RGW_URL=${RGW_URL:-http://192.168.1.92:8080}
SECRETS_DIR=/root/team-platform-secrets
PULL_FROM_NS=${PULL_FROM_NS:-simorgh}

say()  { printf '\n== %s\n' "$*"; }
note() { printf '   %s\n' "$*"; }
hex()  { openssl rand -hex "${1:-24}"; }

exists() { kubectl -n "$1" get secret "$2" >/dev/null 2>&1; }
# Value of one key of an existing Secret (decoded), or empty.
get_key() { kubectl -n "$1" get secret "$2" -o "jsonpath={.data.$3}" 2>/dev/null | base64 -d 2>/dev/null || true; }
# kubectl create secret … as an idempotent apply (never shows the values).
apply_secret() { kubectl create secret generic "$@" --dry-run=client -o yaml | kubectl apply -f - >/dev/null; }

umask 077
mkdir -p "$SECRETS_DIR"

# ── 1. Namespaces ─────────────────────────────────────────────────────────
say "Namespaces"
for ns in plane mattermost; do
  kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: $ns
  labels:
    app.kubernetes.io/part-of: simorgh-team-platform
    istio.io/dataplane-mode: ambient
    pod-security.kubernetes.io/enforce: baseline
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: restricted
EOF
  note "$ns ok"
done

# ── 2. Harbor pull secret ─────────────────────────────────────────────────
say "harbor-registry (from ns $PULL_FROM_NS)"
DOCKERCFG=$(kubectl -n "$PULL_FROM_NS" get secret harbor-registry -o 'jsonpath={.data.\.dockerconfigjson}')
[ -n "$DOCKERCFG" ] || { echo "no harbor-registry in ns $PULL_FROM_NS" >&2; exit 1; }
for ns in plane mattermost; do
  kubectl create secret generic harbor-registry -n "$ns" \
    --type=kubernetes.io/dockerconfigjson \
    --from-file=.dockerconfigjson=<(printf '%s' "$DOCKERCFG" | base64 -d) \
    --dry-run=client -o yaml | kubectl apply -f - >/dev/null
  note "$ns ok"
done

# ── 3. Ceph RGW users (keys read into variables, never printed) ───────────
rgw_keys() {  # rgw_keys <uid> <display name>  → "ACCESS SECRET"
  local uid=$1 name=$2 json
  if ! json=$(ssh -o BatchMode=yes "$CEPH_HOST" "$CEPHADM shell -- radosgw-admin user info --uid=$uid" 2>/dev/null); then
    json=$(ssh -o BatchMode=yes "$CEPH_HOST" "$CEPHADM shell -- radosgw-admin user create --uid=$uid --display-name='$name' --max-buckets=2" 2>/dev/null)
    note "RGW user $uid created" >&2
  else
    note "RGW user $uid exists" >&2
  fi
  printf '%s' "$json" | python3 -c 'import json,sys; k=json.load(sys.stdin)["keys"][0]; print(k["access_key"], k["secret_key"])'
}

say "Ceph RGW users (on $CEPH_HOST)"
read -r PLANE_S3_ACCESS PLANE_S3_SECRET < <(rgw_keys plane "Simorgh Team Platform - Plane")
read -r MM_S3_ACCESS MM_S3_SECRET       < <(rgw_keys mattermost "Simorgh Team Platform - Mattermost")
[ -n "$PLANE_S3_SECRET" ] && [ -n "$MM_S3_SECRET" ] || { echo "could not read RGW keys" >&2; exit 1; }

# ── 4. Plane ──────────────────────────────────────────────────────────────
say "Plane"
if exists plane plane-app-keys; then
  note "plane-app-keys kept"
else
  apply_secret plane-app-keys -n plane \
    --from-literal=SECRET_KEY="$(hex 32)" \
    --from-literal=LIVE_SERVER_SECRET_KEY="$(hex 32)"
  note "plane-app-keys created"
fi

# CELERY_WORKER_CONCURRENCY: the chart cannot change the worker's command,
# and celery otherwise starts one process per node core (16-24 here) and is
# OOM-killed at its 1 Gi limit. This Secret is in the worker's envFrom, and
# celery reads CELERY_<SUBCOMMAND>_<OPTION> from the environment.
# USE_MINIO=1: Plane signs upload/download links for the page's own host
# (https://plane.simorghai.com/plane-uploads/…, routed to RGW by edge.yaml).
apply_secret plane-doc-store -n plane \
  --from-literal=USE_MINIO=1 \
  --from-literal=AWS_S3_ENDPOINT_URL="$RGW_URL" \
  --from-literal=AWS_REGION=us-east-1 \
  --from-literal=AWS_S3_BUCKET_NAME=plane-uploads \
  --from-literal=FILE_SIZE_LIMIT=52428800 \
  --from-literal=AWS_ACCESS_KEY_ID="$PLANE_S3_ACCESS" \
  --from-literal=AWS_SECRET_ACCESS_KEY="$PLANE_S3_SECRET" \
  --from-literal=CELERY_WORKER_CONCURRENCY="${PLANE_WORKER_CONCURRENCY:-2}"
note "plane-doc-store ok"

VALUES=$SECRETS_DIR/plane-values-secrets.yaml
if [ -s "$VALUES" ]; then
  note "$VALUES kept (the Plane database was made with it)"
else
  # Quoted: an all-digit hex string would otherwise be read as a number.
  cat >"$VALUES" <<EOF
env:
  pgdb_password: "$(hex 24)"
rabbitmq:
  default_password: "$(hex 24)"
EOF
  note "$VALUES written"
fi

# ── 5. Mattermost ─────────────────────────────────────────────────────────
say "Mattermost"
if exists mattermost mattermost-db; then
  note "mattermost-db kept"
else
  apply_secret mattermost-db -n mattermost \
    --from-literal=username=mattermost \
    --from-literal=password="$(hex 24)"     # hex: safe inside the DSN URL
  note "mattermost-db created"
fi

apply_secret mattermost-s3 -n mattermost \
  --from-literal=accessKeyId="$MM_S3_ACCESS" \
  --from-literal=secretAccessKey="$MM_S3_SECRET"
note "mattermost-s3 ok"

SMTP_PASSWORD=${SMTP_PASSWORD:-$(get_key mattermost mattermost-smtp password)}
apply_secret mattermost-smtp -n mattermost --from-literal=password="$SMTP_PASSWORD"
if [ -n "$SMTP_PASSWORD" ]; then note "mattermost-smtp ok"
else note "mattermost-smtp empty: create team@simorghai.com in mailcow, then
     SMTP_PASSWORD='…' bash $0   and   kubectl -n mattermost rollout restart deploy/mattermost"
fi

unset PLANE_S3_SECRET MM_S3_SECRET SMTP_PASSWORD DOCKERCFG
say "Done. Secrets (names only):"
kubectl -n plane get secret -o name
kubectl -n mattermost get secret -o name
