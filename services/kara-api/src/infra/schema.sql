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
