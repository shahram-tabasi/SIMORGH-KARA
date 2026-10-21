import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './config';
import { logger } from './infra/json-logger';

async function main() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  app.set('trust proxy', true);
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  logger.log(
    `listening on ${config.port}; Keycloak ${config.keycloak.issuer}; erp-connector ${config.erp.url || 'off'}; Kafka ${config.kafka.brokers.join(',') || 'off'}`,
    'main',
  );
}

main().catch(e => {
  logger.error(String(e?.stack ?? e), undefined, 'main');
  process.exit(1);
});
