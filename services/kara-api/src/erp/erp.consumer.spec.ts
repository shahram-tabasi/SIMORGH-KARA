import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ErpConsumer } from './erp.consumer';
import type { ReadModelService } from './read-model.service';

function fakeReadModel() {
  const calls: string[] = [];
  const rm = {
    upsert: async (e: { name: string }, d: { id: number }) => { calls.push(`upsert ${e.name} ${d.id}`); return true; },
    markDeleted: async (e: { name: string }, id: number) => { calls.push(`deleted ${e.name} ${id}`); },
  } as unknown as ReadModelService;
  return { rm, calls };
}

test('changed and deleted events reach the read model; anything else is skipped', async () => {
  const { rm, calls } = fakeReadModel();
  const c = new ErpConsumer(rm);
  const ev = (type: string, id: number) => Buffer.from(JSON.stringify({ id: 'x', type, data: { id } }));
  await c.apply('erp.partner.v1', ev('erp.partner.changed', 7));
  await c.apply('erp.sale_order.v1', ev('erp.sale_order.deleted', 3));
  await c.apply('erp.partner.v1', Buffer.from('not json'));
  await c.apply('erp.partner.v1', Buffer.from(JSON.stringify({ type: 'x', data: {} })));
  await c.apply('erp.unknown.v1', ev('erp.unknown.changed', 1));
  assert.deepEqual(calls, ['upsert partner 7', 'deleted sale_order 3']);
});
