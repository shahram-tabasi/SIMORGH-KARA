-- kara-api's own tables, in schema kara_erp of Kara's database. Applied on
-- every start; idempotent.

CREATE SCHEMA IF NOT EXISTS kara_erp;

-- Odoo's objects as the erp.<entity>.v1 events last described them: the read
-- model Kara's screens list and search without waiting on Odoo.
CREATE TABLE IF NOT EXISTS kara_erp.records (
  entity      text        NOT NULL,              -- partner | product | employee | sale_order
  odoo_id     bigint      NOT NULL,
  company_id  bigint,                            -- Odoo company; null: shared by all
  name        text,
  active      boolean     NOT NULL DEFAULT true,
  deleted     boolean     NOT NULL DEFAULT false,
  data        jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz,                       -- Odoo's write_date
  synced_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity, odoo_id)
);
CREATE INDEX IF NOT EXISTS records_company ON kara_erp.records (entity, company_id) WHERE NOT deleted;

-- Which entities were loaded in full from the connector (the first start).
CREATE TABLE IF NOT EXISTS kara_erp.backfills (
  entity   text PRIMARY KEY,
  done_at  timestamptz NOT NULL DEFAULT now()
);

-- A tenant's Odoo company. Kara's platform schema belongs to kara-web
-- (scripts/migrate.ts); kara-api adds only this column, once that schema exists.
DO $$
BEGIN
  IF to_regclass('platform.companies') IS NOT NULL THEN
    ALTER TABLE platform.companies ADD COLUMN IF NOT EXISTS odoo_company_id integer;
  END IF;
END $$;

-- ── Links and communication (VEO §9a) ─────────────────────────────────────

-- Every Kara record's counterparts in the other systems: one row per system.
CREATE SCHEMA IF NOT EXISTS kara_core;
CREATE TABLE IF NOT EXISTS kara_core.links (
  tenant_id   uuid        NOT NULL,
  kara_type   text        NOT NULL,              -- company | project | order | member | …
  kara_id     text        NOT NULL,
  system      text        NOT NULL,              -- odoo | nextcloud | jitsi | matrix | openstack | …
  external_id text        NOT NULL,
  url         text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kara_type, kara_id, system)
);

-- Calls between Kara users: Kara rings, Jitsi carries the voice and video.
CREATE SCHEMA IF NOT EXISTS kara_comms;
CREATE TABLE IF NOT EXISTS kara_comms.calls (
  id          uuid        PRIMARY KEY,
  tenant_id   uuid        NOT NULL,
  room        text        NOT NULL,
  caller      uuid        NOT NULL,               -- platform.user_accounts.id
  video       boolean     NOT NULL DEFAULT false,
  status      text        NOT NULL,               -- ringing | active | ended | missed | declined | cancelled
  started_at  timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS calls_tenant_started ON kara_comms.calls (tenant_id, started_at DESC);
CREATE TABLE IF NOT EXISTS kara_comms.call_parties (
  call_id     uuid        NOT NULL REFERENCES kara_comms.calls(id) ON DELETE CASCADE,
  account_id  uuid        NOT NULL,
  role        text        NOT NULL,               -- caller | callee
  state       text        NOT NULL,               -- ringing | joined | declined | missed | busy | left | cancelled
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (call_id, account_id)
);
CREATE INDEX IF NOT EXISTS call_parties_account ON kara_comms.call_parties (account_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS call_parties_ringing ON kara_comms.call_parties (updated_at) WHERE state = 'ringing';

-- ── Team Platform (docs/TEAM-PLATFORM.md): Plane and Mattermost ────────────
CREATE SCHEMA IF NOT EXISTS kara_team;

-- Every Plane webhook delivery once (X-Plane-Delivery): a retry is answered
-- 200 and not applied twice.
CREATE TABLE IF NOT EXISTS kara_team.plane_deliveries (
  delivery_id text        PRIMARY KEY,
  event       text        NOT NULL,
  action      text        NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- Plane's issues as the webhooks and the backfill last described them: what
-- "my work" and the assistant read without asking Plane each time.
CREATE TABLE IF NOT EXISTS kara_team.plane_issues (
  id           uuid        PRIMARY KEY,
  workspace    text        NOT NULL,
  project_id   uuid        NOT NULL,
  project_key  text,                              -- identifier, e.g. ERP
  sequence_id  integer,
  name         text        NOT NULL,
  state_name   text,
  state_group  text,                              -- backlog | unstarted | started | completed | cancelled
  priority     text,                              -- urgent | high | medium | low | none
  assignees    uuid[]      NOT NULL DEFAULT '{}', -- Plane user ids
  start_date   date,
  target_date  date,
  deleted      boolean     NOT NULL DEFAULT false,
  updated_at   timestamptz,                       -- Plane's
  synced_at    timestamptz NOT NULL DEFAULT now(),
  data         jsonb       NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS plane_issues_assignees ON kara_team.plane_issues USING gin (assignees) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS plane_issues_project ON kara_team.plane_issues (project_id) WHERE NOT deleted;

-- Plane's projects (id → identifier and name), for links and reports.
CREATE TABLE IF NOT EXISTS kara_team.plane_projects (
  id          uuid        PRIMARY KEY,
  workspace   text        NOT NULL,
  identifier  text        NOT NULL,
  name        text        NOT NULL,
  archived    boolean     NOT NULL DEFAULT false,
  synced_at   timestamptz NOT NULL DEFAULT now()
);

-- Who is who across the apps (Phase 3): a Kara account's Mattermost user and
-- Plane user. Written by the provisioner and on sign-in through the adapter.
CREATE TABLE IF NOT EXISTS kara_team.app_identities (
  account_id   uuid        NOT NULL,              -- platform.user_accounts.id
  app          text        NOT NULL,              -- mattermost | plane
  external_id  text,                              -- the app's user id (null: invited, not signed up yet)
  username     text,
  state        text        NOT NULL,              -- active | invited | deactivated | absent
  managed      boolean     NOT NULL DEFAULT true, -- false: the account existed before Kara
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, app)
);
CREATE UNIQUE INDEX IF NOT EXISTS app_identities_external ON kara_team.app_identities (app, external_id) WHERE external_id IS NOT NULL;

-- The "GitLab" sign-in adapter's one-time codes and access tokens (hashed).
CREATE TABLE IF NOT EXISTS kara_team.sso_grants (
  hash         text        PRIMARY KEY,           -- sha256 of the code or token
  kind         text        NOT NULL,              -- code | token
  client_id    text        NOT NULL,              -- plane | mattermost
  account_id   uuid        NOT NULL,
  redirect_uri text,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz
);
CREATE INDEX IF NOT EXISTS sso_grants_expiry ON kara_team.sso_grants (expires_at);

-- The adapter's pending sign-ins (the app's state, kept while Keycloak asks).
CREATE TABLE IF NOT EXISTS kara_team.sso_pending (
  state         text        PRIMARY KEY,          -- Kara's state towards Keycloak
  client_id     text        NOT NULL,
  redirect_uri  text        NOT NULL,
  client_state  text,
  code_verifier text        NOT NULL,
  expires_at    timestamptz NOT NULL
);

-- Every assistant call (Phase 3): who asked, which tool, on what, the result.
-- No tokens, no document bodies.
CREATE TABLE IF NOT EXISTS kara_team.assistant_audit (
  id          bigserial   PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  account_id  uuid,
  channel     text        NOT NULL,               -- mattermost | n8n | kara
  tool        text        NOT NULL,
  target      text,
  arguments   jsonb       NOT NULL DEFAULT '{}',
  outcome     text        NOT NULL,               -- ok | denied | error
  detail      text
);
CREATE INDEX IF NOT EXISTS assistant_audit_account ON kara_team.assistant_audit (account_id, at DESC);

-- The assistant's slash commands in each company's Mattermost team (made by
-- the provisioner); Mattermost sends the token with every use.
CREATE TABLE IF NOT EXISTS kara_team.mm_commands (
  team_id     text        NOT NULL,
  trigger     text        NOT NULL,
  command_id  text        NOT NULL,
  token_hash  text        NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, trigger)
);
