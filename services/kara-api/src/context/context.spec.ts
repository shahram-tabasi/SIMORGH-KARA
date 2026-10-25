import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CompanyContext, chooseOrg, kindsFor, orgsOf, renderMarkdown } from './context';

test('the organization claim as a list or an object', () => {
  assert.deepEqual(orgsOf(['ekc']), ['ekc']);
  assert.deepEqual(orgsOf({ ekc: { id: 'x' }, simorgh: {} }), ['ekc', 'simorgh']);
  assert.deepEqual(orgsOf(undefined), []);
});

test('one company per answer', () => {
  assert.deepEqual(chooseOrg(['ekc']), { slug: 'ekc' });
  assert.match(chooseOrg([]).error!, /no company/);
  assert.match(chooseOrg(['ekc', 'simorgh']).error!, /several/);
  assert.deepEqual(chooseOrg(['ekc', 'simorgh'], 'simorgh'), { slug: 'simorgh' });
  assert.match(chooseOrg(['ekc'], 'other').error!, /not a member/);
});

test('each app sees only its kinds; Markdown for the model', () => {
  assert.equal(kindsFor('hrChatbot').includes('datasource'), false);
  assert.equal(kindsFor('designSuite').includes('hr_rule'), false);
  const c: CompanyContext = {
    company: { slug: 'ekc', name: 'Electro Kavir' }, app: 'designSuite', services: {}, units: ['Engineering'], source: 'kara', generatedAt: '2026-10-25T10:00:00Z',
    knowledge: [
      { kind: 'product', name: 'SIMOPRIME', code: null, summary: 'MV switchgear', body: null, attributes: { maxVoltageKv: 24 }, address: null, impact: null, effectiveDate: null },
      { kind: 'hr_rule', name: 'Leave', code: null, summary: 'secret to DS', body: null, attributes: {}, address: null, impact: null, effectiveDate: null },
    ],
  };
  const md = renderMarkdown(c);
  assert.match(md, /## Products\n\n### SIMOPRIME\n\nMV switchgear\n\n- maxVoltageKv: 24/);
  assert.doesNotMatch(md, /Leave/);
});
