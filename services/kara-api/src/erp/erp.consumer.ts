import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Consumer, Kafka } from 'kafkajs';
import { config } from '../config';
import { eventsApplied } from '../infra/metrics';
import { byTopic, ENTITIES } from './entities';
import './kafkajs-idle-fix';
import { ReadModelService } from './read-model.service';

interface ErpEvent {
  id: string;
  type: string;
  data: Record<string, unknown> & { id: number };
}

/**
 * erp.<entity>.v1 → the read model. Group `kara-api`: each event goes to one
 * replica. A new group reads from the beginning; with the backfill and the
 * newest-wins upsert that is harmless.
 */
@Injectable()
export class ErpConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ErpConsumer.name);
  private consumer?: Consumer;
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly readModel: ReadModelService) {}

  async onApplicationBootstrap() {
    if (process.env.KARA_API_CLI) return; // cli.js: one task, no background work
    this.timers.push(setInterval(() => this.readModel.gauges().catch(() => undefined), 30_000));
    // The backfill first; retried until it has run once.
    const backfill = () => this.readModel.backfill().catch(e => {
      this.log.error(`backfill: ${(e as Error).message}; retrying in 60 s`);
      setTimeout(backfill, 60_000);
    });
    void backfill();
    if (!config.kafka.brokers.length) {
      this.log.warn('KAFKA_BROKERS is empty: the read model is not kept up to date');
      return;
    }
    const kafka = new Kafka({ clientId: config.kafka.clientId, brokers: config.kafka.brokers, ssl: config.kafka.ssl });
    this.consumer = kafka.consumer({ groupId: config.kafka.groupId, allowAutoTopicCreation: false });
    void this.start();
  }

  private async start(): Promise<void> {
    try {
      await this.consumer!.connect();
      await this.consumer!.subscribe({ topics: ENTITIES.map(e => e.topic), fromBeginning: true });
      await this.consumer!.run({ eachMessage: ({ topic, message }) => this.apply(topic, message.value) });
      this.log.log(`consuming ${ENTITIES.map(e => e.topic).join(', ')}`);
    } catch (e) {
      this.log.error(`Kafka: ${(e as Error).message}; retrying in 10 s`);
      await this.consumer!.disconnect().catch(() => undefined);
      setTimeout(() => void this.start(), 10_000);
    }
  }

  /** Exported for tests. A message that is not an event is counted and skipped, never retried forever. */
  async apply(topic: string, value: Buffer | null): Promise<void> {
    const entity = byTopic.get(topic);
    if (!entity) return;
    let event: ErpEvent;
    try {
      event = JSON.parse(String(value));
      if (typeof event?.data?.id !== 'number' || typeof event.type !== 'string') throw new Error('not an erp event');
    } catch (e) {
      eventsApplied.inc({ entity: entity.name, outcome: 'invalid' });
      this.log.warn(`${topic}: skipped a message: ${(e as Error).message}`);
      return;
    }
    if (event.type.endsWith('.deleted')) {
      await this.readModel.markDeleted(entity, event.data.id);
      eventsApplied.inc({ entity: entity.name, outcome: 'applied' });
      return;
    }
    const applied = await this.readModel.upsert(entity, event.data);
    eventsApplied.inc({ entity: entity.name, outcome: applied ? 'applied' : 'stale' });
  }

  async onModuleDestroy() {
    this.timers.forEach(clearInterval);
    await this.consumer?.disconnect().catch(() => undefined);
  }
}
