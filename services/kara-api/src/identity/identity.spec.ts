import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { companyOf, nameOf } from '../erp/entities';
import { brokered, splitName } from './identity.service';

test('names split into first and last for Keycloak', () => {
  assert.deepEqual(splitName('مریم کاظمی'), { firstName: 'مریم', lastName: 'کاظمی' });
  assert.deepEqual(splitName('  Ali  Reza   Ahmadi '), { firstName: 'Ali Reza', lastName: 'Ahmadi' });
  assert.deepEqual(splitName('Admin'), { firstName: 'Admin', lastName: '' });
});

test('brokered domains sign in through the staff identity provider', () => {
  assert.equal(brokered('s.tabasi@simorghai.com', ['simorghai.com']), true);
  assert.equal(brokered('S.Tabasi@SimorghAI.com', ['simorghai.com']), true);
  assert.equal(brokered('x@notsimorghai.com', ['simorghai.com']), false);
  assert.equal(brokered('x@example.com', []), false);
});

test('read-model helpers take the name and the company from an event', () => {
  assert.equal(nameOf({ name: 'Pars' }), 'Pars');
  assert.equal(nameOf({ number: 'S00001' }), 'S00001');
  assert.equal(companyOf({ company: { id: 2, name: 'X' } }), 2);
  assert.equal(companyOf({ company: null }), null);
});
