import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { ActorGuard } from './auth/actor.guard';
import { CallsService } from './comms/calls.service';
import { CommsController } from './comms/comms.controller';
import { LiveService } from './comms/live.service';
import { ConnectorClient } from './erp/connector.client';
import { ErpConsumer } from './erp/erp.consumer';
import { ErpController } from './erp/erp.controller';
import { ReadModelService } from './erp/read-model.service';
import { HealthController } from './health.controller';
import { IdentityController } from './identity/identity.controller';
import { IdentityService } from './identity/identity.service';
import { DbService } from './infra/db.service';
import { logger } from './infra/json-logger';
import { MetricsController } from './infra/metrics';
import { TenantsService } from './tenants/tenants.service';
import { AdminController } from './provisioning/admin.controller';
import { CompanyDeleteService } from './provisioning/company-delete.service';
import { ProvisionerService } from './provisioning/provisioner.service';
import { ContextController } from './context/context.controller';
import { ContextService } from './context/context.service';
import { PlmController } from './plm/plm.controller';
import { ShopFloorController } from './shopfloor/shopfloor.controller';
import { MattermostClient } from './team/mattermost.client';
import { PlaneClient } from './team/plane.client';
import { PlaneEventsService } from './team/plane-events.service';
import { PlaneWebhookController } from './team/plane-webhook.controller';
import { TeamAccessService } from './team/team-access.service';
import { GitlabShimController } from './sso/gitlab-shim.controller';
import { AssistantController, AssistantTokenGuard } from './assistant/assistant.controller';
import { AssistantService } from './assistant/assistant.service';
import { AssistantToolsService } from './assistant/tools.service';
import { MattermostCommandController } from './assistant/mattermost-command.controller';

/** X-Request-Id in (or made here) and out, and one log line per request. */
function requestLog(req: Request & { actor?: { email: string; via: string } }, res: Response, next: NextFunction) {
  const id = String(req.headers['x-request-id'] || randomUUID());
  req.headers['x-request-id'] = id;
  res.setHeader('x-request-id', id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path.startsWith('/health') || req.path === '/metrics') return;
    logger.request({
      request_id: id, actor: req.actor?.email, via: req.actor?.via, method: req.method, path: req.originalUrl,
      status: res.statusCode, ms: Number(process.hrtime.bigint() - start) / 1e6,
    });
  });
  next();
}

@Module({
  controllers: [AdminController, ErpController, IdentityController, CommsController, ContextController, PlmController, ShopFloorController, PlaneWebhookController, GitlabShimController, AssistantController, MattermostCommandController, HealthController, MetricsController],
  providers: [DbService, TenantsService, ActorGuard, ConnectorClient, ReadModelService, ErpConsumer, IdentityService, LiveService, CallsService, ProvisionerService, ContextService, CompanyDeleteService, PlaneClient, MattermostClient, PlaneEventsService, TeamAccessService, AssistantToolsService, AssistantService, AssistantTokenGuard],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestLog).forRoutes('*');
  }
}
