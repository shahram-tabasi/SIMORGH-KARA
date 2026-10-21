# Simorgh Kara — Virtual Enterprise Organization (VEO) blueprint

Status: agreed 2026-10-21 (decisions in §12). Kara is the one screen a complex engineering /
manufacturing company works in; Odoo is the system of record behind it; the
rest of the platform (Keycloak, Kafka, Istio, ELK, Nextcloud, Jitsi, n8n,
the Design Suite, the AI chatbots) plugs into Kara instead of living beside it.
This document says what that means, on which standards it rests, and in what
order to build it.

## 1. What a VEO is, and what Kara has to be for it

A **virtual enterprise** (virtual organization, VO) is a temporary alliance of
independent companies that pool skills and resources to win and deliver one
opportunity — a switchgear project, a plant, a tender — and dissolve when it is
done. Research on collaborative networked organizations (Camarinha-Matos &
Afsarmanesh; the ARCON reference modelling framework) separates two layers:

| Layer | What it is | In Kara |
|---|---|---|
| **VO Breeding Environment (VBE)** | the long-term pool of member companies that trust each other, share standards, tools and a catalogue of competences | the Kara platform / a holding: tenants, their profiles, competences, certificates, ratings |
| **Virtual Organization (VO)** | one alliance for one opportunity, with a lifecycle: *creation → operation → evolution → dissolution* | a **VO workspace** spanning several tenants: shared project, shared process, shared documents, shared chat, role-based access across companies |

ARCON describes each network by its *endogenous* elements (structure, components,
functions, behaviour — i.e. roles, resources, processes, rules) and *exogenous*
interactions (market, support, society, constituency). Kara models exactly those.

So "making a company a VEO" means Kara must:

1. run **each company completely** (all ten business areas below, on Odoo);
2. let several companies **form a VO in minutes** — share a project, a process,
   documents, a chat room and the right slice of their data — and dissolve it
   cleanly, with an audit trail;
3. keep **one identity, one inbox (kartabl), one search, one notification
   stream** for a person, whichever company or VO the work comes from.

Kara is already multi-tenant (platform → holdings → companies, a schema per
tenant), with Keycloak organizations per tenant and an Odoo company per tenant:
the VBE skeleton exists. The VO layer and the business areas are what this
blueprint adds.

## 2. Standards the design follows

| Area | Standard / body of knowledge | Used for |
|---|---|---|
| Enterprise modelling | ISO 19439 (framework, from CIMOSA/GERAM: function, information, resource, organization views), ISO 19440:2020 (constructs) | how Kara's modules, data and roles are described |
| Collaborative networks | ARCON / VBE–VO reference model | §1, the VO lifecycle |
| Manufacturing integration | ISA-95 / IEC 62264 (levels 0–4; object models for personnel, equipment, material, process segments; B2MML) | Kara = level 4 (ERP via Odoo) + light level 3 (shop-floor execution); messages to machines/MES follow ISA-95 objects |
| Production planning | MRP II (APICS/ASCM): MPS, rough-cut capacity (RCCP), MRP, capacity requirements (CRP), shop-floor control (SFC), costing, feedback | §5 |
| Supply chain | SCOR (Plan, Source, Make, Deliver, Return, Enable) | KPI tree for trade, warehouse, production |
| Processes | BPMN 2.0 (ISO/IEC 19510), DMN 1.x for decision tables, CMMN for case work | §6 |
| Quality | ISO 9001:2015 (QMS, nonconformity, CAPA, audits), ISO/IEC 17025 (test labs), IEC 62271 / IEC 61439 type & routine tests (switchgear) | Quality & testing area |
| Projects | ISO 21502:2020, PMBOK 7, earned value per ANSI/EIA-748 | Project control area |
| Engineering | ISO 10007 (configuration management), IEC 81346 (reference designation), IEC 61355 (document kinds) | engineering BOM, revisions, the Design Suite link |
| R&D | ISO 56002 (innovation management), stage-gate | R&D area |
| IT services | ITIL 4, ISO/IEC 20000-1 | Systems & IT area |
| After-sales | ISO 10002 (complaints), ISO 10004 (satisfaction) | after-sales area |
| Records | ISO 15489 (records management) | documents, retention, audit |
| Security | ISO/IEC 27001:2022, NIST SP 800-207 (zero trust), OAuth 2.1/OIDC, Google Zanzibar-style ReBAC (OpenFGA) | §7 |
| Events | CloudEvents 1.0, AsyncAPI 3, schema registry with compatibility rules, transactional outbox | §8 |
| Iran | Moodian e-invoicing (tax organization's سامانه مودیان), OCA `l10n_ir_account` | finance |

## 3. Architecture

```
                         Keycloak (realm kara: people, organizations = companies, VO groups)
                                │ OIDC                         OpenFGA (who may do what on which record, across companies)
 ┌──────────────────────────────┼───────────────────────────────────────────────────────────────┐
 │ kara-web (Next.js)  one shell: kartabl · search · notifications · module screens · BPMN modeler│
 └──────────────────────────────┬───────────────────────────────────────────────────────────────┘
                                │ BFF calls (service token + acting account), Istio mTLS
 ┌──────────────────────────────▼───────────────────────────────────────────────────────────────┐
 │ kara-api (NestJS, modular monolith first)                                                      │
 │  identity · tenants/VO · kartabl & tasks · process (BPMN) · sales · engineering · projects ·   │
 │  trade · warehouse · production (MRP II) · quality · R&D · IT · after-sales · documents · comms│
 │  read models (Postgres) ◄── Kafka erp.*, ds.*, proc.*        writes ──► erp-connector ──► Odoo │
 └───┬──────────────┬──────────────────┬────────────────┬───────────────┬────────────────────────┘
     │              │                  │                │               │
  Operaton       n8n              Nextcloud         Matrix +         Design Suite, technical &
  (BPMN/DMN      (service tasks,  (files, Collabora, Jitsi            HR chatbots (deep links,
  engine)        integrations)    per-record folders) (chat, calls)   tool calls, events)
     └──────────── all events: Kafka (CloudEvents, AsyncAPI, registry) ── logs ELK ── metrics Prometheus ──┘
```

Principles:

- **Odoo owns business records** (partners, products, BOMs, routings, orders,
  stock, production, accounting, HR master data). Kara never keeps a second
  copy that it edits; it keeps *read models* fed by events.
- **Kara owns the work around the records**: who must do what next (kartabl),
  processes, approvals, collaboration across companies, screens.
- **Users never see Odoo.** Back-office specialists may (accounting
  configuration), on the LAN only.
- **Every write is a command to the erp-connector** (idempotent, audited, per
  calling app); **every change is an event** on Kafka.
- **Modular monolith first** (kara-api with strict module boundaries, one
  schema per module); a module becomes its own service only when it needs to
  scale or deploy separately — the common best practice for a team of this size.

## 4. The ten business areas on Odoo

For each area: what Odoo Community 20 provides, what OCA adds (19.0 today —
see §10), and what Kara builds (screens, processes, the missing models in our
own `simorgh_*` Odoo modules).

| Area | Odoo (Community) | OCA | Kara builds |
|---|---|---|---|
| **Sales & offers** | CRM, Sales, quotation templates, pricelists | sale_* , crm_* | offer workbench: tender intake → technical scope (Design Suite) → costing (BOM roll-up + labour) → offer approval (BPMN) → quote → order; win/loss |
| **Technical & engineering** | product, BOM (mrp) | mrp_bom_* , PLM-like via `mrp_bom_tracking` | engineering BOM from the Design Suite (MTO), ECR/ECO with revisions (ISO 10007), IEC 81346 tags, document register (IEC 61355), released BOM → manufacturing BOM |
| **Project control** | Project, Timesheets, analytic accounting | project_* (≈50 modules: WBS, milestones, forecast lines) | WBS, baselines, earned value (PV, EV, AC, SPI, CPI per ANSI/EIA-748), progress from milestones/production, risk & issue logs, Gantt (Odoo's is Enterprise) |
| **Trade & commercial** | Purchase, purchase agreements (tenders), landed costs, multi-currency | purchase_* , account_* | RFQ comparison, supplier evaluation (SCOR Source), import files (LC, customs), contract follow-up |
| **Warehouse** | Inventory, routes, lots/serials, valuation | stock_* | mobile scanning screens (Odoo's barcode app is Enterprise), cycle counts, kitting for production |
| **Manufacturing & production** | MRP: BOM, routings, work centres + calendars, work orders, subcontracting, maintenance, repair, costing | `mrp_multi_level` (MRP netting, planned orders) | **MRP II** — §5 |
| **Quality control & testing** | — (Quality is Enterprise) | `quality_control_oca`, `mgmtsystem` (ISO), nonconformity | inspection plans per operation, test protocols and reports (IEC 62271/61439 routine & type tests), FAT/SAT, NCR → CAPA (ISO 9001), calibration of instruments, certificates of conformity |
| **R&D** | Project | — | idea → stage-gate (ISO 56002), prototypes as projects with budgets, knowledge base |
| **Systems & IT** | — | `helpdesk_mgmt` | IT service desk (ITIL 4: incidents, requests, changes), asset register (maintenance equipment), access requests that drive Keycloak |
| **After-sales services** | Repair, Maintenance | `helpdesk_mgmt`, `fieldservice` (+ equipment, warranty, routes) | tickets, installed-base register (serials from production), warranty, field visits, spare parts, complaints (ISO 10002) |
| Cross-cutting: HR, finance | Employees, Time Off, Attendance, Expenses, Invoicing/Accounting | `l10n_ir_account`, mis_builder (reports, budgets) | Kara's existing HR (kartabl, leave, attendance devices) posts to Odoo; payroll (Iranian rules) in Kara posting journals; Moodian e-invoicing module |

## 5. MRP II through Odoo

MRP II is a closed loop; Odoo Community has the execution half, so Kara adds
the planning half as Odoo models (`simorgh_mrp2`) with Kara screens:

| MRP II function | Where |
|---|---|
| Demand: sales orders, offers with probability, forecasts | Odoo sale + `simorgh_mrp2` forecast lines |
| **MPS** (master production schedule per end item and period, with time fences) | `simorgh_mrp2` — Odoo's MPS is Enterprise-only |
| **RCCP** (MPS × bill of resources vs key work-centre capacity) | `simorgh_mrp2`, using routings and work-centre calendars |
| **MRP** (net requirements down the BOM, planned orders, lead times) | OCA `mrp_multi_level` (planned orders, MRP areas) |
| **CRP** (planned + released orders × routings vs work-centre calendars, finite/infinite) | Odoo work-order planning (`_plan_workorders` on calendars) + `simorgh_mrp2` load view |
| Purchasing & subcontracting from planned orders | Odoo purchase, mrp_subcontracting |
| **SFC** (release, dispatch, start/stop/scrap, operator time) | Odoo work orders; Kara tablet screens per work centre (ISA-95 level 3) |
| Costing (standard/actual, variances) | mrp_account + stock valuation |
| Feedback (completions, delays, capacity changes → replanning) | events `erp.workorder.v1`, `erp.production.v1` → Kara planner alerts |

Kara screens: planning board (MPS grid, RCCP per bottleneck), MRP run results
with exceptions, capacity load per work centre, dispatch list per work centre,
operator tablet, production KPIs (OEE, schedule adherence, WIP).

## 6. Processes: BPMN with n8n

n8n is an automation tool, not a BPMN engine: it has no BPMN 2.0, and human
tasks, timers, escalations and long-running state are not what it is built for.
The standard way to get "design processes in BPMN" and still use n8n:

- **Model** in BPMN 2.0 inside Kara (bpmn-js modeler; DMN tables for rules
  like approval limits). The model is the documentation and the executable.
- **Execute** in **Operaton** (open-source Camunda 7 fork, Apache 2.0, BPMN +
  DMN, user tasks, timers, escalation, history): one engine, Postgres.
- **User tasks → Kara's kartabl** (one inbox for everything, with deadlines).
- **Service tasks → n8n** (external-task pattern: a small worker hands the task
  to an n8n workflow and completes it with the result) — so integrations stay
  low-code where n8n is good: email, SMS, Moodian, files, third parties.
- Process events (`proc.instance.*`, `proc.task.*`) on Kafka; KPIs (cycle
  time, SLA breaches) in Grafana.

If you prefer n8n only, the simpler path also works for small approvals (as the
Design Suite does today), but BPMN modelling, audit and escalation then have to
be rebuilt by hand in each workflow.

## 7. Identity and authorization across companies

- **Keycloak** (realm `kara`): people; one organization per company; staff log
  in through realm simorgh (identity provider). Coarse roles in the token.
- **OpenFGA** (Zanzibar-style relationship-based access): the fine-grained
  question "may Ali, of partner company B, see this drawing of VO X's project?"
  — relations like `company#member`, `vo#participant`, `project#manager`,
  `document#viewer from project`. Keycloak alone does RBAC/ABAC, not this.
- **Istio ambient**: mTLS between every service, L4/L7 policies; no service
  trusts the network (NIST 800-207).
- **Odoo**: one integration user per app; Kara enforces per-person rights before
  calling the connector; record rules per company in Odoo as the second wall.

## 8. Data, events, integration

- Kafka topics per domain and version (`erp.*.v1`, `kara.*.v1`, `proc.*.v1`,
  `ds.*.v1`), CloudEvents envelope, keyed by business id, JSON Schema in a
  registry (Apicurio) with BACKWARD compatibility, AsyncAPI documents per
  service; transactional outbox in every producer (as the connector does).
- Read models in kara-api per module; reconciliation jobs as a safety net.
- Analytics: logical replication / CDC of Odoo and Kara into a reporting store
  — never business events from the database.
- Observability: JSON logs with request ids (ELK), RED metrics and Kafka lag
  (Prometheus/Grafana), OpenTelemetry traces.

## 9. Collaboration: files, chat, meetings, AI

| Need | Choice | Why |
|---|---|---|
| Files | **Nextcloud** (+ Collabora): a folder per record (`/VO/<code>`, `/Projects/<code>`, `/Orders/<ref>`), shared to the right Keycloak groups; Nextcloud federation to partner companies' clouds | already deployed; WebDAV API; federation fits VOs |
| Chat | **Matrix** (Synapse + Matrix Authentication Service with Keycloak upstream; Element clients) | open standard, federation between companies (a VO room can span two organizations' servers), end-to-end encryption, bots, Jitsi built in. **Delta Chat** is email-based with no central admin, SSO or roles — good for private users, not for an organization. Nextcloud Talk is the lighter alternative if federation is not needed |
| Meetings | **Jitsi** with Keycloak JWT; "start meeting" on any record, link stored in Odoo calendar | already deployed |
| AI | technical chatbot and HR chatbot as Kara panels with the record's context; tools call kara-api with the person's rights (never more) | one assistant entry point |
| Design | Design Suite projects linked to Kara projects/offers; MTO/BOM to Odoo through the connector | engineering BOM flows into manufacturing |

Every record screen in Kara gets the same **collaboration bar**: files, chat
room, meeting, process status, AI assistant.

## 9a. How everything plugs into Kara (2026-10-21)

Kara is the one screen; every other system is a **back service** reached in
the same five ways. A new system is integrated when all five are answered.

| Layer | Rule |
|---|---|
| **1. Identity** | One login, Keycloak realm `kara`. Each system trusts Keycloak itself (OIDC/SAML/JWT), so a person is the same `sub` everywhere; no second password anywhere. |
| **2. Provisioning** | When Kara creates a company, VO, project, team or person, a *provisioning process* (Operaton, one idempotent step per system, retried, its state shown in Kara) creates the matching thing in every system. Removing a person or ending a VO runs the reverse. |
| **3. Links** | kara-api keeps one table `links(kara_type, kara_id, system, external_id, url)`: project 12 ↔ Odoo project 7 ↔ Nextcloud folder ↔ Matrix room ↔ Jitsi room ↔ OpenStack project. Every screen finds its neighbours there; nobody guesses names. |
| **4. Events** | Each system's changes come back as CloudEvents on Kafka (`erp.*`, `files.*`, `chat.*`, `call.*`, `vm.*`), through a small adapter where the system has only webhooks. Kara's read models, kartabl and notifications listen; nothing polls a screen. |
| **5. UI** | Inside Kara, never "go to another app": native Kara screens over each system's API where the work is daily (lists, forms, chat, softphone); the system's own UI embedded only where rebuilding it is pointless (Collabora editor, Jitsi room, VM console), always with single sign-on. |

### Per system

| System | Identity | Provisioned by Kara | In Kara's UI | Events back |
|---|---|---|---|---|
| **Odoo** (ERP, MRP II) | integration user per app; the person's rights checked by Kara + OpenFGA before every call | company (+warehouse), projects, analytic accounts, employees, partners | native screens over the erp-connector; Odoo itself hidden | `erp.*.v1` (done) |
| **Nextcloud** (files) | OIDC login (user_oidc app) against Keycloak; groups from the token | a group per company / VO / project; a Group Folder per record (`/VO/<code>`, `/Projects/<code>`, `/Orders/<ref>`) with those groups; federation share to a partner's cloud for a VO | Files tab on every record (WebDAV list, upload, versions); open in Collabora in an embedded frame | webhook_listeners app → adapter → `files.*.v1` (uploaded, shared, approved) |
| **Jitsi** (meetings) | JWT signed for Keycloak users (prosody token auth); guests by one-time link | a stable room per record (`kara-<type>-<id>`), moderator = record owner | "Meet" button on every record; Jitsi IFrame API inside Kara; meeting saved as an Odoo calendar event with attendees | join/leave via prosody event-sync → `call.meeting.*` (minutes, attendance) |
| **Messaging: Matrix** (Synapse + MAS, Element) | MAS with Keycloak upstream: same account | a space per company and per VO, a room per project / order / ticket; members follow Kara's groups (a bot keeps them in step) | chat panel in Kara (matrix-js-sdk), same rooms in Element mobile; Kara posts system messages (approval needed, order shipped) to the room | appservice → `chat.*.v1` (mentions become kartabl items) |
| **VoIP calls: Asterisk** (PBX, LTS) with **SIP over WebRTC** | SIP account per person, created from Keycloak; the browser registers with a short-lived credential kara-api issues | an extension per person, ring groups per team, queues for sales / after-sales, a SIP trunk to the telecom operator for outside numbers | softphone in Kara's top bar (JsSIP): click-to-call on any phone number (customers, suppliers, colleagues); incoming call shows the caller's Odoo partner, open tickets and orders; desk IP phones use the same extension | AMI/ARI adapter → `call.voice.*.v1` (call log on the partner in Odoo, missed calls in the kartabl, recordings in Nextcloud where the law allows) |
| **User VMs: OpenStack** (on the Ceph cluster) | Keystone federated to Keycloak (OIDC mapping: Kara company → Keystone domain, team/VO group → project role) | a Keystone domain per company, a project per team / VO with quotas; a VM request is a BPMN process: request → approval → n8n/Operaton calls Nova/Heat (templates: engineering workstation, EPLAN, GPU) | "My workspace": my VMs, start/stop/snapshot, open the desktop in the browser through Apache Guacamole (RDP/SSH/VNC, Keycloak SSO) or the noVNC console | Nova notifications → adapter → `vm.*.v1`; monthly usage (CloudKitty/Gnocchi) → cost lines to the project's analytic account in Odoo |

### One example end to end

A partner company joins a VO for an offer:
1. Kara: *add company B to VO "Substation X"* → OpenFGA relation `vo:X#participant@company:B`.
2. Provisioning: Keycloak group, Matrix room invite, Nextcloud federated share
   of `/VO/X`, Jitsi room access, OpenStack project role on `vo-x` (if it has
   VMs), Odoo partner for B on the VO's project.
3. B's engineer signs in once, sees the VO in Kara: files, chat, the next
   meeting, the offer's approval waiting in the kartabl, a call button to the
   sales engineer, and the shared EPLAN workstation VM.
4. The VO ends: the reverse process removes every grant; the records stay.

### Order of work (fits §11)

1. Links table, provisioning framework (Operaton), the collaboration bar with
   Nextcloud + Jitsi (phase 0b).
2. Matrix with MAS and the Kara chat panel (task "Matrix").
3. Asterisk with WebRTC, the softphone and click-to-call, Odoo call log.
4. OpenStack: Keystone federation, VM request process, Guacamole, cost to Odoo.

## 10. A decision to take now: Odoo 19 or 20

Odoo 20 Community is only weeks old; the OCA 20.0 branches are almost empty
(only MIS Builder and the Iran localisation on 2026-10-21). Everything §4–5
counts on — `mrp_multi_level`, `quality_control_oca`, `helpdesk_mgmt`,
`fieldservice`, the project modules, `auth_oidc`, `dms` — is on **19.0**.
Porting a dozen OCA modules to 20 ourselves is months of work that the OCA will
do anyway within about a year.

Recommendation: **move Odoo to 19.0 now** (the database holds only test data),
use the OCA 19.0 modules, and upgrade to 20 (OpenUpgrade) once its OCA
branches are ready. The erp-connector, simorgh_integration and Kara do not
change: JSON-2, the webhooks and the models they use are the same in 19.

## 11. Order of work

| Phase | Content | Done when |
|---|---|---|
| 0 Foundations | Odoo 19 + OCA set; module skeleton in kara-api (per-module schema, events, permissions); OpenFGA; Apicurio + AsyncAPI; collaboration bar (Nextcloud folder, Jitsi link) | a record in Kara shows its folder, room and meeting |
| 1 Process backbone | Operaton + n8n external-task bridge; bpmn-js modeler; unified kartabl (Kara tasks + process tasks + Odoo activities) | an offer approval modelled in BPMN runs end to end |
| 2 Sales → engineering | offer workbench, Design Suite → BOM/MTO → Odoo, costing | a tender becomes an order with an engineering BOM |
| 3 MRP II | `simorgh_mrp2` (MPS, RCCP, CRP views), `mrp_multi_level`, planner and shop-floor screens | a planned month runs from MPS to work orders and back |
| 4 Quality & after-sales | inspections, test reports, NCR/CAPA; helpdesk, installed base, field service | a failed routine test opens an NCR; a customer ticket reaches the right serial |
| 5 Project control & trade & warehouse | WBS/EVM, Gantt; RFQ comparison, supplier rating; mobile warehouse | SPI/CPI per project from real data |
| 6 VO layer | VO workspace across tenants (OpenFGA relations), Matrix federation, Nextcloud federation, VO lifecycle (form, operate, dissolve) | two companies deliver one project in one shared space |
| 7 R&D, IT, finance localisation | stage-gate, ITIL desk, Moodian e-invoicing, payroll postings | |

Each phase ships to the cluster with its chart changes, tests, and docs.

## 12. Decisions (2026-10-21)

| Question | Decision |
|---|---|
| Odoo version | **19.0** now, with the OCA 19.0 modules; OpenUpgrade to 20 once OCA has ported |
| Processes | **BPMN 2.0/DMN** modelled in Kara (bpmn-js), run on **Operaton**; user tasks in Kara's kartabl, service tasks through **n8n** |
| Messaging | **Matrix** (Synapse + Matrix Authentication Service → Keycloak, Element), federated for VOs |
| First after the foundations | the **process backbone** (phase 1) |
