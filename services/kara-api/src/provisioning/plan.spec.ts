import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  CompanyFacts, MemberFacts, UnitFacts, changed, companyGroupPaths, companyUsesOdoo, diff, managedRoles, parentsFirst, planMember,
  primaryUnit, unitPath,
} from './plan';

const ekc: CompanyFacts = {
  id: 'c1', slug: 'ekc', name: 'EKC', status: 'active',
  apps: { designSuite: true },
  units: [['Engineering', 'Electrical'], ['Offer']],
};

const ali: MemberFacts = {
  accountId: 'a1', email: 'ali@ekc.ir', fullName: 'Ali Rezaei', accountActive: true, memberActive: true,
  units: [['Engineering', 'Electrical']],
  apps: { designSuite: ['engineering'], hrChatbot: ['user'] },
};

const ds = { key: 'designSuite' as const, roles: { offer: 'offer', engineering: 'simorgh-engineer' } };
const hr = { key: 'hrChatbot' as const, roles: { user: 'hr-user' } };

test('a person with an app role is in that realm with its roles, the company role and their units', () => {
  assert.deepEqual(planMember(ekc, ali, ds, true), {
    present: true,
    roles: ['ekc', 'simorgh-engineer'],
    groups: ['/companies/ekc/Engineering/Electrical'],
  });
  // No realm role by the company's slug: only the app's roles.
  assert.deepEqual(planMember(ekc, ali, ds, false).roles, ['simorgh-engineer']);
});

test('absent when the company lacks the app, is suspended, or the person is disabled or has no role', () => {
  assert.equal(planMember(ekc, ali, hr, false).present, false); // ekc has no HR chatbot
  assert.equal(planMember({ ...ekc, status: 'suspended' }, ali, ds, true).present, false);
  assert.equal(planMember(ekc, { ...ali, memberActive: false }, ds, true).present, false);
  assert.equal(planMember(ekc, { ...ali, accountActive: false }, ds, true).present, false);
  assert.equal(planMember(ekc, { ...ali, apps: {} }, ds, true).present, false);
  assert.equal(planMember(ekc, { ...ali, apps: { designSuite: ['nonsense'] } }, ds, true).present, false);
  assert.deepEqual(planMember(ekc, { ...ali, apps: {} }, ds, true), { present: false, roles: [], groups: [] });
});

test('role changes touch only the roles Kara manages', () => {
  const managed = managedRoles(ds, 'ekc', true);
  const d = diff(['ekc', 'offer'], ['simorgh-engineer', 'default-roles-simorgh', 'admin', 'ekc'], (r) => managed.has(r));
  assert.deepEqual(d, { add: ['offer'], remove: ['simorgh-engineer'] });
});

test('a company has its root group and every unit with its parents; slashes never split a name', () => {
  assert.deepEqual(companyGroupPaths(ekc), [
    '/companies/ekc',
    '/companies/ekc/Engineering',
    '/companies/ekc/Engineering/Electrical',
    '/companies/ekc/Offer',
  ]);
  assert.equal(unitPath('ekc', ['R/D']), '/companies/ekc/R-D');
});

const unit = (id: string, path: string[], parentId: string | null = null): UnitFacts => ({ id, name: path[path.length - 1], parentId, managerAccountId: null, path });

test('departments are made parents first; an employee gets their deepest unit', () => {
  const units = [unit('c', ['Engineering', 'Electrical'], 'a'), unit('b', ['Offer']), unit('a', ['Engineering'])];
  assert.deepEqual(parentsFirst(units).map((u) => u.id), ['a', 'b', 'c']);
  assert.equal(primaryUnit(units)?.id, 'c');
  assert.equal(primaryUnit([]), undefined);
});

test('Odoo only for an active company with the erp switch; a patch carries only what differs', () => {
  assert.equal(companyUsesOdoo({ ...ekc, apps: { erp: true } }), true);
  assert.equal(companyUsesOdoo({ ...ekc, apps: { erp: true }, status: 'suspended' }), false);
  assert.equal(companyUsesOdoo(ekc), false);
  assert.deepEqual(changed({ name: 'A', parentId: null, managerId: undefined }, { name: 'A', parentId: 7 }), { parentId: null });
  assert.deepEqual(changed({ name: 'A', jobTitle: 'Eng' }, { name: 'A', jobTitle: 'Eng' }), {});
});
