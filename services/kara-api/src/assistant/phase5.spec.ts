import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { actionSig, sigOk } from './proposals.service';

test('approval buttons: signature binds proposal and decision', () => {
  const id = '6f1d2c3b-0000-4000-8000-000000000001';
  const s = actionSig(id, 'approve', 'k');
  assert.equal(sigOk(id, 'approve', s, 'k'), true);
  assert.equal(sigOk(id, 'reject', s, 'k'), false);
  assert.equal(sigOk('6f1d2c3b-0000-4000-8000-000000000002', 'approve', s, 'k'), false);
  assert.equal(sigOk(id, 'approve', s, 'other'), false);
  assert.equal(sigOk(id, 'approve', '', 'k'), false);
  assert.equal(sigOk(id, 'approve', s, ''), false);
});
