# Simorgh Kara on the platform

Kara is the screen people work in; Odoo (repo simorgh-odoo) is the system of
record behind it, reached only through the erp-connector. The plan as a
whole is simorgh-odoo `docs/PLATFORM-INTEGRATION.md`; this is Kara's part.

```
browser ─► kara.simorghai.com (Gateway 192.168.1.132) ─► kara-web   Next.js, this repository's root
                                                           │  its own session cookie, as before
                                                           │  service token (client kara-web) + X-Kara-Account
Keycloak realm kara ◄── sign-in · users · organizations ── kara-api   NestJS, services/kara-api
                                                           │  REST, token of client kara-api in realm simorgh
                                          erp-connector ◄──┘           ▲ erp.partner|product|employee|sale_order.v1
                                                 └─► Odoo ──► Kafka ───┘
kara-web, kara-api ─► Postgres: platform + tenant_* schemas, kara_erp (the Odoo read model)
```

## Step by step, not a rewrite

kara-web keeps every page, server action and table it had. What moved:

| | Before | Now |
|---|---|---|
| Sign-in | email + password in Kara | Keycloak (realm `kara`) → the same Kara session (`src/lib/login.ts`) |
| New account | admin types a password | Keycloak user in the tenant's organization, emailed a link to set the password |
| Password change | profile page | Keycloak account page (linked from the profile) |
| Partners, products, employees, orders | — | Odoo, through kara-api's read model (`/app/<slug>/erp`) |

Further modules move to kara-api one at a time (members, leave, attendance,
kartabl…), each with its tables; kara-web then calls kara-api instead of the
database. Until a module moves, it stays as it is.

## One login page, Kara's look

With Keycloak only (`kara.passwordLogin=false`), /login and /c/<slug> go
straight to Keycloak, which shows Kara's own login page: the theme
`deploy/helm/simorgh-kara/keycloak-theme/kara` (login: keycloak.v2 restyled —
background, logo, glass card, amber/indigo, Vazirmatn, RTL; email: Persian,
dark header with the Kara logo embedded, Kara signature). The chart publishes
it as ConfigMap `keycloak-theme-kara` in namespace keycloak; the
simorgh-keycloak chart mounts it (`extraThemes`); `setup.sh theme` makes realm
kara use it. After changing the theme: upgrade this chart, then
`kubectl -n keycloak rollout restart statefulset/keycloak`.

Kara's /login page shows itself only to say why a sign-in did not end in
Kara (no account for that email, company suspended…), with a retry button.

## Tenants, organizations, Odoo companies

- A tenant (`platform.companies`) is a Keycloak **organization** in realm
  `kara`, alias = the tenant's slug. kara-api makes it on the first account.
- Kara decides who belongs where and with which rights (members, roles,
  permissions). Keycloak only proves who someone is (the verified email).
- A tenant may be **linked to an Odoo company** (`odoo_company_id`, set by the
  platform admin on /admin/companies). Linked tenants see that company's
  partners, products, employees and sale orders, plus partners and products
  shared by all companies; `erp.view` reads, `erp.manage` creates.
  Customer tenants stay unlinked and keep Kara's own data.
- Simorgh staff sign in with their realm-simorgh account:
  `deploy/keycloak/setup-realm.sh staff-idp <their tenant's slug>` links
  realm simorgh as the organization's identity provider for
  `@simorghai.com`; then set the chart's `keycloak.brokeredDomains`.

## Running it

Local: `.env` as `.env.example`; without the KEYCLOAK_* variables Kara signs
in with its own passwords exactly as before. kara-api: `services/kara-api`
(`npm run build && node dist/main.js`, variables in `src/config.ts`).

Cluster (as root on the k8s master):

```bash
cd ~/simorgh-kara && git pull --ff-only
set -o pipefail; export TMPDIR=/home/buildah-tmp; VERSION=2.0.0
buildah bud --target web     -t registry.simorghai.com/simorgh/kara-web:$VERSION     . 2>&1 | tee /root/kara-build.log \
 && buildah bud --target migrate -t registry.simorghai.com/simorgh/kara-migrate:$VERSION . 2>&1 | tee -a /root/kara-build.log \
 && buildah bud -t registry.simorghai.com/simorgh/kara-api:$VERSION services/kara-api 2>&1 | tee -a /root/kara-build.log \
 && for i in kara-web kara-migrate kara-api; do buildah push registry.simorghai.com/simorgh/$i:$VERSION 2>&1 | tee -a /root/kara-build.log; done

deploy/helm/simorgh-kara/scripts/setup.sh secrets
deploy/helm/simorgh-kara/scripts/setup.sh keycloak
~/simorgh-technical-chatbot-cloud/deploy/scripts/sync-wildcard-cert.sh kara
helm upgrade --install kara deploy/helm/simorgh-kara -n kara --set image.tag=$VERSION --wait --timeout 15m

# Every Kara account into Keycloak; --invite emails each a link to set a password.
kubectl -n kara exec deploy/kara-api -- /nodejs/bin/node dist/cli.js import-identities --invite
```

Then publish `kara.simorghai.com` like the other names (PowerDNS A record →
192.168.1.132; for the internet: `host_is_public` on .68 and the Arvan record).

Rolling back the sign-in: `--set kara.passwordLogin=true` brings Kara's
password form back beside Keycloak (accounts made while it was off have a
random password: they use "forgot password" in Keycloak, or an admin sets one).

## Calls and meetings (Jitsi)

Kara rings, Jitsi carries the voice and video (docs/VEO.md §9a):

- **Calls between colleagues**: "تماس و جلسه" in the menu (people, group call,
  recent and missed calls) and 📞 / 🎥 next to each member. The callee's Kara
  rings at the top of the screen (accept / decline); both meet in the call's
  private Jitsi room `call-<id>` inside Kara. Unanswered after 45 s
  (`CALL_RING_SECONDS`): missed, shown to both.
- **Meeting rooms**: one fixed room per record, `kara-<company>-<topic>`; the
  company's room from "اتاق جلسه شرکت".
- **How it works**: kara-api `comms` module. Calls in `kara_comms.calls` /
  `call_parties`; each open tab holds one server-sent-events stream
  (`/app/<slug>/comms/live` → kara-api `/v1/me/live`), fed through Postgres
  NOTIFY so any kara-api replica reaches any tab; a tab that (re)connects is
  sent the calls still ringing for it. kara-api signs a Jitsi token per person
  and room (HS256, iss `kara`, aud `jitsi`, sub `meet.jitsi`), with the secret
  Jitsi's prosody also holds.
- **Switching it on** (after Kara is deployed with this version):
  `deploy/jitsi/enable-kara-tokens.sh` makes the shared secret (jitsi/jitsi-jwt
  and kara/kara-jitsi), restarts kara-api, and switches Jitsi to Kara tokens
  only (no anonymous rooms). `… off` reopens Jitsi.
