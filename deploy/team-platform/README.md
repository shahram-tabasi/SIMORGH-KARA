# Simorgh Team Platform — deployment runbook

Plan and decisions: [`docs/TEAM-PLATFORM.md`](../../docs/TEAM-PLATFORM.md).
Every command runs **on the k8s master as root**, from a checkout of
`simorgh-kara` (branch `claude/serene-cannon-h4ff93`), unless it says otherwise.

| Phase | What | Files |
|---|---|---|
| 0 | Discovery (read-only) | `phase0-discovery.sh` |
| 1 | Plane CE (`plane.simorghai.com`, .133) and Mattermost Team Edition (`team.simorghai.com`, .134); published through 1.68 | `make-secrets.sh`, `plane/{values,edge,policies}.yaml`, `../helm/simorgh-mattermost/` |
| 2 | Plane → Kara (signed webhooks, read model `kara_team`, Kafka `plane.issue.v1`); Kara's credentials for Plane and Mattermost | `phase2/setup.sh`, kara-api `src/team/` |
| 3 | Kara makes the accounts (Mattermost team per company, Plane invitations), one sign-in through Kara's "GitLab" adapter, the read-only assistant (`/mytasks` `/project` `/issue` `/ask`) | `phase3/setup.sh`, kara-api `src/sso/`, `src/assistant/`, `src/team/team-sync.ts` |

## Phase 1 — Plane and Mattermost

Nothing here touches an existing workload. It adds two namespaces, two
LoadBalancer IPs (.133, .134; both checked free), two Ceph RGW users and their
buckets, and two PowerDNS records. Images come through Harbor's `docker-proxy`
project; no secret goes into git.

| | Plane | Mattermost |
|---|---|---|
| Version | v1.4.3 (chart `plane-ce` 1.8.6) | 11.7.14 ESR (our chart) |
| Database | chart's PostgreSQL 15.7, 20Gi `ceph-rbd-simorgh` | PostgreSQL 17.5, 20Gi `ceph-rbd-simorgh` |
| Also | Valkey 1Gi, RabbitMQ 2Gi | — |
| Files | RGW bucket `plane-uploads` | RGW bucket `mattermost-files` |
| Memory requests (limits ≤ 1.5×) | ~2.9 GiB + the chart's PostgreSQL/Valkey/RabbitMQ (no requests settable) | ~1.5 GiB |
| Network | default-deny; in: Gateway 80/443; out: DNS, istiod, RGW .92:8080, mailcow .68:587 (`plane/policies.yaml`) | the same, in the chart (`networkPolicy`), plus Gateway-only AuthorizationPolicy |

### 0. Get the files

```bash
cd /root/simorgh-kara && git fetch origin claude/serene-cannon-h4ff93 \
  && git checkout claude/serene-cannon-h4ff93 && git pull
```

### 1. Namespaces, Secrets, RGW users

```bash
bash deploy/team-platform/make-secrets.sh
```

It prints only names. Run it again any time: existing passwords are kept.

### 2. TLS certificate in both namespaces

```bash
~/simorgh-technical-chatbot-cloud/deploy/scripts/sync-wildcard-cert.sh plane
~/simorgh-technical-chatbot-cloud/deploy/scripts/sync-wildcard-cert.sh mattermost
```

### 3. Plane

```bash
kubectl apply -f deploy/team-platform/plane/edge.yaml
kubectl apply -f deploy/team-platform/plane/policies.yaml

helm repo add plane https://helm.plane.so && helm repo update plane
helm upgrade --install plane plane/plane-ce --version 1.8.6 -n plane \
  -f deploy/team-platform/plane/values.yaml \
  -f /root/team-platform-secrets/plane-values-secrets.yaml

kubectl -n plane get pods -w        # the migrate job finishes, then every pod Running
```

### 4. Mattermost

```bash
helm upgrade --install mattermost deploy/helm/simorgh-mattermost -n mattermost
kubectl -n mattermost rollout status deploy/mattermost --timeout=10m
```

### 5. DNS (on 192.168.1.68, PowerDNS)

```bash
pdnsutil list-zone simorghai.com > /root/pdns-simorghai-$(date +%F).zone   # backup
pdnsutil replace-rrset simorghai.com plane A 300 192.168.1.133
pdnsutil replace-rrset simorghai.com team  A 300 192.168.1.134
pdnsutil increase-serial simorghai.com
```

LAN only for now: no ArvanCloud record and no edge nginx block. Publishing
them outside is a later, separate decision.

### 6. Check

```bash
kubectl get gateway -n plane; kubectl get gateway -n mattermost          # PROGRAMMED True, .133 / .134
curl -s -o /dev/null -w 'plane %{http_code}\n' https://plane.simorghai.com/
curl -s https://plane.simorghai.com/api/instances/ | head -c 200; echo
curl -s https://team.simorghai.com/api/v4/system/ping; echo              # "status":"OK"
kubectl -n plane logs deploy/plane-api-wl | grep -i bucket               # plane-uploads made
kubectl -n mattermost logs deploy/mattermost | grep -iE 'bucket|s3' | tail -3
ssh worker1 '/root/cephadm shell -- radosgw-admin bucket list' 2>/dev/null   # plane-uploads, mattermost-files
```

Plane makes its bucket when the API starts (`create_bucket`); Mattermost
makes its own on the first file upload, or at once from System Console →
File Storage → **Test Connection**. `mmctl` works inside the pod without a
token:

```bash
kubectl -n mattermost exec deploy/mattermost -- mmctl --local system status
```

### 7. First sign-in (in the browser, from the office)

**Plane** — `https://plane.simorghai.com/god-mode`:
1. Create the instance admin (your `@simorghai.com` address).
2. Authentication: turn **off** "Allow anyone to sign up"; keep email+password.
3. Email: host `mail.simorghai.com`, 587, TLS, user `team@simorghai.com`
   (step 8), then **Send test email**. Inside the cluster that name may resolve
   to the public address, which `policies.yaml` does not allow (the Plane chart
   has no hostAliases; Mattermost's chart pins it to .68). If the test fails,
   check `kubectl -n plane exec deploy/plane-api-wl -- getent hosts mail.simorghai.com`
   and tell me: the fix is a CoreDNS or policy change, not a guess here.
4. Create the workspace `simorgh`, then the first projects.

**Mattermost** — `https://team.simorghai.com`:
1. The first account created is the system admin: create yours now, before
   anyone else can reach the page.
2. Create the team `Simorgh`; invite people by email (invites only — open
   sign-up is off and limited to `simorghai.com`, `electrokavir.com`).
3. The bot `simorgh-assistant` is made in Phase 3; not now.

### 8. Mail (mailcow on 1.68)

Create the mailbox `team@simorghai.com` in the mailcow UI, then on the master:

```bash
read -rs -p 'team@ password: ' SMTP_PASSWORD; echo; export SMTP_PASSWORD
bash deploy/team-platform/make-secrets.sh && unset SMTP_PASSWORD
kubectl -n mattermost rollout restart deploy/mattermost
```

### Undo (only if asked)

```bash
helm -n plane uninstall plane; helm -n mattermost uninstall mattermost
# The way in, but not the namespace plane (it holds the PVCs):
kubectl -n plane delete httproute plane plane-https-redirect
kubectl -n plane delete gateway plane; kubectl -n plane delete svc plane-rgw
kubectl delete -f deploy/team-platform/plane/policies.yaml
kubectl delete ciliumloadbalancerippool simorgh-lb-pool-plane
kubectl delete ciliuml2announcementpolicy simorgh-plane-l2
```

The PVCs (the databases) stay until deleted on purpose:
`kubectl -n plane get pvc; kubectl -n mattermost get pvc`.

## Phase 2 — Plane and Mattermost talk to Kara

What it adds: kara-api receives Plane's workspace webhook (each delivery
checked against Plane's HMAC signature and applied once), keeps every Plane
project and issue in `kara_team.plane_projects` / `kara_team.plane_issues`
(also reloaded from Plane's API at start and every 6 h), and publishes each
issue change to Kafka `plane.issue.v1` (key: the issue id; `id` = Plane's
delivery id for de-duplication). Two Mattermost bots: `kara-provisioner`
(system admin: accounts and teams, Phase 3) and `simorgh-assistant` (what
people read). Nothing reaches the internet.

```
Plane worker ──webhook (signed)──► kara-api /v1/team/plane/webhook ──► kara_team.plane_issues
                                                                    └─► Kafka plane.issue.v1
kara-api ──X-Api-Key──► plane-api:8000      kara-api ──bot tokens──► mattermost:8065
```

### 1. Network paths and Plane's webhook allow-list

```bash
cd /root/simorgh-kara && git pull
bash deploy/team-platform/make-secrets.sh            # adds WEBHOOK_ALLOWED_HOSTS to plane-doc-store
kubectl -n plane rollout restart deploy/plane-api-wl deploy/plane-worker-wl
kubectl apply -f deploy/team-platform/plane/policies.yaml
helm upgrade mattermost deploy/helm/simorgh-mattermost -n mattermost
```

### 2. Credentials (asks for two values from Plane's screens)

In Plane first: **Profile → Settings → Personal access tokens → Add** (name
`kara`), and **Workspace settings → Webhooks → Add webhook** with URL
`http://kara-api.kara.svc.cluster.local:3001/v1/team/plane/webhook`, events
Projects + Work items + Work item comments. Keep both values for the prompt:

```bash
bash deploy/team-platform/phase2/setup.sh
```

### 3. kara-api with the Team Platform module (a new image tag)

```bash
kubectl -n kara get deploy kara-api -o jsonpath='{.spec.template.spec.containers[0].image}'; echo   # the tag running now
cd /root/simorgh-kara && set -o pipefail; export TMPDIR=/home/buildah-tmp; VERSION=<next tag>
NPM=http://5.161.149.228:4873/
buildah bud --layers --build-arg NPM_REGISTRY=$NPM -t registry.simorghai.com/simorgh/kara-api:$VERSION services/kara-api 2>&1 | tee /root/kara-build.log \
 && buildah bud --layers --build-arg NPM_REGISTRY=$NPM --target web -t registry.simorghai.com/simorgh/kara-web:$VERSION . 2>&1 | tee -a /root/kara-build.log \
 && buildah bud --layers --build-arg NPM_REGISTRY=$NPM --target migrate -t registry.simorghai.com/simorgh/kara-migrate:$VERSION . 2>&1 | tee -a /root/kara-build.log \
 && for i in kara-web kara-migrate kara-api; do buildah push registry.simorghai.com/simorgh/$i:$VERSION 2>&1 | tee -a /root/kara-build.log; done \
 && helm upgrade kara deploy/helm/simorgh-kara -n kara --reset-then-reuse-values --set image.tag=$VERSION --wait --timeout 15m
```

### 4. Check

```bash
kubectl -n kara logs deploy/kara-api | grep -iE 'plane backfill|Plane off|plane'
# In Plane: create or edit an issue, then:
kubectl -n kara logs deploy/kara-api --since=2m | grep -i 'team/plane/webhook'
kubectl -n kara exec sts/kara-postgresql -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
  "select project_key, sequence_id, name, state_group, synced_at from kara_team.plane_issues order by synced_at desc limit 5"'
K=$(kubectl -n kafka get pods -o name | grep -m1 -E 'kafka-[a-z-]*[0-9]+$')   # a broker pod
kubectl -n kafka exec "$K" -- bin/kafka-console-consumer.sh --bootstrap-server localhost:9093 \
  --topic plane.issue.v1 --from-beginning --max-messages 1 --timeout-ms 10000
```

A `403 bad signature` in the log means the secret in `kara-team` is not the
webhook's: `RESET_PLANE_WEBHOOK=1 bash deploy/team-platform/phase2/setup.sh`.
If topic auto-creation is off on the cluster, create `plane.issue.v1` once
(KafkaTopic, 3 partitions) — kara-api logs a warning and keeps the read model
current either way.

## Phase 3 — Kara makes the accounts; one sign-in; the assistant

What it adds:
- **Accounts from Kara.** In Kara (admin → company → apps) switch on
  *گفتگوی تیمی (Mattermost)* and *پروژه‌ها (Plane)*, then give people the role on
  their member page. The provisioner (the same queue as Keycloak and Odoo):
  Mattermost — a team per company (its slug), channels `town-square`,
  `announcements`, `kara-notifications`, the slash commands, an account per
  person, deactivated when the role is taken away; Plane — an invitation to the
  workspace with the role (member 15, admin 20, guest 5). Status per person in
  `platform.provisioning_state` (targets `mattermost`, `plane`); who is who in
  `kara_team.app_identities`.
- **One sign-in.** Plane and Mattermost (free editions) can only sign in with
  GitLab; kara-api answers as GitLab (`/sso/gitlab/…` on kara.simorghai.com) and
  signs the person in with Keycloak realm kara. Only people Kara gives the app
  get through. The button in both apps still says **GitLab** — tell people:
  "GitLab = your Kara account".
- **The assistant** (`@simorgh-assistant`): `/mytasks`, `/project ERP`,
  `/issue ERP-42`, `/ask …` in any channel; the answer comes as a direct
  message, built only from what the person may see (their kartabl and tasks,
  Plane projects they are a member of). Read-only; every call in
  `kara_team.assistant_audit`. `/ask` needs the llm-gateway key.

### 1. Images and network (kara-api and kara-web: a new tag)

```bash
cd /root/simorgh-kara && git pull
kubectl apply -f deploy/team-platform/plane/policies.yaml        # Plane → Kara's gateway (sign-in)
# build kara-api, kara-web and kara-migrate with VERSION=<next tag> exactly as Phase 2 step 3, then:
helm upgrade kara deploy/helm/simorgh-kara -n kara --reset-then-reuse-values --set image.tag=$VERSION --wait --timeout 15m
```

### 2. Sign-in and the model key

```bash
bash deploy/team-platform/phase3/setup.sh          # Keycloak client, Mattermost/Plane sign-in secrets, llm key
kubectl -n plane rollout restart deploy/plane-api-wl
helm upgrade mattermost deploy/helm/simorgh-mattermost -n mattermost --set mattermost.gitlabSso.enabled=true
kubectl -n plane exec deploy/plane-api-wl -- getent hosts kara.simorghai.com   # must be 192.168.1.132 (Kara's gateway)
```

If that last line shows a public address instead, Plane cannot reach the
adapter: tell me before going on (a CoreDNS entry fixes it).

### 3. Accounts made by Kara sign in with Kara

```bash
helm upgrade kara deploy/helm/simorgh-kara -n kara --reset-then-reuse-values --set api.team.mattermost.auth=gitlab --wait
```

From now on the Mattermost accounts Kara makes (and the ones it made before)
sign in with **GitLab** (= Kara). Your own first admin account keeps its
password — it was there before Kara.

### 4. Try it

1. Kara → admin → your company → apps: tick Mattermost and Plane. Members →
   yourself → Mattermost: user, Plane: admin. Within a minute:
   ```bash
   kubectl -n kara exec sts/kara-postgresql -- sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c \
     "select target, status, detail from platform.provisioning_state where target in ('"'"'mattermost'"'"','"'"'plane'"'"') order by synced_at desc limit 10"'
   ```
2. A private window → `https://team.simorghai.com` → **GitLab** → Kara's login →
   back in Mattermost, in your company's team.
3. `https://plane.simorghai.com` → **GitLab** → in the workspace (accept the
   invitation if Plane shows it).
4. In Mattermost: `/mytasks`, `/project <a project key>`, `/ask کارهای عقب‌افتاده من چیست؟`
   — the answers arrive from Simorgh Assistant.

Someone without the role who tries **GitLab** gets Kara's page "دسترسی شما …
فعال نیست" — that is the gate working.

