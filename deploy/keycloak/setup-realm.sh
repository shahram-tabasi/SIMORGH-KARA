#!/usr/bin/env bash
#
# Keycloak realm `kara` for Simorgh Kara — idempotent: what exists is updated
# in place, never deleted. Nothing secret is printed or put on a command line.
#
#   deploy/keycloak/setup-realm.sh realm          # realm, clients, secrets into ns kara
#   deploy/keycloak/setup-realm.sh mail           # only the SMTP settings, again
#   deploy/keycloak/setup-realm.sh theme          # Kara's login and email theme (chart's keycloak-theme/kara)
#   deploy/keycloak/setup-realm.sh app-realms     # the apps' realms for Kara's provisioner:
#                                                 # simorgh (Design Suite) and hr (HR chatbot)
#   deploy/keycloak/setup-realm.sh staff-idp ORG  # Simorgh staff sign in with their
#                                                 # realm-simorgh account (org alias ORG)
#   KEEP_EMAILS="a@x b@y" deploy/keycloak/setup-realm.sh reset-identities
#                                                 # DELETES every organization and user
#                                                 # of the realm but service accounts and
#                                                 # KEEP_EMAILS (deploy/scripts/reset-kara.sh)
#
# realm      Realm `kara` (organizations on: one organization per Kara tenant,
#            alias = the tenant's slug), Persian first,
#            SMTP copied from realm `simorgh` (its password is asked for, or
#            SMTP_PASSWORD), and two clients:
#              kara-web  confidential, code flow + PKCE, for the browser login
#                        (and /auth/login, where an invitation lands after the
#                        new password is set);
#                        its service account calls kara-api for the signed-in user
#              kara-api  service account with realm-management manage-users,
#                        view-users, query-users and manage-realm (Keycloak 26
#                        allows organization changes only with manage-realm)
#            Their secrets go to Secret kara/kara-keycloak (webClientSecret,
#            apiClientSecret). Also client kara-api in realm `simorgh`
#            (service account for the erp-connector, which trusts that realm),
#            secret in kara/kara-keycloak erpClientSecret.
# staff-idp  Identity provider `simorgh` (realm simorgh, client kara-broker) in
#            realm kara, linked to organization ORG with the domain
#            STAFF_DOMAIN (simorghai.com): a staff member types their email,
#            Keycloak sends them to the staff login, and their Kara account is
#            created on first sign-in. Run after the organization exists
#            (kara-api's import makes it).
#
# Locally, against a Keycloak on this machine:
#   KCADM=/path/kcadm.sh KC_SERVER=http://127.0.0.1:8080 KC_ADMIN_PASSWORD=… \
#   KARA_HOST=localhost:3000 KARA_SCHEME=http NO_K8S=1 THEME= setup-realm.sh realm

set -euo pipefail
REALM="${REALM:-kara}"
STAFF_REALM="${STAFF_REALM:-simorgh}"
KARA_HOST="${KARA_HOST:-kara.simorghai.com}"
KARA_SCHEME="${KARA_SCHEME:-https}"
PUBLIC_KC="${PUBLIC_KC:-https://auth.simorghai.com}"
STAFF_DOMAIN="${STAFF_DOMAIN:-simorghai.com}"
THEME="${THEME-kara}"
NS="${KARA_NAMESPACE:-kara}"
KC_NS="${KEYCLOAK_NAMESPACE:-keycloak}"
CFG=/tmp/kcadm-kara.config

say() { printf '\n== %s\n' "$*"; }
secret_value() { kubectl -n "$1" get secret "$2" -o "jsonpath={.data.$3}" | base64 -d; }

if [ -n "${KCADM:-}" ]; then
  kc() { "$KCADM" "$@" --config "$CFG"; }
  login() { printf '%s\n' "${KC_ADMIN_PASSWORD:?}" | "$KCADM" config credentials --config "$CFG" \
      --server "${KC_SERVER:?}" --realm master --user "${KC_ADMIN_USER:-admin}" --password "$(cat)" >/dev/null; }
  logout() { rm -f "$CFG"; }
else
  POD="$(kubectl -n "$KC_NS" get pod -l app.kubernetes.io/name=keycloak -o jsonpath='{.items[0].metadata.name}')"
  kc() { kubectl -n "$KC_NS" exec -i "$POD" -c keycloak -- /opt/keycloak/bin/kcadm.sh "$@" --config "$CFG"; }
  login() {
    local user pass
    user="$(secret_value "$KC_NS" keycloak-admin username 2>/dev/null || true)"
    pass="$(secret_value "$KC_NS" keycloak-admin password 2>/dev/null || true)"
    [ -n "$user" ] || read -rp "Keycloak admin user: " user
    [ -n "$pass" ] || { read -rsp "Keycloak admin password: " pass; echo; }
    printf '%s\n' "$pass" | kubectl -n "$KC_NS" exec -i "$POD" -c keycloak -- sh -c \
      "/opt/keycloak/bin/kcadm.sh config credentials --config $CFG --server http://localhost:8080 --realm master --user '$user' --password \"\$(cat)\"" >/dev/null
  }
  logout() { kubectl -n "$KC_NS" exec "$POD" -c keycloak -- rm -f "$CFG"; }
fi

client_id() { kc get clients -r "$1" -q clientId="$2" --fields id --format csv --noquotes | head -1 | tr -d '\r'; }

# create-or-update a client from JSON on stdin; prints its internal id
upsert_client() {
  local realm="$1" client="$2" json id
  json="$(cat)"
  id="$(client_id "$realm" "$client")"
  if [ -z "$id" ]; then
    printf '%s' "$json" | kc create clients -r "$realm" -f - >/dev/null
    id="$(client_id "$realm" "$client")"
    echo "created client $client in $realm" >&2
  else
    printf '%s' "$json" | kc update "clients/$id" -r "$realm" -f - >/dev/null
    echo "updated client $client in $realm" >&2
  fi
  printf '%s' "$id"
}

# Client scopes by name, attached explicitly: a scope list inside the client's
# JSON is used only on create (and an optional list there replaces the
# defaults, leaving tokens without profile and email).
attach_scopes() {  # realm client-id kind(default|optional) names…
  local realm="$1" id="$2" kind="$3"; shift 3
  local all sid
  all="$(kc get client-scopes -r "$realm" --fields id,name --format csv --noquotes | tr -d '\r')"
  for name in "$@"; do
    sid="$(printf '%s\n' "$all" | awk -F, -v n="$name" '$2==n{print $1}')"
    [ -n "$sid" ] || { echo "no client scope $name in $realm" >&2; continue; }
    kc update "clients/$id/$kind-client-scopes/$sid" -r "$realm" >/dev/null
  done
}

client_secret() { kc get "clients/$2/client-secret" -r "$1" --fields value --format csv --noquotes | tr -d '\r\n'; }

store_secret() {  # key [namespace] [secret] — value on stdin
  [ -n "${NO_K8S:-}" ] && { cat >/dev/null; echo "(NO_K8S: $1 not stored)"; return; }
  local key="$1" ns="${2:-$NS}" name="${3:-kara-keycloak}" val
  val="$(cat)"
  kubectl get ns "$ns" >/dev/null 2>&1 || kubectl create ns "$ns" >/dev/null
  { kubectl -n "$ns" get secret "$name" -o json 2>/dev/null || echo '{}'; } | KEY="$key" VAL="$val" NAME="$name" python3 -c '
import base64, json, os, sys
d = json.load(sys.stdin).get("data") or {}
d[os.environ["KEY"]] = base64.b64encode(os.environ["VAL"].encode()).decode()
print(json.dumps({"apiVersion": "v1", "kind": "Secret", "type": "Opaque",
                  "metadata": {"name": os.environ["NAME"], "namespace": sys.argv[1]}, "data": d}))' "$ns" | kubectl apply -f - >/dev/null
  echo "stored $key in $ns/$name"
}

# Login and email theme of the realm: `kara` (published by the simorgh-kara
# chart, mounted by simorgh-keycloak's extraThemes). Set it only once Keycloak
# has the theme (pods restarted after both charts): a realm naming a theme
# Keycloak does not have shows an error page instead of the login.
theme() {
  say "theme $THEME"
  [ -n "$THEME" ] || { echo "skipped (THEME empty)"; return; }
  printf '%s' "{\"loginTheme\":\"$THEME\",\"emailTheme\":\"$THEME\"}" \
    | kc update "realms/$REALM" -f - >/dev/null && echo "login and email theme: $THEME"
}

mail() {  # [target realm] [sender name]
  local target="${1:-$REALM}" sender="${2:-سیمرغ کارا}"
  say "mail of realm $target (from realm $STAFF_REALM)"
  if [ -n "${NO_SMTP:-}" ]; then echo "skipped (NO_SMTP)"; else
    local smtp
    # `smtpServer(*)`: kcadm prints a nested object empty unless asked for its fields.
    smtp="$(kc get "realms/$STAFF_REALM" --fields 'smtpServer(*)' 2>/dev/null || echo '{}')"
    if printf '%s' "$smtp" | python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("smtpServer",{}).get("host") else 1)'; then
      local pass="${SMTP_PASSWORD:-}"
      [ -n "$pass" ] || { read -rsp "SMTP password of $(printf '%s' "$smtp" | python3 -c 'import json,sys; print(json.load(sys.stdin)["smtpServer"].get("user",""))'): " pass; echo; }
      printf '%s' "$smtp" | P="$pass" SENDER="$sender" python3 -c '
import json, os, sys
s = json.load(sys.stdin)["smtpServer"]
s["password"] = os.environ["P"]
s["fromDisplayName"] = os.environ["SENDER"]
print(json.dumps({"smtpServer": s}))' | kc update "realms/$target" -f - >/dev/null && echo "copied (sender $(printf '%s' "$smtp" | python3 -c 'import json,sys; print(json.load(sys.stdin)["smtpServer"].get("from",""))'))"
    else echo "realm $STAFF_REALM has no SMTP: set it in the console (Realm settings → Email)"; fi
  fi
}

realm() {
  say "realm $REALM"
  if kc get "realms/$REALM" --fields realm >/dev/null 2>&1; then echo "exists"; else
    kc create realms -s realm="$REALM" -s enabled=true >/dev/null && echo created
  fi
  printf '%s' "{\"displayName\":\"سیمرغ کارا\",\"displayNameHtml\":\"Simorgh Kara\",
    \"organizationsEnabled\":true,\"registrationAllowed\":false,\"resetPasswordAllowed\":true,
    \"loginWithEmailAllowed\":true,\"duplicateEmailsAllowed\":false,\"rememberMe\":true,
    \"verifyEmail\":false,\"bruteForceProtected\":true,
    \"internationalizationEnabled\":true,\"supportedLocales\":[\"fa\",\"en\"],\"defaultLocale\":\"fa\",
    \"ssoSessionIdleTimeout\":28800,\"ssoSessionMaxLifespan\":86400,
    \"passwordPolicy\":\"length(8) and notUsername and notEmail\"}" \
    | kc update "realms/$REALM" -f - >/dev/null && echo "settings applied"

  mail

  say "client kara-web (browser login)"
  local base="$KARA_SCHEME://$KARA_HOST" web api
  web="$(printf '%s' "{\"clientId\":\"kara-web\",\"name\":\"Simorgh Kara\",\"enabled\":true,\"publicClient\":false,
    \"clientAuthenticatorType\":\"client-secret\",\"standardFlowEnabled\":true,\"directAccessGrantsEnabled\":false,
    \"implicitFlowEnabled\":false,\"serviceAccountsEnabled\":true,\"frontchannelLogout\":true,
    \"rootUrl\":\"$base\",\"baseUrl\":\"/\",\"redirectUris\":[\"$base/auth/callback\",\"$base/auth/login\"],\"webOrigins\":[\"$base\"],
    \"attributes\":{\"pkce.code.challenge.method\":\"S256\",\"post.logout.redirect.uris\":\"$base/*\"}
    }" | upsert_client "$REALM" kara-web)"
  attach_scopes "$REALM" "$web" default basic profile email roles web-origins acr
  attach_scopes "$REALM" "$web" optional organization
  client_secret "$REALM" "$web" | store_secret webClientSecret

  say "client kara-api (service account: users and organizations)"
  api="$(printf '%s' '{"clientId":"kara-api","name":"Kara API","enabled":true,"publicClient":false,
    "clientAuthenticatorType":"client-secret","standardFlowEnabled":false,"directAccessGrantsEnabled":false,
    "serviceAccountsEnabled":true}' | upsert_client "$REALM" kara-api)"
  kc add-roles -r "$REALM" --uusername service-account-kara-api --cclientid realm-management \
    --rolename manage-users --rolename view-users --rolename query-users --rolename manage-realm >/dev/null
  echo "granted manage-users, view-users, query-users, manage-realm"
  client_secret "$REALM" "$api" | store_secret apiClientSecret

  if [ -n "${NO_STAFF_REALM:-}" ]; then return; fi
  say "client kara-api in realm $STAFF_REALM (for the erp-connector)"
  api="$(printf '%s' '{"clientId":"kara-api","name":"Kara API → erp-connector","enabled":true,"publicClient":false,
    "clientAuthenticatorType":"client-secret","standardFlowEnabled":false,"directAccessGrantsEnabled":false,
    "serviceAccountsEnabled":true}' | upsert_client "$STAFF_REALM" kara-api)"
  client_secret "$STAFF_REALM" "$api" | store_secret erpClientSecret
}

staff_idp() {
  local org="${1:?usage: $0 staff-idp ORG_ALIAS}" broker idp_json org_id
  say "client kara-broker in realm $STAFF_REALM"
  broker="$(printf '%s' "{\"clientId\":\"kara-broker\",\"name\":\"Simorgh Kara (staff sign-in)\",\"enabled\":true,
    \"publicClient\":false,\"clientAuthenticatorType\":\"client-secret\",\"standardFlowEnabled\":true,
    \"directAccessGrantsEnabled\":false,\"redirectUris\":[\"$PUBLIC_KC/realms/$REALM/broker/simorgh/endpoint\"]}" \
    | upsert_client "$STAFF_REALM" kara-broker)"

  say "identity provider simorgh in realm $REALM"
  idp_json="$(client_secret "$STAFF_REALM" "$broker" | ISSUER="$PUBLIC_KC/realms/$STAFF_REALM" python3 -c '
import json, os, sys
i = os.environ["ISSUER"]
print(json.dumps({"alias": "simorgh", "displayName": "Simorgh staff", "providerId": "keycloak-oidc", "enabled": True,
  "trustEmail": True, "firstBrokerLoginFlowAlias": "first broker login", "hideOnLogin": True,
  "config": {"issuer": i, "authorizationUrl": i + "/protocol/openid-connect/auth",
             "tokenUrl": i + "/protocol/openid-connect/token", "userInfoUrl": i + "/protocol/openid-connect/userinfo",
             "jwksUrl": i + "/protocol/openid-connect/certs", "logoutUrl": i + "/protocol/openid-connect/logout",
             "validateSignature": "true", "useJwksUrl": "true", "pkceEnabled": "true", "pkceMethod": "S256",
             "clientId": "kara-broker", "clientSecret": sys.stdin.read().strip(),
             "clientAuthMethod": "client_secret_post", "defaultScope": "openid email profile",
             "syncMode": "IMPORT"}}))')"
  if kc get identity-provider/instances/simorgh -r "$REALM" --fields alias >/dev/null 2>&1; then
    printf '%s' "$idp_json" | kc update identity-provider/instances/simorgh -r "$REALM" -f - >/dev/null && echo updated
  else
    printf '%s' "$idp_json" | kc create identity-provider/instances -r "$REALM" -f - >/dev/null && echo created
  fi
  unset idp_json

  say "link to organization $org (domain $STAFF_DOMAIN)"
  org_id="$(kc get organizations -r "$REALM" --fields id,alias --format csv --noquotes | tr -d '\r' | awk -F, -v a="$org" '$2==a{print $1}')"
  [ -n "$org_id" ] || { echo "no organization with alias $org in $REALM (import the tenants first)" >&2; exit 1; }
  kc get "organizations/$org_id" -r "$REALM" | DOMAIN="$STAFF_DOMAIN" python3 -c '
import json, os, sys
o = json.load(sys.stdin)
d = os.environ["DOMAIN"]
if d not in [x.get("name") for x in o.get("domains") or []]:
    o.setdefault("domains", []).append({"name": d, "verified": True})
print(json.dumps(o))' | kc update "organizations/$org_id" -r "$REALM" -f - >/dev/null
  if ! kc get "organizations/$org_id/identity-providers" -r "$REALM" --fields alias --format csv --noquotes | grep -qx simorgh; then
    printf '"simorgh"' | kc create "organizations/$org_id/identity-providers" -r "$REALM" -f - >/dev/null
  fi
  kc get identity-provider/instances/simorgh -r "$REALM" | DOMAIN="$STAFF_DOMAIN" python3 -c '
import json, os, sys
p = json.load(sys.stdin)
p["config"]["kc.org.domain"] = os.environ["DOMAIN"]
p["config"]["kc.org.broker.redirect.mode.email-matches"] = "true"
print(json.dumps(p))' | kc update identity-provider/instances/simorgh -r "$REALM" -f - >/dev/null
  echo "staff with @$STAFF_DOMAIN emails go to the staff login"
}

# A realm role, created when missing.
ensure_role() {  # realm role description
  kc get "roles/$2" -r "$1" --fields name >/dev/null 2>&1 && return
  kc create roles -r "$1" -s name="$2" -s "description=$3" >/dev/null && echo "created role $2 in $1"
}

# Attributes karaId and karaAdopted in the realm's user profile: karaId marks
# an account Kara manages (the provisioner finds people by it and never
# touches one without it); karaAdopted one that was there before Kara (a
# staff account), which Kara never disables. Admin-only.
kara_attribute() {  # realm
  kc get "realms/$1/users/profile" | python3 -c '
import json, sys
p = json.load(sys.stdin)
a = [x for x in p.get("attributes", []) if x.get("name") not in ("karaId", "karaAdopted")]
for n, d in (("karaId", "Kara ID"), ("karaAdopted", "Adopted by Kara")):
    a.append({"name": n, "displayName": d, "multivalued": False,
              "permissions": {"view": ["admin"], "edit": ["admin"]}})
p["attributes"] = a
print(json.dumps(p))' | kc update "realms/$1/users/profile" -f - >/dev/null && echo "user profile: karaId, karaAdopted (admin only)"
}

# Protocol mapper on a client, created when missing (by name).
ensure_mapper() {  # realm client-id json
  local name
  name="$(printf '%s' "$3" | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"
  if kc get "clients/$2/protocol-mappers/models" -r "$1" --fields name --format csv --noquotes | tr -d '\r' | grep -qx "$name"; then
    echo "mapper $name exists"
  else
    printf '%s' "$3" | kc create "clients/$2/protocol-mappers/models" -r "$1" -f - >/dev/null && echo "mapper $name added"
  fi
}

GROUPS_MAPPER='{"name":"groups","protocol":"openid-connect","protocolMapper":"oidc-group-membership-mapper",
  "config":{"claim.name":"groups","full.path":"true","id.token.claim":"true","access.token.claim":"true","userinfo.token.claim":"true"}}'

# The apps' realms, for Kara's provisioner (docs/INTEGRATION.md):
#   simorgh  Design Suite's realm as today: organizations on, roles offer and
#            simorgh-engineer, attribute karaId, the groups claim and the
#            optional organization scope on simorgh-web, and its client
#            kara-api allowed to manage users and organizations.
#   hr       The HR chatbot's realm: role hr-user, client simorgh-hr-chatbot
#            (browser login, and its service account reads each company's
#            knowledge from kara-api; secret into ns hr-chatbot Secret
#            hr-keycloak key clientSecret) and kara-provisioner (secret into
#            kara-keycloak hrProvisionerSecret). Mail copied from realm simorgh.
app_realms() {
  local ds="$STAFF_REALM" hr="${HR_REALM:-hr}" hr_base="https://${HR_HOST:-hr.simorghai.com}" id

  say "realm $ds (Design Suite)"
  printf '%s' '{"organizationsEnabled":true}' | kc update "realms/$ds" -f - >/dev/null && echo "organizations on"
  ensure_role "$ds" offer "Design Suite: offer tools"
  ensure_role "$ds" simorgh-engineer "Design Suite: engineering tools"
  kara_attribute "$ds"
  id="$(client_id "$ds" simorgh-web)"
  if [ -n "$id" ]; then
    ensure_mapper "$ds" "$id" "$GROUPS_MAPPER"
    attach_scopes "$ds" "$id" optional organization
  else echo "no client simorgh-web in $ds" >&2; fi
  id="$(client_id "$ds" kara-api)"
  [ -n "$id" ] || { echo "no client kara-api in $ds: run '$0 realm' first" >&2; exit 1; }
  kc add-roles -r "$ds" --uusername service-account-kara-api --cclientid realm-management \
    --rolename manage-users --rolename view-users --rolename query-users --rolename manage-realm >/dev/null
  echo "kara-api: manage-users, view-users, query-users, manage-realm"

  say "realm $hr (HR chatbot)"
  if kc get "realms/$hr" --fields realm >/dev/null 2>&1; then echo "exists"; else
    kc create realms -s realm="$hr" -s enabled=true >/dev/null && echo created
  fi
  printf '%s' '{"displayName":"Simorgh HR","organizationsEnabled":true,"registrationAllowed":false,
    "resetPasswordAllowed":true,"loginWithEmailAllowed":true,"duplicateEmailsAllowed":false,"rememberMe":true,
    "verifyEmail":false,"bruteForceProtected":true,
    "internationalizationEnabled":true,"supportedLocales":["en","fa","de"],"defaultLocale":"en",
    "ssoSessionIdleTimeout":28800,"ssoSessionMaxLifespan":86400,
    "passwordPolicy":"length(8) and notUsername and notEmail"}' \
    | kc update "realms/$hr" -f - >/dev/null && echo "settings applied"
  mail "$hr" "Simorgh HR"
  ensure_role "$hr" hr-user "HR chatbot user"
  kara_attribute "$hr"

  say "client simorgh-hr-chatbot (browser login)"
  id="$(printf '%s' "{\"clientId\":\"simorgh-hr-chatbot\",\"name\":\"Simorgh HR\",\"enabled\":true,\"publicClient\":false,
    \"clientAuthenticatorType\":\"client-secret\",\"standardFlowEnabled\":true,\"directAccessGrantsEnabled\":false,
    \"implicitFlowEnabled\":false,\"serviceAccountsEnabled\":true,\"frontchannelLogout\":true,
    \"rootUrl\":\"$hr_base\",\"baseUrl\":\"/\",\"redirectUris\":[\"$hr_base/*\"],\"webOrigins\":[\"$hr_base\"],
    \"attributes\":{\"pkce.code.challenge.method\":\"S256\",\"post.logout.redirect.uris\":\"$hr_base/*\"}
    }" | upsert_client "$hr" simorgh-hr-chatbot)"
  attach_scopes "$hr" "$id" default basic profile email roles web-origins acr
  attach_scopes "$hr" "$id" optional organization
  ensure_mapper "$hr" "$id" "$GROUPS_MAPPER"
  client_secret "$hr" "$id" | store_secret clientSecret "${HR_NAMESPACE:-hr-chatbot}" hr-keycloak

  say "client kara-provisioner (Kara's service account in $hr)"
  id="$(printf '%s' '{"clientId":"kara-provisioner","name":"Kara provisioner","enabled":true,"publicClient":false,
    "clientAuthenticatorType":"client-secret","standardFlowEnabled":false,"directAccessGrantsEnabled":false,
    "serviceAccountsEnabled":true}' | upsert_client "$hr" kara-provisioner)"
  kc add-roles -r "$hr" --uusername service-account-kara-provisioner --cclientid realm-management \
    --rolename manage-users --rolename view-users --rolename query-users --rolename manage-realm >/dev/null
  echo "granted manage-users, view-users, query-users, manage-realm"
  client_secret "$hr" "$id" | store_secret hrProvisionerSecret
}

# The one deleting command here, for deploy/scripts/reset-kara.sh: the realm's
# organizations, and its users except the clients' service accounts and
# KEEP_EMAILS. Settings, clients, theme, mail and identity providers stay.
reset_identities() {
  local keep=" ${KEEP_EMAILS:-} " n=0 id user email alias
  say "organizations of realm $REALM"
  while IFS=, read -r id alias; do
    [ -n "$id" ] || continue
    kc delete "organizations/$id" -r "$REALM" && echo "deleted organization $alias" && n=$((n+1))
  done < <(kc get organizations -r "$REALM" --limit 100000 --fields id,alias --format csv --noquotes | tr -d '\r')
  say "users of realm $REALM"
  while IFS=, read -r id user email; do
    [ -n "$id" ] || continue
    case "$user" in service-account-*) continue ;; esac
    if [ -n "$email" ] && [[ "$keep" == *" $email "* ]]; then echo "kept $email"; continue; fi
    kc delete "users/$id" -r "$REALM" && n=$((n+1))
  done < <(kc get users -r "$REALM" --limit 100000 --fields id,username,email --format csv --noquotes | tr -d '\r')
  echo "deleted: $n organizations and users"
}

login
trap logout EXIT
case "${1:-}" in
  realm) realm ;;
  mail) mail ;;
  theme) theme ;;
  app-realms) app_realms ;;
  staff-idp) shift; staff_idp "$@" ;;
  reset-identities) reset_identities ;;
  *) echo "usage: $0 realm | mail | theme | app-realms | staff-idp ORG_ALIAS | reset-identities"; exit 2 ;;
esac
