# Simorgh Team Platform — Plane, Mattermost, n8n and the Team Assistant, inside Kara

Status: **Phase 0 done (findings in §8), waiting for approval.** Nothing here is deployed. Phase 0 is
`deploy/team-platform/phase0-discovery.sh` (read-only) and this document;
infrastructure changes wait for approval.

## 1. The rule that keeps it one platform

Kara is already the front door: one sign-in (Keycloak), people, companies and
roles, the kartabl of tasks and approvals, the audited connector to Odoo, events
on Kafka. New tools join **behind** it, the way Odoo did:

| Concern | Owner | The new tools |
|---|---|---|
| People, companies, roles | **Kara** (platform DB + Keycloak) | Plane and Mattermost accounts are *provisioned by Kara*, never created by hand |
| Who-is-who across apps | **Kara** `platform.app_identities` | Mattermost user id, Plane user id, Keycloak sub, Kara person id |
| Approvals | **Kara** kartabl (durable, audited) | Mattermost buttons and n8n only *carry* the decision |
| Software / IT project work (issues, cycles, modules) | **Plane** | Kara shows each person's Plane issues in "my work" |
| Business work (leave, purchases, ECOs, shop floor, service) | Kara + Odoo | unchanged |
| Team chat | **Mattermost** (Kara's planned "company chat") | Kara links to it, shows unread counts; meetings stay Kara/Jitsi |
| Workflows | **n8n** (already running, `n8n.simorghai.com`) | new workflows; no second n8n |
| Language models | **llm-gateway** (`llm.simorghai.com`, key per app) | key `team-assistant` |
| Documents | Nextcloud + the existing vector store | no new vector database |

So the Team Assistant does not get its own copy of identity, permissions or
approvals: it calls **Kara's API as its tool gateway**, which answers *as the
asking person* and enforces their roles.

```
Mattermost ──(slash /ask /mytasks /project /report, @mention, DM)──► n8n  (Workflow A: AI Agent)
                                                                      │  tools = HTTP calls, on behalf of the user
                                                                      ▼
                                                   kara-api /assistant/*   ← identity map, roles, audit, approvals
                                                     │        │         │          │
                                                  Plane    Odoo (via   kartabl   knowledge search
                                                  API      connector)  (tasks,   (Nextcloud docs,
                                                                       approvals) vector store, ACL)
Plane webhooks ──► n8n (Workflow G, HMAC check) ──► Kafka plane.issue.v1 ──► Kara read model + Mattermost notices
```

## 2. Where the brief's "known context" is out of date (check in Phase 0)

| Brief says | What we know (Oct 2026) | Consequence |
|---|---|---|
| Workers 1.92, 1.93 | also **worker3 1.96** (hosts the website) | include it in capacity |
| GPUs: NVIDIA A30 24 GB | gpu-worker1/2 serve qwen3.8-27b (text), Qwen3.5-9B, a VLM — card model to confirm with `nvidia-smi` | the assistant shares these GPUs; measure headroom before adding load |
| Deploy n8n at `automation.simorghai.com` | **n8n 2.42.4 already runs** (ns `n8n`, own PostgreSQL 17, chart `deploy/helm/simorgh-n8n` in the Design Suite repo, approvals BPM live) | reuse it; add workflows; queue mode (Redis) only if load needs it |
| Mattermost at `chat.simorghai.com` | **`chat.` is taken** — alias of the Engineering AI chatbot on the edge nginx | use **`team.simorghai.com`** |
| "Existing AI adapter service", Qdrant | llm-gateway (OpenAI-compatible, LiteLLM) and the chatbot's `knowledge` service exist; **Qdrant to be confirmed** | if no Qdrant, use the chatbot's knowledge store; do not add a vector DB |
| LB pool `simorgh-lb-pool`, `.200` | per-namespace Gateways on .125–.132, .210–.220 in use; **.126 is taken by something else** | pick free IPs from the Phase 0 list |
| Delta Chat | overlaps Mattermost | decide whether it stays |

## 3. Licences that change the design

- **Plane Community Edition** (AGPL-3): SSO by OIDC/SAML is a paid (Pro/Business)
  feature. CE has Google/GitHub/**GitLab** OAuth and email login.
- **Mattermost Free** (formerly Team Edition): OpenID Connect is paid; Free has
  **GitLab** OAuth. Bots, slash commands, webhooks and interactive messages are free.
- We run **GitLab CE**, which signs users in through Keycloak (OIDC, free).
  ~~Keycloak → GitLab → Plane / Mattermost~~ — **rejected in Phase 0**: GitLab runs on
  1.68 (EOL, compromised in Oct 2026); everyone's login must not depend on it.
  Instead a small **GitLab-OAuth shim** in front of Keycloak (namespace `kara`): it
  answers the three calls Plane and Mattermost make to "GitLab" (`/oauth/authorize`,
  `/oauth/token`, `/api/v4/user`) from the Keycloak `kara` realm. One password, Keycloak
  MFA, no GitLab. Until it exists: local accounts created by Kara with e-mail invites.
  Alternative: buy Plane Pro and Mattermost Professional and use Keycloak OIDC directly.
- Mobile push for Mattermost Free goes through Mattermost's test push service on the
  internet: set notifications to "generic, no message content".
- AGPL (Plane): fine for our own use; if Simorgh ships it to customers, modified
  source must be offered.

## 4. Deployment choices

| | Choice | Notes |
|---|---|---|
| Plane | Official Helm chart `plane-ce` **1.8.6 → Plane CE v1.4.3**, ns `plane`, `plane.simorghai.com` | own PostgreSQL (StatefulSet on `ceph-rbd-simorgh`, like Odoo/n8n); bundled Valkey and RabbitMQ (single pod — enough for a small team); **uploads to Ceph RGW S3** (no MinIO) |
| Mattermost | **Mattermost Operator** (the method Mattermost documents for Kubernetes; the team-edition chart is marked for migration) running **Mattermost Team Edition 11.7.x ESR** (supported to 2027-05-15) | ns `mattermost`, `team.simorghai.com`; own PostgreSQL; files in Ceph RGW S3; bots + personal access tokens enabled for the bot only |
| n8n | the running instance | add credentials: Mattermost bot, Plane API, Kara assistant, llm-gateway |
| Gateways | one Gateway per namespace (our pattern), `wildcard-simorghai-tls` synced by `sync-wildcard-cert.sh` | 2 new LoadBalancer IPs (plane, mattermost) |
| Public access | edge nginx on 1.68 + ArvanCloud, `host_is_public 1` | Mattermost needs WebSocket + long timeouts (own server block) |
| Images | Harbor proxy projects (`docker-proxy`, `ghcr-proxy`, …) with pinned tags | no direct pulls from nodes; `mirror` = a pull through Harbor once, recorded in the compatibility table |

DNS (PowerDNS + ArvanCloud): `plane`, `team`. Storage (Ceph): Plane PG 20 Gi,
Plane uploads (S3) 50 Gi, Mattermost PG 20 Gi, Mattermost files (S3) 100 Gi —
to be sized from Phase 0 free space.

## 5. Kara changes (the integration work)

1. **Provisioning** (`provisioning/`): app keys `plane` and `mattermost`. A person
   given the app → Mattermost user (auth service `gitlab`, team per company,
   default channels) and Plane workspace member; removal → deactivate. Results in
   `platform.app_identities (person_id, app, external_id, username, state)`.
2. **Assistant API** (`assistant/` module, internal only, service token from n8n +
   the Mattermost user id, resolved through `app_identities` — a user id in a
   message is never trusted):
   - read: `my-work` (kartabl + Plane issues + Odoo work orders/service visits),
     `project-status`, `issue`, `activity`, `search-documents` (filtered by the
     person's Nextcloud/Kara groups), `report`;
   - write (Phase 5): `propose` → creates a kartabl approval with the exact change;
     only an approval executes it (Plane API), never the model.
   - every call → `platform.assistant_audit` (time, person, tool, target, arguments,
     approval, result; no tokens or document bodies).
3. **Events**: Plane webhooks → n8n (signature check, idempotency key) → Kafka
   `plane.issue.v1` → Kara read model; Kara notices → Mattermost DMs.
4. **Kara UI**: "Team chat" and "Projects" entries that open Mattermost and Plane
   (single sign-on through GitLab/Keycloak), Plane issues in "my work".

## 6. Phases

| Phase | What | Exit check |
|---|---|---|
| 0 | `phase0-discovery.sh`, this plan, versions pinned, IPs/DNS chosen | your approval |
| 1 | Plane + Mattermost (namespaces, PG, S3 buckets, Gateways, DNS, GitLab OAuth) | login via Keycloak; a project and a channel created |
| 2 | n8n: credentials, webhook auth; queue mode only if needed | test workflow runs and survives a restart |
| 3 | Kara provisioning + identity map; bot `simorgh-assistant`; read-only assistant (A, B, C) | fa/en questions answered from real data, with Plane links |
| 4 | Daily digest, weekly report, Plane notifications (E, F, G) | messages arrive on schedule; no duplicates on webhook retry |
| 5 | Write tools through kartabl approvals (D, H) | nothing changes in Plane without an approval |
| 6 | Knowledge: Nextcloud ingestion, ACL-filtered retrieval, citations | a user cannot retrieve a document they cannot open |
| 7 | Monitoring, backups (PG dumps + S3), DR runbook, load test | restore drill passes |

## 7. Build host disk

The master's root disk is 70 GB; `/home` has 400 GB free. Image builds
(`buildah`, `/var/lib/containers`) and discovery output go to `/home`
(see the move procedure given with this plan).

## 8. Phase 0 findings (2026-10-31, `phase0-discovery.sh`)

| Area | Found | Means |
|---|---|---|
| Kubernetes / Helm | 1.36.2, Helm 3.21.4, Cilium 1.19.3, Istio 1.25.0 ambient, cert-manager 1.21.1 | charts must accept 1.36 (`kubeVersion`) |
| Nodes | master 16c/32 GB (tainted); worker1, worker2 16c/32 GB; worker3, gpu-worker1/2 24c/32 GB | **memory is the limit**: in use 45–66% per node (worker2 66%) — CPU 2–8% |
| GPU | 1× NVIDIA A30 24 GB per GPU node, 21.5 / 22.2 GB used: `llm-text` Qwen3.8-27B-INT4 (gpu-worker1), Qwen3.5-9B-FP8 (gpu-worker2), vLLM v0.30.0, 32k context | **no room for another model**; the assistant shares these through llm-gateway; tool calling needs `--enable-auto-tool-choice --tool-call-parser` on vLLM (to check) |
| Vectors | Qdrant in `simorgh-chatbot` (qdrant-0, 10 Gi) and `hr-chatbot` (hr-qdrant); `hr-embeddings` service | reuse `simorgh-chatbot` Qdrant with its own collection; embedding model to confirm |
| Databases | one PostgreSQL StatefulSet per app (kara, odoo, keycloak, n8n, nextcloud, hr, erp-connector), Redis per app | Plane and Mattermost get their own, same pattern |
| Storage | `ceph-rbd-simorgh` (RWO), `ceph-fs-simorgh` (RWX); RGW S3 endpoint not seen in this scan | Mattermost files and Plane uploads on PVCs unless RGW is confirmed |
| Gateways / IPs | one Istio Gateway per namespace; LB IPs in use .125, .127–.132, .210–.220 (.126 taken outside k8s) | 2 new IPs: Plane, Mattermost — from the pool blocks (part 2) |
| DNS (PowerDNS) | no `plane`, `team`, `mm`, `chat`, `automation` records; `gitlab` → 1.68 | add `plane`, `team` |
| n8n | 2.42.4, single instance, own PG 17.5 (5 Gi), data 2 Gi, gateway .129 | reuse; queue mode not needed yet |
| Nextcloud | 34.0.3, PG + Redis on `ceph-rbd-kafka` | source for the knowledge base |
| Harbor | anonymous view: gcr-proxy, ghcr-proxy, istio-charts, library, simorgh-chatbot (docker-proxy is private) | Plane, Mattermost, Valkey, RabbitMQ, operator images via `docker-proxy` |
| Risks seen | GPU nodes on **Ubuntu 20.04 (end of standard support)**; Helm releases `istio-cni` and `ztunnel` in state **failed** (running, but the next upgrade must be handled); `strimzi-cluster-operator` **127 restarts**; stale pods (`llm-text` ContainerStatusUnknown, one collabora pod) | not blockers for Phase 1; listed for the ops backlog |
| Master disk | `/` 70 GB (28 used: buildah 13 GB, containerd 2.3 GB, /root 5.2 GB); `/home` 412 GB free | buildah storage moved to `/home` (bind mount) |
