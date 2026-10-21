#!/usr/bin/env bash
#
# DANGER: Kara back to an empty start, for test installations.
#   - Kara's database: every company (tenant_* schemas: members, roles, HR,
#     attendance, ledger, kartabl, tasks), the holdings, the user accounts,
#     and kara-api's copy of Odoo's data (kara_erp)
#   - Keycloak realm kara: its organizations and users, except the clients'
#     service accounts and the platform admin (chart value kara.superAdmin.email)
# Kept: the realm's settings, clients, theme and mail; the secrets; the chart.
# Afterwards the migration makes the empty platform schema and the platform
# admin again, who signs in with their existing Keycloak login.
# Odoo is not touched: simorgh-odoo deploy/scripts/reinstall-odoo19.sh for that.
#
#   deploy/scripts/reset-kara.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NS="${KARA_NAMESPACE:-kara}"

say() { printf '\n== %s\n' "$*"; }

ADMIN_EMAIL="$(helm -n "$NS" get values kara --all -o json | python3 -c 'import json,sys; print(json.load(sys.stdin)["kara"]["superAdmin"]["email"])')"
echo "This deletes ALL of Kara's data (companies, holdings, members, HR, ledger, kartabl, ERP copy)"
echo "and every user and organization of Keycloak realm kara except $ADMIN_EMAIL."
read -rp "Type RESET KARA to go on: " answer
[ "$answer" = "RESET KARA" ] || { echo "stopped"; exit 1; }

say "stop Kara"
kubectl -n "$NS" scale deploy/kara-web deploy/kara-api --replicas=0
kubectl -n "$NS" wait --for=delete pod -l 'app.kubernetes.io/name in (kara-web,kara-api)' --timeout=180s 2>/dev/null || true

say "empty Kara's database"
PGUSER_KARA="$(kubectl -n "$NS" get secret kara-db -o jsonpath='{.data.username}' | base64 -d)"
kubectl -n "$NS" exec -i kara-postgresql-0 -- psql -v ON_ERROR_STOP=1 -U "$PGUSER_KARA" -d kara -qAt <<'SQL'
DO $$
DECLARE s text;
BEGIN
  FOR s IN SELECT schema_name FROM information_schema.schemata
           WHERE schema_name IN ('platform', 'kara_erp') OR schema_name LIKE 'tenant\_%'
  LOOP
    EXECUTE format('DROP SCHEMA %I CASCADE', s);
    RAISE NOTICE 'dropped schema %', s;
  END LOOP;
END $$;
SELECT 'schemas left: ' || coalesce(string_agg(schema_name, ', '), 'none')
FROM information_schema.schemata
WHERE schema_name IN ('platform', 'kara_erp') OR schema_name LIKE 'tenant\_%';
SQL

say "Keycloak realm kara: organizations and users"
KEEP_EMAILS="$ADMIN_EMAIL" KARA_NAMESPACE="$NS" "$ROOT/deploy/keycloak/setup-realm.sh" reset-identities

say "platform schema and admin again (the chart's migration job)"
helm -n "$NS" get values kara -o yaml > /tmp/kara-values.yaml
helm upgrade kara "$ROOT/deploy/helm/simorgh-kara" -n "$NS" -f /tmp/kara-values.yaml --wait --timeout 30m
rm -f /tmp/kara-values.yaml

say "start Kara"
kubectl -n "$NS" scale deploy/kara-web deploy/kara-api --replicas=2
kubectl -n "$NS" rollout status deploy/kara-web --timeout=10m
kubectl -n "$NS" rollout status deploy/kara-api --timeout=10m

cat <<DONE

Done: Kara is empty. Sign in at https://kara.simorghai.com as $ADMIN_EMAIL
(your Keycloak password is unchanged) and add the companies again.
DONE
