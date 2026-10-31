import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isoWeek } from '../assistant/digest.service';
import { newAssignees } from './notices.service';
import type { IssueRow } from './plane-events.service';

const row = (assignees: string[], deleted = false): IssueRow => ({
  id: 'i', workspace: 'w', projectId: 'p', projectKey: 'ERP', sequenceId: 1, name: 'x', stateName: null, stateGroup: null,
  priority: null, assignees, startDate: null, targetDate: null, updatedAt: null, deleted,
});

test('newAssignees: only people added now', () => {
  assert.deepEqual(newAssignees(null, row(['a', 'b'])), ['a', 'b']);
  assert.deepEqual(newAssignees(row(['a']), row(['a', 'b'])), ['b']);
  assert.deepEqual(newAssignees(row(['a', 'b']), row(['a'])), []);
  assert.deepEqual(newAssignees(null, row(['a'], true)), []);
});

test('isoWeek', () => {
  assert.equal(isoWeek(new Date('2026-10-31T10:00:00Z')), '2026-W44');
  assert.equal(isoWeek(new Date('2026-01-01T10:00:00Z')), '2026-W01');
  assert.equal(isoWeek(new Date('2027-01-01T10:00:00Z')), '2026-W53');
});
