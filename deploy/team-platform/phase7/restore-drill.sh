#!/usr/bin/env bash
# Phase 7 restore drill (docs/TEAM-PLATFORM.md exit check: "restore drill
# passes"). Takes the newest daily dump of an app from Ceph, restores it into
# a throw-away PostgreSQL in namespace team-restore-drill, and compares row
# counts of the main tables with the live database. Touches nothing live
# (reads only). Run on the k8s master as root.
#
#   bash deploy/team-platform/phase7/restore-drill.sh plane
#   bash deploy/team-platform/phase7/restore-drill.sh mattermost
set -euo pipefail
APP=${1:?plane or mattermost}
DRILL=team-restore-drill
case "$APP" in
  plane)      NS=plane; S3SECRET=plane-doc-store; AK=AWS_ACCESS_KEY_ID; SK=AWS_SECRET_ACCESS_KEY
              LIVE="sts/plane-pgdb-wl"; TABLES="users projects issues issue_comments"; LIVEDB='plane' ;;
  mattermost) NS=mattermost; S3SECRET=mattermost-s3; AK=accessKeyId; SK=secretAccessKey
              LIVE="sts/mattermost-postgresql"; TABLES="users teams channels posts"; LIVEDB='mattermost' ;;
  *) echo "plane or mattermost" >&2; exit 2 ;;
esac
say() { printf '\n== %s\n' "$*"; }
cleanup() { kubectl delete ns "$DRILL" --wait=false >/dev/null 2>&1 || true; }
trap cleanup EXIT

say "scratch namespace $DRILL"
kubectl create ns "$DRILL" >/dev/null 2>&1 || true
kubectl label ns "$DRILL" pod-security.kubernetes.io/enforce=baseline --overwrite >/dev/null
for s in harbor-registry "$S3SECRET"; do
  kubectl -n "$NS" get secret "$s" -o json | python3 -c '
import json, sys
s = json.load(sys.stdin); m = s["metadata"]
s["metadata"] = {"name": m["name"], "namespace": "'"$DRILL"'"}
print(json.dumps(s))' | kubectl apply -f - >/dev/null
done

say "a throw-away PostgreSQL with the newest dump"
kubectl -n "$DRILL" apply -f - >/dev/null <<YAML
apiVersion: v1
kind: Pod
metadata: { name: drill }
spec:
  restartPolicy: Never
  imagePullSecrets: [{ name: harbor-registry }]
  initContainers:
    - name: fetch
      image: registry.simorghai.com/docker-proxy/curlimages/curl:8.11.1
      command:
        - sh
        - -ec
        - |
          for back in 0 1 2 3 4 5 6; do
            day=\$(date -d "@\$(( \$(date +%s) - back * 86400 ))" +%a)
            if curl -fsS --aws-sigv4 "aws:amz:us-east-1:s3" --user "\$AK:\$SK" -o /restore/db.dump "http://192.168.1.92:8080/$APP-backups/daily/\$day.dump"; then
              echo "dump: daily/\$day.dump \$(wc -c < /restore/db.dump) bytes"; exit 0; fi
          done
          echo "no daily dump found" >&2; exit 1
      env:
        - { name: AK, valueFrom: { secretKeyRef: { name: $S3SECRET, key: $AK } } }
        - { name: SK, valueFrom: { secretKeyRef: { name: $S3SECRET, key: $SK } } }
      volumeMounts: [{ name: restore, mountPath: /restore }]
  containers:
    - name: pg
      image: registry.simorghai.com/docker-proxy/library/postgres:17.5-alpine
      env:
        - { name: POSTGRES_PASSWORD, value: drill }
        - { name: POSTGRES_DB, value: drill }
      volumeMounts: [{ name: restore, mountPath: /restore }]
      resources: { requests: { cpu: 200m, memory: 512Mi }, limits: { memory: 2Gi } }
  volumes:
    - { name: restore, emptyDir: { sizeLimit: 10Gi } }
YAML
kubectl -n "$DRILL" wait --for=condition=Ready pod/drill --timeout=10m >/dev/null
kubectl -n "$DRILL" logs drill -c fetch | tail -1
until kubectl -n "$DRILL" exec drill -c pg -- pg_isready -U postgres >/dev/null 2>&1; do sleep 2; done

say "pg_restore"
kubectl -n "$DRILL" exec drill -c pg -- sh -c 'psql -U postgres -qc "CREATE ROLE '"$LIVEDB"' LOGIN" 2>/dev/null; pg_restore -U postgres -d drill --no-owner --no-privileges --exit-on-error /restore/db.dump' \
  && echo "restored without errors"

say "row counts: restored (last night) vs live (now)"
fail=0
for t in $TABLES; do
  r=$(kubectl -n "$DRILL" exec drill -c pg -- psql -U postgres -d drill -tAc "select count(*) from $t" 2>/dev/null || echo ERR)
  l=$(kubectl -n "$NS" exec "$LIVE" -- sh -c "psql -U \"\$POSTGRES_USER\" -d \"\${POSTGRES_DB:-$LIVEDB}\" -tAc 'select count(*) from $t'" 2>/dev/null || echo ERR)
  printf '   %-16s restored %8s   live %8s\n' "$t" "$r" "$l"
  [ "$r" != ERR ] && [ "$r" -gt 0 ] 2>/dev/null || { [ "$t" = issue_comments ] || fail=1; }
done
echo
if [ $fail = 0 ]; then echo "RESTORE DRILL PASSED for $APP"; else echo "RESTORE DRILL FAILED for $APP (a main table is missing or empty)"; exit 1; fi
