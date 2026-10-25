# Kara as the master: companies, units, people and knowledge across the platform

Status: design, 2026-10-25. Builds on VEO.md §7 (identity), §8 (events) and
PLATFORM.md (tenants ↔ Keycloak organizations ↔ Odoo companies).

## 1. What is asked, in one picture

```
                Kara (system of record: who, where, which apps, what the company knows)
                 │  every change = one row in the provisioning outbox (same transaction)
                 ▼
        ┌──────────── provisioner (kara-api) ────────────┐  idempotent steps, retries, a status per item,
        ▼                                                 ▼  nightly reconciliation (desired vs actual)
   Keycloak — one realm per app, each its own login    Odoo (through erp-connector)
     realm simorgh  → Design Suite                      res.company       = company
     realm hr       → HR chatbot                        hr.department     = unit
   in each realm the company has the app in:            hr.employee       = person (no Odoo login)
     organization = company, group = unit,              simorgh.knowledge = what the company knows
     user + realm roles = app access
        │                                         │   (products and their features, data sources,
        │  token: sub, email, organization,       │    orders and their impact, HR rules and orders)
        │  groups, roles                          │  erp.*.v1 events
        ▼                                         ▼
   Design Suite / HR chatbot  ── on sign-in ──►  kara-api "company context"  (reads its Odoo read model)
```

Three kinds of "role" in the request, kept apart because they answer different questions:

| The request says | It answers | Where it lives | In the token |
|---|---|---|---|
| **company role** (ekc) | *which data* the platform works with | Keycloak **organization** (alias = company slug) in the app's realm; the realm role of the same name too where one exists (`ekc` in realm simorgh, as today) | `organization` claim (and `realm_access.roles`) |
| **unit role** (engineering, offer…) | *where in the company* a person sits | realm group `/companies/<slug>/<unit path>` in the app's realm | `groups` |
| **app role** (Design Suite offer / engineering, HR chatbot user) | *which tools* a person may open | realm roles of the app's realm: `offer`, `simorgh-engineer` in realm simorgh; `hr-user` in realm hr | `realm_access.roles` |

Each app has its own login, both on Keycloak: Design Suite signs in through realm **simorgh** (its realm
today), the HR chatbot through a new realm **hr**. Kara writes a person into the realm of each app they are
given — not into the others — so one app's accounts never mix with another's, and Kara's own sign-in stays in
realm kara.

And one switch per company, an **entitlement**: "Design Suite enabled", "HR chatbot enabled". An app role can
only be given to a person whose company has the app enabled; turning an app off takes it from everyone in
that company (the leaver rule of ISO 27001 A.5.18).

## 2. The four workflows

### 2.1 Company (Kara → Odoo + Keycloak)

Kara admin creates or edits a company with `apps: { designSuite, hrChatbot }`.

| Step | Target | Action (idempotent: look up by Kara id first) |
|---|---|---|
| 1 | Odoo | `res.company` (name, currency, country); `simorgh_ref = kara:company:<id>`; Kara keeps `odoo_company_id` |
| 2 | Keycloak | in the realm of every app the company has: organization `alias = slug`, attribute `karaId`, group `/companies/<slug>` |
| 3 | Keycloak | an app turned off → in that app's realm every member of the company loses the app's roles and is disabled (a leaver step) |
| 4 | Events | `kara.company.v1` (CloudEvents, keyed by company id) |

### 2.2 Unit

Kara's `groups` tree (already there) is the unit.

| Step | Target | Action |
|---|---|---|
| 1 | Odoo | `hr.department` (name, parent, company, manager → employee) |
| 2 | Keycloak | in each app realm of the company: group `/companies/<slug>/<unit path>` (parent → child) |
| 3 | Events | `kara.unit.v1` |

### 2.3 Person (joiner / mover / leaver)

Kara member with company, units, Kara roles and **app access** (checkboxes shown only for apps the company
has enabled: Design Suite → `offer` and/or `engineering`; HR chatbot → `user`).

| Event | Keycloak | Odoo |
|---|---|---|
| joiner | in each app realm they are given: user (invited to set a password), organization member, unit groups, the app's roles | `hr.employee` (company, department, work email, job title), `simorgh_ref = kara:member:<id>` |
| mover (unit or app access changes) | groups and roles diffed per realm: add the new, remove the old; an app taken away → that realm's account disabled | department changed |
| leaver (disabled or removed) | disabled in every app realm, roles removed | employee archived |

Kara is the only writer. A change made in Keycloak or Odoo by hand is reported by reconciliation and undone
(or adopted by an admin), never silently kept.

### 2.4 Company knowledge (Kara → Odoo)

A new Odoo model `simorgh.knowledge` (addon `simorgh_integration`), one record per item, `company_id` required:

| kind | Example | Fields beyond title and body |
|---|---|---|
| `product` | "SIMOPRIME — MV switchgear" | category (MV/LV…), ratings (up to 24 kV, 4000 A, 31.5 kA 3 s, IAC…), standards, link to `product.template` |
| `datasource` | "Parts database (EKC .39)" | kind (SQL Server, MySQL…), host, database — **never a password** (a Kubernetes secret name instead) |
| `order` | "Company order 12/1405: offers above 50 bn need the board" | number, date, effective from/to, impact (which processes, units) |
| `hr_rule` | "Leave regulations, rev 3" | number, effective from/to, units it applies to, the text |
| `other` | anything the AI should know | — |

Products also stay real Odoo products (`product.template`, per company) so sales and offers use them; the
knowledge record holds the engineering description and structured features the AI reads. Each record carries
a `version` and `updatedAt`; edits are new versions, so an answer can cite which version it used.

Entered in Kara (new screen "Company knowledge", Persian / English), written to Odoo by the provisioner,
published as `erp.knowledge.v1`, read back into kara-api's read model like partners and products today.

## 3. Signing in

### 3.1 Design Suite

1. Login through its own realm, **simorgh**, client `simorgh-web` (as today), with the `organization` scope
   added.
2. The token says who (sub, email), which company (`organization`), which units (`groups`) and which tools
   (realm roles `offer`, `simorgh-engineer`). The web app shows tabs from the roles as today
   (`web/src/auth/permissions.ts`); the company is the organization claim, and the `ekc` role keeps working
   because Kara grants the realm role named after the company where one exists.
3. Right after login the web app asks projects-service `GET /api/v1/company/context`. projects-service
   calls kara-api `GET /v1/context` with the user's token (RFC 8693 token exchange to audience `kara-api`,
   so kara-api sees the person, not a service), and kara-api answers from its Odoo read model:
   company, units, products with features, data sources, orders in force. Cached per company with an
   ETag; refreshed on `kara.company.v1` / `erp.knowledge.v1`.
4. The AI services get it as an SMG skill, `company.skill.md` (products, ratings, standards, orders),
   next to `map-skill.md`, so every proposal and chat answer is checked against what the company sells and
   decided. Data sources replace today's per-role defaults (ekc → parts DB .39).

### 3.2 HR chatbot

Two doors, two kinds of answer:

| Signed in with | Company | Knowledge used |
|---|---|---|
| Keycloak (its own realm **hr**, client `simorgh-hr-chatbot`, role `hr-user`) | the token's organization | that company's `hr_rule` and `order` records |
| its own email/password or Google | **simorgh** (the default company) | Simorgh AI, its products and its own HR rules |

- The knowledge base becomes per company: Qdrant collection `hr_<company>` (a missing collection fails
  loudly; a forgotten filter in a shared collection would leak every company at once). The company comes
  from the verified token or the session, never from the request.
- The answer cache is per company too (today it is shared: a cached EKC answer must never reach another
  company).
- Ingestion follows `erp.knowledge.v1`: a rule's new version is chunked, embedded and written to its
  company's collection; the old version's chunks are removed. Each answer cites rule, number and version.
- A cross-company test runs in CI: ask company A's question as company B, expect no A source.

## 4. How it stays consistent (the practices)

- **One writer, one record.** Kara is the system of record for companies, units, people, entitlements and
  knowledge (MDM "golden record"); Keycloak and Odoo hold copies linked by `kara:<kind>:<id>`
  (`simorgh_ref` in Odoo, attribute `karaId` in Keycloak).
- **Transactional outbox** (as the erp-connector already does): the change and its provisioning job commit
  together; a worker runs the steps; at-least-once with idempotent steps (look up by Kara id, create or
  update, never duplicate).
- **Status you can see.** Every company, unit and person in Kara shows "in Keycloak ✓ / in Odoo ✓ / failed:
  reason, retry"; failures retry with backoff and alert after N.
- **Reconciliation** nightly and on demand: desired state (Kara) vs actual (Keycloak, Odoo); drift listed,
  repaired by the admin's choice.
- **Least privilege and the access lifecycle** (ISO/IEC 27001:2022 A.5.15, A.5.18; NIST RBAC): app roles
  only through entitlements; mover and leaver remove access in the same step; quarterly access review
  export from Kara (who has which app, since when, granted by whom).
- **Tenant isolation is enforced, not assumed.** The organization claim names the company; every service
  that reads company data checks it (kara-api, projects-service, HR API, the vector store), and Istio
  policies keep the mesh honest. OpenFGA (VEO.md §7) takes the fine-grained questions later.
- **SCIM 2.0** stays possible: the provisioner's Keycloak and Odoo adapters are the same operations SCIM
  names (create, patch, deactivate users and groups), so a customer's own directory can later push into
  Kara over SCIM.

## 5. Order of work

| Phase | What | Repos |
|---|---|---|
| 1 | Kara: company apps switches, person app access, provisioning outbox + worker + status; Keycloak adapter per app realm (organization, groups, user, roles); realm hr and its client; organizations on in realm simorgh | simorgh-kara |
| 2 | Odoo: `hr.department` and `simorgh.knowledge` in the connector and addon; Kara's Odoo adapter (company, department, employee); reconciliation | simorgh-odoo, simorgh-kara |
| 3 | Kara "Company knowledge" screen; `GET /v1/context`; token exchange | simorgh-kara |
| 4 | Design Suite: organization claim in realm simorgh, company context, `company.skill.md` | design-suite-cloud |
| 5 | HR chatbot: Keycloak login, per-company collections and cache, ingestion from `erp.knowledge.v1`, default company simorgh for local and Google users, isolation test | simorgh-chatbot-ekc-deploy |

## 6. Phase 1 as built (Kara → Keycloak)

**In Kara.**
- Platform admin → Companies: each company has app switches (Design Suite, HR chatbot) and a sync line
  per target (Design Suite realm, HR realm), plus "sync again", which re-queues the company and all its
  people.
- Company → Members: each person has the app roles their company has (Design Suite: offer, engineering;
  HR chatbot: user) and the same sync line.
- Tables: `platform.companies.apps`, `<tenant>.member_apps`, `platform.provisioning_jobs` (the outbox: one
  pending job per company or person, changes fold into it) and `platform.provisioning_state` (what each
  target holds, the last error).
- Every change to a company, unit, membership, manager or app role queues its job in the same transaction.

**In kara-api.** `src/provisioning/` holds:
- `plan.ts`, pure and tested: what should be;
- `provisioner.service.ts`, the worker: it claims jobs with `FOR UPDATE SKIP LOCKED` (safe with two
  replicas), retries with backoff from 20 s up to 1 h, and gives up after 8 tries.

For each app realm the worker does this:

| Job | What it does in the realm |
|---|---|
| Company | Makes the organization (alias = the company's slug). Makes the groups `/companies/<slug>/<unit>/…`, and deletes groups of units that are gone. |
| Person, while they hold a role | Finds the account by attribute `karaId`, or else by email, and marks it as Kara's. If there is none, it creates the account and sends the "set your password" email (client `simorgh-web` / `simorgh-hr-chatbot`). Puts the person in the organization. Makes their unit groups and their roles match: the app's roles, plus the company role where the realm has one named by the slug (`ekc` in realm simorgh). Roles Kara does not manage are left alone. |
| Person who leaves (no role, member or company disabled, app switched off) | For an account Kara manages, removes Kara's roles and the company's groups, disables the account and ends its sessions. Accounts without `karaId` are never touched. An account that was already there (a staff account, marked `karaAdopted`) only loses Kara's roles and groups: Kara never disables it or changes its name. |

**Setting it up** (once; idempotent):
- `deploy/keycloak/setup-realm.sh app-realms`
  - Realm simorgh:
    - organizations on;
    - roles `offer` and `simorgh-engineer`;
    - attributes `karaId` and `karaAdopted`, admin-only;
    - on `simorgh-web`, the `groups` claim and the optional `organization` scope;
    - client `kara-api` gets manage-users and manage-realm (Keycloak 26 changes organizations only with
      manage-realm).
  - Realm hr:
    - settings and mail;
    - role `hr-user`;
    - attributes `karaId` and `karaAdopted`;
    - client `simorgh-hr-chatbot`, whose secret goes to `hr-chatbot/hr-keycloak` `clientSecret`;
    - client `kara-provisioner`, whose secret goes to `kara/kara-keycloak` `hrProvisionerSecret`.
- Chart: `api.provision.enabled`. kara-api reads `PROVISION_HR_CLIENT_SECRET` from that secret, and
  Design Suite's realm uses the existing `erpClientSecret`. A realm without a secret is skipped.

## 7. Phase 2 as built (Kara → Odoo)

**The switch.** "Odoo (ERP)" is a company app without people roles.
- On the new-company form it comes with "create the Odoo company", which is ticked by default.
- For an existing company it is off until the platform admin ticks it, so a linked company never
  suddenly receives records.

**What the worker does** in the company's Odoo company, through the erp-connector as caller `kara`:

| Job | In Odoo |
|---|---|
| Company | Uses the linked Odoo company (`odoo_company_id`), or makes one (`externalId tenant:<slug>`, the same as Admin's "create in Odoo") and links it. Each unit becomes an `hr.department` with reference `kara:unit:<id>`: parents first, name, parent, and manager (the manager's employee). A unit deleted in Kara archives its department. |
| Person | An `hr.employee` with reference `kara:member:<account id>`: name, work email, job title (Kara's title), and department (the person's deepest unit; with no unit, Odoo's is left alone). If they manage units, they become those departments' manager. A person who is disabled or removed is archived, never deleted. No Odoo user is made (Employee only). |

**Taking over, not doubling.** Kara adopts records that were already in Odoo:
- a department with the same name under the same parent and no reference yet;
- an employee with the same work email in that company and no reference yet.

The record takes Kara's reference (connector `POST /v1/<collection>/<id>/adopt`), so nothing is doubled.

**Odoo side** (simorgh-odoo):
- `simorgh_integration` 19.0.1.3.0: `simorgh_ref` on departments, `adopt`, and the new model `simorgh.knowledge`
  (§2.4). It holds a company's products and their features, data sources, orders and circulars with their
  impact, and HR rules. Each company sees only its own (record rule). There is an Odoo menu "Company
  Knowledge". Webhooks feed `erp.department.v1` and `erp.knowledge.v1`.
- The connector serves `/v1/departments` and `/v1/knowledge`, and lists by `companyId` and
  `externalIdPrefix`.

**Reconciliation.**
- Every `PROVISION_RECONCILE_HOURS` (24) the worker queues every company and person again, behind people's
  own changes.
- What drifted (an edit by hand in Keycloak or Odoo, a lost job) is put back. Kara is the master for what
  it manages, and leaves everything else alone.

**Not yet.** These come with phases 3 to 5:
- Kara's company knowledge screen, which writes `simorgh.knowledge`;
- `/v1/context`;
- the apps reading the organization claim and their company's knowledge.

## Sources

- Keycloak organizations and their mappers: [Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/index.html),
  [Red Hat build of Keycloak 26.0 — Managing organizations](https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.0/html/server_administration_guide/managing_organizations),
  [protocol mappers](https://www.keycloak.org/admin-api/protocol-mappers),
  [Phase Two: realms, groups or organizations](https://phasetwo.io/tutorials/authorization/multi-tenancy/),
  [Skycloak: multitenancy with organizations](https://skycloak.io/blog/multitenancy-in-keycloak-using-the-organizations-feature/),
  [izylife: realm per tenant or organizations](https://izylifesolutions.com/articles/keycloak-multi-tenancy-b2b-iam/)
- Provisioning lifecycle and SCIM: [Start with Identity — SCIM implementation guide](https://startwithidentity.com/guides/implementation/scim-provisioning-implementation-guide/),
  [Skycloak — SCIM explained](https://skycloak.io/blog/scim-protocol-what-it-is-and-why-it-matters/),
  [Keycloak extensions (SCIM server)](https://www.keycloak.org/extensions),
  [CloudPartner — SCIM from Keycloak](https://learn.cloudpartner.fi/posts/eu-data-sovereignty-scim-keycloak-entra-provisioning-part-6)
- Golden record, outbox, idempotent consumers: [Gravitee — master data synchronization](https://www.gravitee.io/corpus/gen-2469/master-data-management/master-data-synchronization-across-apis-and-event-streams.html),
  [Gravitee — golden record synchronization](https://gravitee.io/corpus/gen-953/enterprise-information-integration/master-data-management-and-golden-record-synchronization-for-enterprise-information-integration.html)
- Entitlements: [WorkOS — features for specific customers](https://workos.com/blog/enable-b2b-saas-features-for-specific-customers),
  [AWS/LaunchDarkly — SaaS entitlements](https://aws.amazon.com/blogs/apn/simple-and-flexible-saas-entitlement-management-with-launchdarkly),
  [Nalpeiron — entitlement management](https://nalpeiron.com/entitlement-management/)
- Access control: [ISMS.online — A.5.15](https://www.isms.online/iso-27001/annex-a-2022/5-15-access-control-2022/),
  [UpGuard — A.5.18](https://www.upguard.com/compliance/iso-27001/5-18.md)
- Token exchange: [Zuplo — RFC 8693 identity propagation](https://zuplo.com/learning-center/oauth2-token-exchange-identity-propagation),
  [Descope — OAuth token exchange](https://www.descope.com/learn/post/oauth-token-exchange)
- Multi-tenant RAG: [folarin.dev — isolation and per-tenant indexes](https://folarin.dev/blog/building-a-multi-tenant-rag-system),
  [The Neural Base — metadata filtering for tenant isolation](https://theneuralbase.com/rag-fundamentals/learn/advanced/metadata-filtering-for-tenant-isolation-in-multi-tenant-rag/),
  [Data Engineer Things — one vs many vector databases](https://blog.dataengineerthings.org/architecting-multi-tenant-rag-solution-the-one-vs-many-vector-database-dilemma-f52b7556cdba)
- Odoo multi-company: [Odoo 19 multi-company guidelines](https://www.odoo.com/documentation/19.0/fr/developer/howtos/company.html)
