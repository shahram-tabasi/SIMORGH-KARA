# Simorgh Team Platform — deployment runbook

Plan and decisions: [`docs/TEAM-PLATFORM.md`](../../docs/TEAM-PLATFORM.md).
Every command runs **on the k8s master as root**, from a checkout of
`simorgh-kara` (branch `claude/serene-cannon-h4ff93`), unless it says otherwise.

| Phase | What | Files |
|---|---|---|
| 0 | Discovery (read-only) | `phase0-discovery.sh` |
| 1 | Plane CE (`plane.simorghai.com`, .133) and Mattermost Team Edition (`team.simorghai.com`, .134), LAN only | `make-secrets.sh`, `plane/{values,edge,policies}.yaml`, `../helm/simorgh-mattermost/` |

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
