import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { formatWork } from '../assistant/assistant.service';
import { redirectAllowed } from '../sso/gitlab-shim.controller';
import { gitlabIdOf } from './team-access.service';
import { planeRoleFor, teamPresent } from './team-sync';

test('GitLab id: a stable positive integer below 2^53', () => {
  const id = gitlabIdOf('3f1c2a9b-0d4e-4f5a-8b6c-7d8e9f0a1b2c');
  assert.equal(id, gitlabIdOf('3f1c2a9b-0d4e-4f5a-8b6c-7d8e9f0a1b2c'));
  assert.ok(Number.isSafeInteger(id) && id > 0);
  assert.notEqual(id, gitlabIdOf('3f1c2a9b-0d4e-4f5a-8b6c-7d8e9f0a1b2d'.replace('3f1', '4f1')));
});

test('redirects: same origin and path only', () => {
  const p = 'https://team.simorghai.com/signup/gitlab/complete';
  assert.equal(redirectAllowed(p, 'https://team.simorghai.com/signup/gitlab/complete'), true);
  assert.equal(redirectAllowed(p, 'https://team.simorghai.com/signup/gitlab/complete/'), true);
  assert.equal(redirectAllowed(p, 'https://evil.example/signup/gitlab/complete'), false);
  assert.equal(redirectAllowed(p, 'https://team.simorghai.com/other'), false);
  assert.equal(redirectAllowed(p, 'not a url'), false);
});

test('Plane role: highest of Kara roles', () => {
  assert.equal(planeRoleFor(['member']), 15);
  assert.equal(planeRoleFor(['guest', 'admin']), 20);
  assert.equal(planeRoleFor([]), null);
  assert.equal(planeRoleFor(['nonsense']), null);
});

test('teamPresent: company app, active person, a role', () => {
  const c = { id: 'c', slug: 'ekc', name: 'EKC', status: 'active', apps: { mattermost: true }, units: [] };
  const m = { accountId: 'a', email: 'a@x', fullName: 'A B', accountActive: true, memberActive: true, units: [], apps: { mattermost: ['user'] } };
  assert.equal(teamPresent(c, m, 'mattermost'), true);
  assert.equal(teamPresent(c, m, 'plane'), false);
  assert.equal(teamPresent({ ...c, status: 'suspended' }, m, 'mattermost'), false);
  assert.equal(teamPresent(c, { ...m, memberActive: false }, 'mattermost'), false);
  assert.equal(teamPresent(c, { ...m, apps: {} }, 'mattermost'), false);
  assert.equal(teamPresent(null, m, 'mattermost'), false);
});

test('formatWork groups by source and links Plane issues', () => {
  const out = formatWork('Ali', [
    { source: 'plane', title: 'Fix login', key: 'ERP-4', status: 'In Progress', due: '2026-11-02', url: 'https://p/x' },
    { source: 'task', title: 'Report', status: 'open', due: null },
  ], true);
  assert.match(out, /\[ERP-4 Fix login\]\(https:\/\/p\/x\)/);
  assert.match(out, /میز کار/);
  assert.doesNotMatch(out, /کارتابل\*\*/);
  assert.match(formatWork('', [], false), /Plane/);
});
