import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { usernameFor, teamNameFor } from './mattermost.client';
import { issueRow, validSignature } from './plane-events.service';

test('Plane signature: hex HMAC-SHA256 of the raw body', () => {
  const body = Buffer.from('{"event": "issue", "action": "update"}');
  const sig = createHmac('sha256', 's3cret').update(body).digest('hex');
  assert.equal(validSignature('s3cret', body, sig), true);
  assert.equal(validSignature('s3cret', body, sig.toUpperCase()), true);
  assert.equal(validSignature('other', body, sig), false);
  assert.equal(validSignature('s3cret', Buffer.from('{}'), sig), false);
  assert.equal(validSignature('s3cret', body, undefined), false);
  assert.equal(validSignature('', body, sig), false);
});

test('issueRow: state object or id, assignees as ids or users', () => {
  const r = issueRow({
    id: 'i1', name: 'Fix it', project: 'p1', sequence_id: 7, priority: 'high',
    state: { id: 's', name: 'In Progress', group: 'started' },
    assignees: ['u1', { id: 'u2', email: 'x@y' }], target_date: '2026-11-05', updated_at: '2026-10-31T10:00:00Z',
  }, 'simorgh', 'ERP');
  assert.deepEqual(r.assignees, ['u1', 'u2']);
  assert.equal(r.stateGroup, 'started');
  assert.equal(r.projectKey, 'ERP');
  assert.equal(r.sequenceId, 7);
  const bare = issueRow({ id: 'i2', name: 'x', project: 'p1', state: 's-id' }, 'simorgh', null, true);
  assert.equal(bare.stateGroup, null);
  assert.equal(bare.deleted, true);
});

test('Mattermost names', () => {
  assert.equal(usernameFor('Ali.Rezaei@simorghai.com'), 'ali.rezaei');
  assert.equal(usernameFor('1x@a.com'), 'user-x');
  assert.equal(usernameFor('a.very.long.name.indeed.more@a.com').length <= 22, true);
  assert.equal(teamNameFor('EKC'), 'ekc');
  assert.equal(teamNameFor('x'), 'team-x');
});
