import { Controller, Get, Header } from '@nestjs/common';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const eventsApplied = new Counter({
  name: 'kara_erp_events_total',
  help: 'erp.* events read, by entity and outcome (applied, stale, invalid)',
  labelNames: ['entity', 'outcome'],
  registers: [registry],
});

export const readModelSize = new Gauge({
  name: 'kara_erp_records',
  help: 'Records in the Odoo read model, by entity',
  labelNames: ['entity'],
  registers: [registry],
});

export const connectorCalls = new Counter({
  name: 'kara_erp_connector_requests_total',
  help: 'Calls to the erp-connector, by method and status',
  labelNames: ['method', 'status'],
  registers: [registry],
});

export const identitySyncs = new Counter({
  name: 'kara_identity_syncs_total',
  help: 'Kara accounts written to Keycloak, by outcome (created, updated, invited, skipped, failed)',
  labelNames: ['outcome'],
  registers: [registry],
});

@Controller()
export class MetricsController {
  @Get('metrics')
  @Header('content-type', registry.contentType)
  metrics() {
    return registry.metrics();
  }
}

export const teamEvents = new Counter({
  name: 'kara_team_events_total',
  help: 'Team Platform deliveries (Plane webhooks, Mattermost commands), by source and outcome',
  labelNames: ['source', 'outcome'],
  registers: [registry],
});

export const teamProvisioningFailed = new Gauge({
  name: 'kara_team_provisioning_failed',
  help: 'People and companies whose last provisioning into Plane or Mattermost failed, by target',
  labelNames: ['target'],
  registers: [registry],
});

export const teamProposalsPending = new Gauge({
  name: 'kara_team_proposals_pending',
  help: 'Changes proposed by the assistant waiting for an approval',
  registers: [registry],
});
